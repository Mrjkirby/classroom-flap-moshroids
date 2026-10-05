import http from 'node:http';
import { acceptWebSocket } from './websocket.mjs';
import { parseMessage, roomMode, safeText } from './protocol.mjs';
import { MatchRegistry } from './match.mjs';

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
    const helloTimer = setTimeout(() => connection?.close(4003, 'Authentication timed out.'), 5_000);
    connection = acceptWebSocket(request, socket, head, {
      async onMessage(text) {
        const parsed = parseMessage(text);
        if (!parsed.ok) return connection.close(1007, parsed.error);
        const message = parsed.value;
        if (!session) {
          if (authenticating) return connection.close(4003, 'Authentication is already in progress.');
          if (message.type !== 'hello' || !roomMode(message.roomId) || typeof message.accessToken !== 'string') {
            return connection.close(4003, 'Authenticate before joining.');
          }
          authenticating = true;
          try {
            const identity = await authenticate({ accessToken: message.accessToken, roomId: message.roomId, origin });
            const studentId = safeText(identity?.studentId, 96);
            const displayName = safeText(identity?.displayName, 32);
            if (!studentId || !displayName) return connection.close(4003, 'Authentication failed.');
            session = { studentId, displayName };
            match = registry.get(message.roomId);
            clearTimeout(helloTimer);
            match.join(session, connection);
            log('joined', { roomId: message.roomId, studentId });
          } catch {
            connection.close(4003, 'Authentication failed.');
          }
          return;
        }
        match.receive(session.studentId, message);
      },
      onClose() {
        clearTimeout(helloTimer);
        connections.delete(connection);
        if (session && match) { match.leave(session.studentId, connection); log('left', { roomId: match.roomId, studentId: session.studentId }); }
      },
    });
    connections.add(connection);
  });
  const cleanupTimer = setInterval(() => registry.cleanup(), 5_000).unref();
  return {
    server,
    registry,
    async listen(port = 0, host = '127.0.0.1') { await new Promise(resolve => server.listen(port, host, resolve)); return server.address(); },
    async close() {
      clearInterval(cleanupTimer);
      for (const connection of connections) connection.close(1001, 'Server is stopping.');
      for (const socket of rawSockets) socket.destroy();
      await new Promise(resolve => server.close(resolve));
    },
  };
}
