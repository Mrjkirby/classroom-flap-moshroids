import { createMoshroidsServer } from './src/app.mjs';
import { configuredAuthenticator } from './src/auth/config.mjs';

const origins = (process.env.MOSHROIDS_ALLOWED_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean);
const port = Number(process.env.PORT || 8794);
const standby = process.env.MOSHROIDS_STANDBY === 'true';
const host = process.env.BIND_HOST || '127.0.0.1';

if (!origins.length) throw new Error('MOSHROIDS_ALLOWED_ORIGINS must list the exact HTTPS game origins before this service can start.');

const server = createMoshroidsServer({
  allowedOrigins: origins,
  authenticate: standby ? async () => { throw new Error('Classroom issuer not configured.'); } : configuredAuthenticator(),
  ready: !standby,
  log: (event, detail) => console.info(`[moshroids] ${event}`, detail),
});

await server.listen(port, host);
console.info(`[moshroids] listening on ${host}:${port}; classroomReady=${!standby}`);
for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, async () => { await server.close(); process.exit(0); });
