import { createHash } from 'node:crypto';

const MAX_FRAME_BYTES = 16 * 1024;

export function acceptWebSocket(request, socket, head, { onMessage, onClose }) {
  const key = request.headers['sec-websocket-key'];
  if (typeof key !== 'string') return false;
  const accept = createHash('sha1').update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
  socket.write([
    'HTTP/1.1 101 Switching Protocols',
    'Upgrade: websocket',
    'Connection: Upgrade',
    `Sec-WebSocket-Accept: ${accept}`,
    '', '',
  ].join('\r\n'));

  let pending = head.length ? Buffer.from(head) : Buffer.alloc(0);
  let closed = false;
  const closeOnce = () => {
    if (closed) return;
    closed = true;
    onClose?.();
  };
  const connection = {
    send(value) {
      if (closed || socket.destroyed) return;
      const body = Buffer.from(JSON.stringify(value));
      if (body.length > MAX_FRAME_BYTES) return;
      const header = body.length < 126
        ? Buffer.from([0x81, body.length])
        : Buffer.from([0x81, 126, body.length >> 8, body.length & 0xff]);
      socket.write(Buffer.concat([header, body]));
    },
    close(code = 1000, reason = '') {
      if (closed) return;
      const detail = Buffer.from(String(reason).slice(0, 120));
      const body = Buffer.alloc(2 + detail.length);
      body.writeUInt16BE(code, 0);
      detail.copy(body, 2);
      socket.write(Buffer.concat([Buffer.from([0x88, body.length]), body]));
      socket.end();
      closeOnce();
    },
  };

  const consume = () => {
    while (pending.length >= 2 && !closed) {
      const first = pending[0];
      const second = pending[1];
      const opcode = first & 0x0f;
      const masked = (second & 0x80) !== 0;
      let length = second & 0x7f;
      let offset = 2;
      if ((first & 0x80) === 0 || !masked) return connection.close(1002, 'Unsupported frame.');
      if (length === 126) {
        if (pending.length < 4) return;
        length = pending.readUInt16BE(2); offset = 4;
      } else if (length === 127) return connection.close(1009, 'Frame too large.');
      if (length > MAX_FRAME_BYTES) return connection.close(1009, 'Frame too large.');
      if (pending.length < offset + 4 + length) return;
      const mask = pending.subarray(offset, offset + 4);
      const payload = Buffer.from(pending.subarray(offset + 4, offset + 4 + length));
      pending = pending.subarray(offset + 4 + length);
      for (let index = 0; index < payload.length; index += 1) payload[index] ^= mask[index % 4];
      if (opcode === 0x8) return connection.close();
      if (opcode === 0x9) { socket.write(Buffer.from([0x8a, payload.length, ...payload])); continue; }
      if (opcode !== 0x1) return connection.close(1003, 'Text messages only.');
      onMessage?.(payload.toString('utf8'), connection);
    }
  };
  socket.on('data', data => { pending = Buffer.concat([pending, data]); consume(); });
  socket.on('error', closeOnce);
  socket.on('close', closeOnce);
  consume();
  return connection;
}
