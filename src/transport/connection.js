// Credentials live in this connection object only, never URLs or storage.
export class RealtimeConnection {
  constructor({ url, roomId, requestLaunch, WebSocketClass = globalThis.WebSocket, onMessage = () => {}, onStatus = () => {} }) {
    const parsed = new URL(url);
    if (parsed.username || parsed.password || parsed.search || parsed.hash ||
        !(parsed.protocol === 'wss:' || (parsed.protocol === 'ws:' && ['127.0.0.1', 'localhost'].includes(parsed.hostname))))
      throw new Error('A secure credential-free WSS endpoint is required.');
    Object.assign(this, { url, roomId, requestLaunch, WebSocketClass, onMessage, onStatus });
    this.pending = new Map(); this.sequence = 0; this.stopped = true;
  }
  start() { this.stopped = false; return this.connect(); }
  async connect() {
    if (this.stopped) return;
    this.onStatus(false, 'Connecting…');
    let hello;
    try {
      if (this.resumeToken && Date.now() < this.expiresAt)
        hello = { resumeToken: this.resumeToken };
      else {
        if (typeof this.requestLaunch !== 'function') throw new Error('Classroom launch is not configured.');
        const grant = await this.requestLaunch(this.roomId);
        if (!grant?.accessToken) throw new Error('No classroom grant.');
        hello = { accessToken: grant.accessToken };
      }
    } catch {
      this.onStatus(false, 'Classroom launch unavailable. Reopen from your existing classroom session.');
      return; // Fail closed; never fall back to anonymous Firebase identity.
    }
    if (this.stopped) return;
    const socket = this.socket = new this.WebSocketClass(this.url);
    socket.addEventListener('open', () => { socket.send(JSON.stringify({ type: 'hello', roomId: this.roomId, ...hello })); hello = null; });
    socket.addEventListener('message', event => {
      let value;
      try { value = JSON.parse(event.data); } catch { socket.close(); return; }
      if (value.type === 'authenticated') { this.resumeToken = value.resumeToken; this.expiresAt = value.expiresAt; }
      if (value.type === 'ready') {
        this.ready = true; this.attempts = 0; this.onStatus(true, 'Connected');
        clearInterval(this.heartbeat);
        this.heartbeat = setInterval(() => this.send({ type: 'heartbeat', sentAt: Date.now() }), 5000);
        this.send({ type: 'heartbeat', sentAt: Date.now() });
      }
      if (value.type === 'result') {
        const pending = this.pending.get(value.requestId);
        if (pending) { clearTimeout(pending.timer); this.pending.delete(value.requestId); pending.resolve(value.ok === true); }
      }
      this.onMessage(value);
    });
    socket.addEventListener('close', event => {
      this.ready = false; clearInterval(this.heartbeat);
      for (const item of this.pending.values()) { clearTimeout(item.timer); item.resolve(false); }
      this.pending.clear();
      this.onStatus(false, 'Disconnected');
      if (this.stopped || event.code === 4001 || event.code === 4004) return;
      if (event.code === 4003) this.resumeToken = null;
      // Never replay state-changing actions after an ambiguous disconnect.
      this.attempts = (this.attempts || 0) + 1;
      if (this.attempts <= 5) this.retry = setTimeout(() => this.connect(), Math.min(1000 * 2 ** (this.attempts - 1), 10000));
      else this.onStatus(false, 'Connection unavailable. Reopen from your classroom session.');
    });
    socket.addEventListener('error', () => this.onStatus(false, 'Connection unavailable'));
  }
  send(value) {
    if (!this.ready || this.socket?.readyState !== 1 || this.socket.bufferedAmount > 65536) return false;
    this.socket.send(JSON.stringify(value)); return true;
  }
  request(action, data = {}) {
    if (!this.ready || this.pending.size >= 128) return Promise.resolve(false);
    const requestId = String(++this.sequence);
    return new Promise(resolve => {
      const timer = setTimeout(() => { this.pending.delete(requestId); resolve(false); }, 5000);
      this.pending.set(requestId, { resolve, timer });
      if (!this.send({ type: 'action', action, data, requestId })) {
        clearTimeout(timer); this.pending.delete(requestId); resolve(false);
      }
    });
  }
  stop() { this.stopped = true; this.resumeToken = null; clearTimeout(this.retry); clearInterval(this.heartbeat); this.socket?.close(); }
}
