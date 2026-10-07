// Synthetic identities only; never imported by the production entrypoint.
import { createMoshroidsServer } from '../src/app.mjs';
process.once('message', async ({ grants }) => {
  const tokens = new Map(grants.map(grant => [grant.token, grant]));
  const app = createMoshroidsServer({ allowMissingOrigin: true, authenticate: async ({ accessToken, roomId }) => {
    const grant = tokens.get(accessToken); tokens.delete(accessToken);
    if (!grant || grant.roomId !== roomId) throw new Error('Invalid fixture grant');
    return { studentId: grant.id, displayName: grant.id };
  } });
  const address = await app.listen();
  const began = process.cpuUsage(); let peakRss = 0;
  const sampler = setInterval(() => { peakRss = Math.max(peakRss, process.memoryUsage().rss); }, 100);
  process.send({ port: address.port });
  process.once('message', async () => {
    clearInterval(sampler);
    process.send({ cpuMicros: process.cpuUsage(began), peakRss, heapUsed: process.memoryUsage().heapUsed });
    await app.close(); process.disconnect();
  });
});
