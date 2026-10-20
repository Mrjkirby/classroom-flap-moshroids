import http from 'node:http';
import { acceptWebSocket } from './websocket.mjs';
import { parseMessage, roomMode, safeText } from './protocol.mjs';
import { MatchRegistry } from './match.mjs';
import { createGameSessions } from './auth/game-sessions.mjs';

function reject(socket, status, message) {
  socket.end(`HTTP/1.1 ${status} ${message}\r\nConnection: close\r\n\r\n`);
}

function json(response, status, body, origin) {
  const headers = { 'content-type': 'application/json', 'cache-control': 'no-store' };
  if (origin) {
    headers['access-control-allow-origin'] = origin;
    headers.vary = 'Origin';
  }
  response.writeHead(status, headers);
  response.end(JSON.stringify(body));
}

async function readJson(request, limit = 2048) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) throw new Error('Request body too large.');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export function createMoshroidsServer({
  authenticate,
  allowedOrigins = [],
  allowMissingOrigin = false,
  clock = () => Date.now(),
  log = () => {},
  ready = true,
} = {}) {
  if (typeof authenticate !== 'function') throw new Error('A server-side access-token verifier is required.');
  const registry = new MatchRegistry({ clock, log });
  const sessions = createGameSessions({ clock });
  const allowed = new Set(allowedOrigins);
  const connections = new Set();
  const rawSockets = new Set();
  const server = http.createServer((request, response) => {
    if (request.url === '/health') {
      response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      return response.end(JSON.stringify({ ok: true, classroomReady: ready, serverNow: clock(), ...registry.status() }));
    }
    if (request.url === '/api/launch/redeem') {
      const origin = request.headers.origin;
      const originAllowed = origin ? allowed.has(origin) : allowMissingOrigin;
      if (!originAllowed) return json(response, 403, { ok: false });
      if (request.method === 'OPTIONS') {
        response.writeHead(204, {
          'access-control-allow-origin': origin || '',
          'access-control-allow-methods': 'POST',
          'access-control-allow-headers': 'content-type',
          'access-control-max-age': '600',
          'cache-control': 'no-store',
          vary: 'Origin',
        });
        return response.end();
      }
      if (request.method !== 'POST') return json(response, 405, { ok: false }, origin);
      if (!ready) return json(response, 503, { ok: false }, origin);
      if (!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] || '')) {
        return json(response, 415, { ok: false }, origin);
      }
      void (async () => {
        try {
          const body = await readJson(request);
          if (!body || Object.keys(body).sort().join() !== 'roomId,token' ||
            typeof body.token !== 'string' || !/^ml1_[a-f0-9]{64}$/.test(body.token) ||
            !roomMode(body.roomId)) return json(response, 400, { ok: false }, origin);
          const identity = await authenticate({ accessToken: body.token, roomId: body.roomId, origin });
          if (!identity?.studentId || !identity?.displayName) return json(response, 401, { ok: false }, origin);
          const session = sessions.create(identity, body.roomId, origin);
          return json(response, 200, { ok: true, sessionToken: session.resumeToken, expiresAt: session.expiresAt }, origin);
        } catch (error) {
          if (error?.message === 'Request body too large.') return json(response, 413, { ok: false }, origin);
          if (error instanceof SyntaxError) return json(response, 400, { ok: false }, origin);
          if (error?.message === 'MOSHROIDS identity service is unavailable.') {
            return json(response, 503, { ok: false }, origin);
          }
          return json(response, 401, { ok: false }, origin);
        }
      })();
      return;
    }
    response.writeHead(404).end();
  });
  server.maxConnections = 256;
  server.on('connection', socket => {
    rawSockets.add(socket);
    socket.once('close', () => rawSockets.delete(socket));
  });
  server.on('upgrade', (request, socket, head) => {
    const origin = request.headers.origin;
    if (request.url !== '/ws') return reject(socket, 404, 'Not Found');
    if ((origin && !allowed.has(origin)) || (!origin && !allowMissingOrigin)) return reject(socket, 403, 'Forbidden');
    let session = null;
    let match = null;
    let connection = null;
    let authenticating = false;
    let closed = false;
    let expiryTimer;
    let expiresAt = 0;
    const helloTimer = setTimeout(() => connection?.close(4003, 'Authentication timed out.'), 5_000);
    connection = acceptWebSocket(request, socket, head, {
      async onMessage(text) {
        // Upgrade head bytes may already contain hello. Let the transport finish
        // assigning connection before a synchronous reconnect/error response.
        await Promise.resolve();
        if (closed) return;
        const parsed = parseMessage(text);
        if (!parsed.ok) return connection.close(1007, parsed.error);
        const message = parsed.value;
        if (!session) {
          if (authenticating) return connection.close(4003, 'Authentication is already in progress.');
          const allowedFields = ['type', 'roomId', 'resumeToken'];
          if (message.type !== 'hello' || !roomMode(message.roomId) ||
            Object.keys(message).some(key => !allowedFields.includes(key)) ||
            typeof message.resumeToken !== 'string') {
            return connection.close(4003, 'Authenticate before joining.');
          }
          authenticating = true;
          try {
            const gameSession = sessions.resume(message.resumeToken, message.roomId, origin);
            const identity = gameSession.identity;
            const studentId = safeText(identity?.studentId, 96);
            const displayName = safeText(identity?.displayName, 32);
            if (!studentId || !displayName) return connection.close(4003, 'Authentication failed.');
            session = { studentId, displayName, testerAuthorized: identity.testerAuthorized === true };
            expiresAt = gameSession.expiresAt;
            expiryTimer = setTimeout(() => connection.close(4003, 'Game session expired.'), expiresAt - clock());
            match = registry.get(message.roomId);
            clearTimeout(helloTimer);
            connection.send({ type: 'authenticated', resumeToken: gameSession.resumeToken,
              expiresAt, testerAuthorized: session.testerAuthorized });
            match.join(session, connection);
            log('joined', { roomId: message.roomId, studentId });
          } catch {
            connection.close(4003, 'Authentication failed.');
          }
          return;
        }
        if (clock() >= expiresAt) return connection.close(4003, 'Game session expired.');
        match.receive(session.studentId, message);
      },
      onClose() {
        closed = true;
        clearTimeout(helloTimer);
        clearTimeout(expiryTimer);
        connections.delete(connection);
        if (session && match) { match.leave(session.studentId, connection); log('left', { roomId: match.roomId, studentId: session.studentId }); }
      },
    });
    connections.add(connection);
  });
  const cleanupTimer = setInterval(() => { registry.cleanup(); sessions.cleanup(); }, 5_000).unref();
  return {
    server,
    registry,
    async listen(port = 0, host = '127.0.0.1') { await new Promise(resolve => server.listen(port, host, resolve)); return server.address(); },
    async close() {
      clearInterval(cleanupTimer);
      sessions.clear();
      for (const connection of connections) connection.close(1001, 'Server is stopping.');
      for (const socket of rawSockets) socket.destroy();
      await new Promise(resolve => server.close(resolve));
    },
  };
}
