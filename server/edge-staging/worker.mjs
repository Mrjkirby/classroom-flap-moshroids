// Transport-only edge. Classroom identity and all game state remain on KNAS.
import { verifyBridge } from './verify-bridge.mjs';
const ALLOWED_ORIGIN = 'https://mrjkirby.github.io';

function deny(status, text) {
  return new Response(text, { status, headers: { 'cache-control': 'no-store' } });
}

async function readBoundedBody(body, limit) {
  if (!body) return '';
  const reader = body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw new Error('Request body too large.');
    }
    chunks.push(value);
  }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(result);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.search && url.pathname === '/verify') return verifyBridge(request, env);
    if (url.search || !['/health', '/ws', '/api/launch/redeem'].includes(url.pathname)) return deny(404, 'Not found');
    if (url.pathname === '/api/launch/redeem') {
      const origin = request.headers.get('Origin');
      if (origin !== ALLOWED_ORIGIN || request.headers.has('Cookie') ||
          request.headers.has('Authorization')) return deny(403, 'Forbidden');
      if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: {
          'access-control-allow-origin': ALLOWED_ORIGIN,
          'access-control-allow-methods': 'POST',
          'access-control-allow-headers': 'content-type',
          'access-control-max-age': '600',
          'cache-control': 'no-store',
          vary: 'Origin',
        } });
      }
      if (request.method !== 'POST') return deny(405, 'Method not allowed');
      if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type') || '')) {
        return deny(415, 'JSON required');
      }
      try {
        const body = await readBoundedBody(request.body, 2048);
        if (!body) return deny(400, 'Invalid request');
        const headers = new Headers({ 'Content-Type': 'application/json', Origin: ALLOWED_ORIGIN });
        return await env.MOSHROIDS_AUTH_STAGING.fetch(new Request(
          'http://moshroids-realtime:8794/api/launch/redeem',
          { method: 'POST', headers, body, redirect: 'manual' },
        ));
      } catch (error) {
        if (error?.message === 'Request body too large.') return deny(413, 'Request too large');
        return deny(502, 'MOSHROIDS staging origin unavailable');
      }
    }
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
        return await env.MOSHROIDS_AUTH_STAGING.fetch(new Request('http://moshroids-realtime:8794/ws', {
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
