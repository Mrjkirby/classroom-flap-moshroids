import http from 'node:http';
import { acceptWebSocket } from './websocket.mjs';
import { parseMessage, roomMode, safeText } from './protocol.mjs';
import { MatchRegistry } from './match.mjs';
import { createGameSessions } from './auth/game-sessions.mjs';

function reject(socket, status, message) {
  socket.end(`HTTP/1.1 ${status} ${message}\r\nConnection: close\r\n\r\n`);
}

export function createMoshroidsServer({
  authenticate,
  allowedOrigins = [],
  allowMissingOrigin = false,
  clock = () => Date.now(),
  log = () => {},
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
      return response.end(JSON.stringify({ ok: true, serverNow: clock(), ...registry.status() }));
    }
    response.writeHead(404).end();
  });
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
          const allowedFields = ['type', 'roomId', 'accessToken', 'resumeToken'];
          if (message.type !== 'hello' || !roomMode(message.roomId) ||
            Object.keys(message).some(key => !allowedFields.includes(key)) ||
            (typeof message.accessToken === 'string') === (typeof message.resumeToken === 'string')) {
            return connection.close(4003, 'Authenticate before joining.');
          }
          authenticating = true;
          try {
            let gameSession;
            if (typeof message.resumeToken === 'string') {
              gameSession = sessions.resume(message.resumeToken, message.roomId, origin);
            } else {
              const identity = await authenticate({ accessToken: message.accessToken, roomId: message.roomId, origin });
              if (closed) return;
              if (!identity?.studentId || !identity?.displayName) throw new Error('Invalid identity.');
              gameSession = sessions.create(identity, message.roomId, origin);
            }
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
