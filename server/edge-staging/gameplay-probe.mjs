// Fixed, private staging scenario. Credentials remain in request-local memory.
// This module is a client of the existing KNAS protocol, not a game authority.
export async function runGameplayProbe(input, connect, {
  clock = () => Date.now(), sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
} = {}) {
  const started = clock();
  const checks = Object.fromEntries(['issuance', 'consume', 'scope', 'replay', 'expiry', 'identity',
    'substitution', 'connection', 'messages', 'sharedState', 'reconnect', 'resumeIdentity'].map(k => [k, false]));
  const sockets = [];
  let clients = 0;
  let stage = 'issuance';
  let failure = null;
  async function open(hello) { const c = await connect(hello); sockets.push(c); return c; }
  async function rejected(hello) {
    const c = await open(hello);
    await c.wait(() => c.closed !== undefined);
    if (c.closed !== 4003) throw new SocketFailure('rejection', c.closed);
    return c.closed === 4003 && !c.messages.some(m => m.type === 'welcome');
  }
  function must(value) { if (!value) throw new Error('Probe assertion failed'); }
  const hello = { type: 'hello', roomId: 'classroom', accessToken: input.active.accessToken };
  try {
    checks.issuance = [input.active, input.expiring].every(g =>
      g.audience === 'moshroids' && /^ml1_[a-f0-9]{64}$/.test(g.accessToken) &&
      Date.parse(g.expiresAt) > clock() && Date.parse(g.expiresAt) <= clock() + 60_000);
    must(checks.issuance);
    stage = 'substitution';
    checks.substitution = await rejected({ ...hello, studentId: 'not-the-authorized-student', testerAuthorized: true });
    must(checks.substitution);
    stage = 'scope';
    checks.scope = await rejected({ ...hello, roomId: 'classroom-teams' });
    must(checks.scope);
    stage = 'connection';
    const c = await open(hello);
    await c.wait(() => c.messages.some(m => m.type === 'ready'));
    const welcome = c.messages.find(m => m.type === 'welcome');
    const auth = c.messages.find(m => m.type === 'authenticated');
    checks.connection = !!welcome && !!auth;
    checks.consume = checks.connection;
    checks.identity = welcome?.studentId === input.expectedId && auth?.testerAuthorized === true;
    must(checks.identity);
    clients = 1;
    stage = 'replay';
    checks.replay = await rejected(hello);
    must(checks.replay);
    stage = 'messages';
    c.send({ type: 'heartbeat', sentAt: 101 });
    await c.wait(() => c.messages.some(m => m.type === 'heartbeat' && m.sentAt === 101));
    const tag = crypto.randomUUID();
    const asteroidId = 'epoch-' + Math.floor(welcome.serverNow / 1800000) + '-staging-' + tag;
    async function action(socket, action, data, requestId) {
      socket.send({ type: 'action', action, data, requestId });
      await socket.wait(() => socket.messages.some(m => m.type === 'result' && m.requestId === requestId));
      return socket.messages.find(m => m.type === 'result' && m.requestId === requestId)?.ok === true;
    }
    must(await action(c, 'asteroidClaim', { id: asteroidId }, 'asteroid'));
    must(await action(c, 'dropPublish', { drops: [{ id: tag, x: 12, y: 34 }] }, 'drop'));
    must(await action(c, 'dropClaim', { id: tag }, 'claim'));
    must(!await action(c, 'dropClaim', { id: tag }, 'claim-again'));
    checks.messages = true;
    stage = 'sharedState';
    await c.wait(() => c.messages.some(m => m.channel === 'asteroids' &&
      m.entries?.some(([id, row]) => id === asteroidId && row.destroyedBy === input.expectedId)));
    c.close();
    await c.wait(() => c.closed !== undefined);
    stage = 'reconnect';
    const resumed = await open({ type: 'hello', roomId: 'classroom', resumeToken: auth.resumeToken });
    await resumed.wait(() => resumed.messages.some(m => m.type === 'ready'));
    checks.reconnect = true;
    checks.resumeIdentity = resumed.messages.find(m => m.type === 'welcome')?.studentId === input.expectedId;
    checks.sharedState = resumed.messages.some(m => m.channel === 'asteroids' &&
      m.entries?.some(([id, row]) => id === asteroidId && row.destroyedBy === input.expectedId));
    must(checks.resumeIdentity && checks.sharedState);
    resumed.close();
    await resumed.wait(() => resumed.closed !== undefined);
    // Natural expiry, with no TTL/configuration/data changes and no invented tokens.
    stage = 'expiry';
    await sleep(Math.max(0, Date.parse(input.expiring.expiresAt) - clock() + 1200));
    checks.expiry = await rejected({ type: 'hello', roomId: 'classroom', accessToken: input.expiring.accessToken });
  } catch (error) {
    // Never return exception messages, request bodies, identity or credentials.
    failure = { stage, ...transportFailure(error) };
  } finally {
    for (const socket of sockets) socket.close();
  }
  return { checks, clientCount: clients, durationMs: clock() - started, failure };
}

class UpgradeFailure extends Error {
  constructor(status) { super('Upgrade unavailable'); this.status = status; }
}
class SocketFailure extends Error {
  constructor(boundary, closeCode) { super('Socket unavailable'); this.boundary = boundary; this.closeCode = closeCode; }
}

// Cloudflare's documented VPC error codes only, never arbitrary exception text.
function transportFailure(error) {
  if (error instanceof UpgradeFailure) return { upgradeStatus: error.status };
  if (error instanceof SocketFailure) return { socketBoundary: error.boundary,
    ...(Number.isInteger(error.closeCode) ? { closeCode: error.closeCode } : {}) };
  const codes = ['connection_refused', 'connection_terminated', 'connection_timeout',
    'connection_limit_reached', 'destination_unavailable', 'destination_not_found',
    'destination_ip_prohibited', 'destination_ip_unroutable', 'proxy_loop_detected',
    'dns_error', 'dns_timeout', 'tls_protocol_error', 'tls_certificate_error',
    'http_request_error', 'http_upgrade_failed', 'http_request_denied',
    'http_protocol_error', 'http_response_incomplete', 'connection_read_timeout',
    'connection_write_timeout', 'rate_limited', 'proxy_internal_error'];
  const code = codes.find(code => String(error?.message || '').includes(code));
  return code ? { vpcError: code } : {};
}

export async function connectPrivate(binding, hello) {
  let resumeToken = hello.resumeToken;
  if (typeof hello.accessToken === 'string') {
    const body = { token: hello.accessToken, roomId: hello.roomId };
    for (const [key, value] of Object.entries(hello)) {
      if (!['type', 'accessToken', 'roomId'].includes(key)) body[key] = value;
    }
    const response = await binding.fetch(new Request('http://moshroids-realtime:8794/api/launch/redeem', {
      method: 'POST',
      headers: { 'content-type': 'application/json', Origin: 'https://mrjkirby.github.io' },
      body: JSON.stringify(body),
      redirect: 'manual',
    }));
    if ([400, 401, 403].includes(response.status)) return rejectedClient();
    if (!response.ok) throw new UpgradeFailure(response.status);
    const result = await response.json();
    if (result?.ok !== true || typeof result.sessionToken !== 'string' ||
        !/^mr1_[a-f0-9]{64}$/.test(result.sessionToken)) throw new UpgradeFailure(502);
    resumeToken = result.sessionToken;
  }
  if (typeof resumeToken !== 'string' || !/^mr1_[a-f0-9]{64}$/.test(resumeToken)) {
    return rejectedClient();
  }
  const key = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
  const response = await binding.fetch(new Request('http://moshroids-realtime:8794/ws', {
    headers: { Upgrade: 'websocket', Connection: 'Upgrade', Origin: 'https://mrjkirby.github.io',
      'Sec-WebSocket-Key': key, 'Sec-WebSocket-Version': '13' }, redirect: 'manual',
  }));
  const ws = response.webSocket;
  if (response.status !== 101 || !ws) throw new UpgradeFailure(response.status);
  const client = {
    messages: [], closed: undefined,
    send: value => ws.send(JSON.stringify(value)),
    close: () => { try { ws.close(1000, 'Staging check complete'); } catch {} },
    async wait(predicate) {
      const deadline = Date.now() + 10_000;
      while (!predicate()) {
        if (Date.now() > deadline) {
          if (client.errorObserved) throw new SocketFailure('error');
          throw new Error('Probe timed out');
        }
        await new Promise(resolve => setTimeout(resolve, 25));
      }
    },
  };
  ws.addEventListener('message', event => {
    try { if (client.messages.length < 256) client.messages.push(JSON.parse(event.data)); }
    catch { client.close(); }
  });
  ws.addEventListener('close', event => { client.closed = event.code; });
  ws.addEventListener('error', () => { client.errorObserved = true; });
  try { ws.accept(); } catch { throw new SocketFailure('accept'); }
  try { client.send({ type: 'hello', roomId: hello.roomId, resumeToken }); } catch { throw new SocketFailure('send'); }
  return client;
}

function rejectedClient() {
  return { messages: [], closed: 4003, send() {}, close() {}, async wait() {} };
}
