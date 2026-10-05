import { createMoshroidsServer } from './src/app.mjs';
import { configuredAuthenticator } from './src/auth/config.mjs';

const origins = (process.env.MOSHROIDS_ALLOWED_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean);
const port = Number(process.env.PORT || 8794);

if (!origins.length) throw new Error('MOSHROIDS_ALLOWED_ORIGINS must list the exact HTTPS game origins before this service can start.');

const server = createMoshroidsServer({
  allowedOrigins: origins,
  authenticate: configuredAuthenticator(),
  log: (event, detail) => console.info(`[moshroids] ${event}`, detail),
});

await server.listen(port, '127.0.0.1');
console.info(`[moshroids] listening on 127.0.0.1:${port}`);
