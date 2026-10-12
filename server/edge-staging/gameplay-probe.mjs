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
  async function open(hello) { const c = await connect(hello); sockets.push(c); return c; }
  async function rejected(hello) {
    const c = await open(hello);
    await c.wait(() => c.closed !== undefined);
    return c.closed === 4003 && !c.messages.some(m => m.type === 'welcome');
  }
  function must(value) { if (!value) throw new Error('Probe assertion failed'); }
  const hello = { type: 'hello', roomId: 'classroom', accessToken: input.active.accessToken };
  try {
    checks.issuance = [input.active, input.expiring].every(g =>
      g.audience === 'moshroids' && /^ml1_[a-f0-9]{64}$/.test(g.accessToken) &&
      Date.parse(g.expiresAt) > clock() && Date.parse(g.expiresAt) <= clock() + 60_000);
    must(checks.issuance);
    checks.substitution = await rejected({ ...hello, studentId: 'not-the-authorized-student', testerAuthorized: true });
    must(checks.substitution);
    checks.scope = await rejected({ ...hello, roomId: 'classroom-teams' });
    must(checks.scope);
    const c = await open(hello);
    await c.wait(() => c.messages.some(m => m.type === 'ready'));
    const welcome = c.messages.find(m => m.type === 'welcome');
    const auth = c.messages.find(m => m.type === 'authenticated');
    checks.connection = !!welcome && !!auth;
    checks.consume = checks.connection;
    checks.identity = welcome?.studentId === input.expectedId && auth?.testerAuthorized === true;
    must(checks.identity);
    clients = 1;
    checks.replay = await rejected(hello);
    must(checks.replay);
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
    await c.wait(() => c.messages.some(m => m.channel === 'asteroids' &&
      m.entries?.some(([id, row]) => id === asteroidId && row.destroyedBy === input.expectedId)));
    c.close();
    await c.wait(() => c.closed !== undefined);
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
    await sleep(Math.max(0, Date.parse(input.expiring.expiresAt) - clock() + 1200));
    checks.expiry = await rejected({ type: 'hello', roomId: 'classroom', accessToken: input.expiring.accessToken });
  } catch {
    // Never return exception messages, request bodies, identity or credentials.
  } finally {
    for (const socket of sockets) socket.close();
  }
  return { checks, clientCount: clients, durationMs: clock() - started };
}

export async function connectPrivate(binding, hello) {
  const response = await binding.fetch(new Request('http://moshroids-auth-staging:8794/ws', {
    headers: { Upgrade: 'websocket', Origin: 'https://mrjkirby.github.io' }, redirect: 'manual',
  }));
  const ws = response.webSocket;
  if (response.status !== 101 || !ws) throw new Error('Upgrade unavailable');
  const client = {
    messages: [], closed: undefined,
    send: value => ws.send(JSON.stringify(value)),
    close: () => { try { ws.close(1000, 'Staging check complete'); } catch {} },
    async wait(predicate) {
      const deadline = Date.now() + 10_000;
      while (!predicate()) {
        if (Date.now() > deadline) throw new Error('Probe timed out');
        await new Promise(resolve => setTimeout(resolve, 25));
      }
    },
  };
  ws.addEventListener('message', event => {
    try { if (client.messages.length < 256) client.messages.push(JSON.parse(event.data)); }
    catch { client.close(); }
  });
  ws.addEventListener('close', event => { client.closed = event.code; });
  ws.addEventListener('error', () => { client.closed = 1006; });
  ws.accept();
  client.send(hello);
  return client;
}
