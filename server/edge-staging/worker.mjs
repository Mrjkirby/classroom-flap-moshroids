// Transport-only edge. Classroom identity and all game state remain on KNAS.
import { verifyBridge } from './verify-bridge.mjs';
const ALLOWED_ORIGIN = 'https://mrjkirby.github.io';
const PRIVATE_WS_URL = 'http://172.22.0.4:8794/ws';

function deny(status, text) {
  return new Response(text, { status, headers: { 'cache-control': 'no-store' } });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.search && url.pathname === '/verify') return verifyBridge(request, env);
    if (url.search || !['/health', '/ws'].includes(url.pathname)) return deny(404, 'Not found');
    if (request.method !== 'GET') return deny(405, 'Method not allowed');
    const origin = request.headers.get('Origin');
    if (origin && origin !== ALLOWED_ORIGIN) return deny(403, 'Forbidden');
    if (url.pathname === '/ws') {
      if (origin !== ALLOWED_ORIGIN) return deny(403, 'Forbidden');
      if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return deny(426, 'WebSocket required');
    } else if (request.headers.has('Upgrade')) return deny(400, 'Invalid upgrade');

    // Never accept a user-supplied target or forward browser credentials to KNAS.
    const headers = new Headers();
    for (const name of ['Origin', 'Upgrade', 'Connection', 'Sec-WebSocket-Key', 'Sec-WebSocket-Version']) {
      const value = request.headers.get(name);
      if (value !== null) headers.set(name, value);
    }
    try {
      if (url.pathname === '/ws') {
        return await env.MOSHROIDS_VPC.fetch(new Request(PRIVATE_WS_URL, {
          method: 'GET', headers, redirect: 'manual',
        }));
      }
      return await env.MOSHROIDS.fetch(new Request('http://moshroids-realtime:8794/health', {
        method: 'GET', headers, redirect: 'manual',
      }));
    } catch {
      // No internal network details, tokens, request bodies, or exception logs.
      return deny(502, 'MOSHROIDS staging origin unavailable');
    }
  },
};
