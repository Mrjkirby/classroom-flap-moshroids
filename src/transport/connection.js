export function isLaunchGrant(grant, roomId, now = Date.now()) {
  if (!grant || typeof grant !== 'object' || grant.ok === false ||
      grant.audience !== 'moshroids' || typeof grant.accessToken !== 'string' ||
      !/^ml1_[a-f0-9]{64}$/.test(grant.accessToken) ||
      typeof grant.expiresAt !== 'string' ||
      (grant.roomId !== undefined && grant.roomId !== roomId)) return false;
  const expiresAt = Date.parse(grant.expiresAt);
  if (!Number.isFinite(expiresAt) || expiresAt <= now || expiresAt > now + 120_000) return false;
  return true;
}

export class RealtimeConnection {
  constructor({ url, roomId, requestLaunch, WebSocketClass = globalThis.WebSocket,
    fetcher = globalThis.fetch, storage = globalThis.sessionStorage,
    onMessage = () => {}, onStatus = () => {} }) {
    const parsed = new URL(url);
    if (parsed.username || parsed.password || parsed.search || parsed.hash ||
        !(parsed.protocol === 'wss:' || (parsed.protocol === 'ws:' && ['127.0.0.1', 'localhost'].includes(parsed.hostname))))
      throw new Error('A secure credential-free WSS endpoint is required.');
    Object.assign(this, { url, roomId, requestLaunch, WebSocketClass, fetcher, storage, onMessage, onStatus });
    this.sessionKey = `moshroids.game-session.${roomId}`;
    this.pending = new Map(); this.sequence = 0; this.stopped = true;
  }
  loadSession() {
    if (!this.storage || this.requestLaunch?.hasNewLaunch) return;
    try {
      const saved = JSON.parse(this.storage.getItem(this.sessionKey));
      if (typeof saved?.token === 'string' && /^mr1_[a-f0-9]{64}$/.test(saved.token) &&
          Number.isFinite(saved.expiresAt) && saved.expiresAt > Date.now()) {
        this.resumeToken = saved.token;
        this.expiresAt = saved.expiresAt;
      } else this.storage.removeItem(this.sessionKey);
    } catch {
      this.clearSession();
      this.onStatus(false, 'Unable to restore the temporary game session.');
    }
  }
  saveSession(token, expiresAt) {
    if (!this.storage) return;
    try { this.storage.setItem(this.sessionKey, JSON.stringify({ token, expiresAt })); }
    catch { this.onStatus(false, 'Unable to keep the temporary game session for reconnect.'); }
  }
  clearSession() {
    this.resumeToken = null;
    this.expiresAt = 0;
    try { this.storage?.removeItem(this.sessionKey); }
    catch { this.onStatus(false, 'Unable to clear the temporary game session.'); }
  }
  async redeem(grant) {
    if (typeof this.fetcher !== 'function') throw new Error('Launch redemption is unavailable.');
    const endpoint = new URL(this.url);
    endpoint.protocol = endpoint.protocol === 'wss:' ? 'https:' : 'http:';
    endpoint.pathname = '/api/launch/redeem';
    endpoint.search = '';
    endpoint.hash = '';
    const response = await this.fetcher(endpoint, {
      method: 'POST',
      mode: 'cors',
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: grant.accessToken, roomId: this.roomId }),
    });
    const result = await response.json();
    if (!response.ok || result?.ok !== true ||
        typeof result.sessionToken !== 'string' || !/^mr1_[a-f0-9]{64}$/.test(result.sessionToken) ||
        !Number.isFinite(result.expiresAt) || result.expiresAt <= Date.now() ||
        result.expiresAt > Date.now() + 5 * 60_000) {
      throw new Error('Launch token redemption failed.');
    }
    this.resumeToken = result.sessionToken;
    this.expiresAt = result.expiresAt;
    this.saveSession(this.resumeToken, this.expiresAt);
  }
  start() { this.stopped = false; return this.connect(); }
  async connect() {
    if (this.stopped) return;
    this.onStatus(false, 'Connecting…');
    try {
      this.loadSession();
      if (!this.resumeToken || Date.now() >= this.expiresAt) {
        this.clearSession();
        if (typeof this.requestLaunch !== 'function') throw new Error('Classroom launch is not configured.');
        const grant = await this.requestLaunch(this.roomId);
        if (!isLaunchGrant(grant, this.roomId)) throw new Error('Invalid classroom grant.');
        await this.redeem(grant);
      }
    } catch {
      this.onStatus(false, 'Classroom launch unavailable. Reopen from your existing classroom session.');
      return; // Fail closed; never fall back to anonymous Firebase identity.
    }
    if (this.stopped) return;
    const socket = this.socket = new this.WebSocketClass(this.url);
    socket.addEventListener('open', () => {
      socket.send(JSON.stringify({ type: 'hello', roomId: this.roomId, resumeToken: this.resumeToken }));
    });
    socket.addEventListener('message', event => {
      let value;
      try { value = JSON.parse(event.data); } catch { socket.close(); return; }
      if (value.type === 'authenticated') {
        if (typeof value.resumeToken !== 'string' || !/^mr1_[a-f0-9]{64}$/.test(value.resumeToken) ||
            !Number.isFinite(value.expiresAt) || value.expiresAt <= Date.now()) {
          this.clearSession();
          socket.close();
          return;
        }
        this.resumeToken = value.resumeToken;
        this.expiresAt = value.expiresAt;
        this.saveSession(this.resumeToken, this.expiresAt);
      }
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
      if (event.code === 4003) {
        this.clearSession();
        this.onStatus(false, 'Game session expired or rejected. Reopen MOSHROIDS from your classroom portal.');
        return;
      }
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
