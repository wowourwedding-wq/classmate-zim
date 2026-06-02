/* ClassMate Zim — Cloudflare Worker.
   Mostly serves static assets (the planner SPA). Adds one extra route:
   /zimsec-proxy?url=https%3A%2F%2Fwww5.zimsec.co.zw%2F...

   The proxy fetches ZIMSEC's public PDFs server-side and re-serves them
   from the app's origin. Why a proxy at all?
     1. The browser's Service Worker only sees same-origin requests, so the
        only way to cache ZIMSEC PDFs on the device (for offline use) is to
        make them look like same-origin assets.
     2. CORS — direct cross-origin fetches from JS to ZIMSEC are blocked
        for response-body reads; proxying gives us a clean, taggable URL.

   Security: this proxy ONLY accepts ZIMSEC URLs. Anything else returns 403,
   so it can't be abused as an open proxy.

   Caching: Cloudflare's edge caches each PDF for 24h (cf.cacheTtl), and the
   client gets a 30-day Cache-Control so the browser keeps it locally.
*/

const ALLOWED_HOSTS = new Set(['www5.zimsec.co.zw']);

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Proxy endpoint for ZIMSEC PDFs
    if (url.pathname === '/zimsec-proxy' || url.pathname === '/zimsec-proxy/') {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return new Response('Method not allowed', { status: 405 });
      }
      const target = url.searchParams.get('url');
      if (!target) return new Response('Missing url parameter', { status: 400 });

      let parsed;
      try { parsed = new URL(target); }
      catch { return new Response('Invalid url', { status: 400 }); }

      if (!ALLOWED_HOSTS.has(parsed.hostname)) {
        return new Response('Forbidden: only ZIMSEC URLs allowed', { status: 403 });
      }

      try {
        const upstream = await fetch(parsed.toString(), {
          method: request.method,
          headers: {
            'User-Agent': 'ClassMate-Zim/1.0 (+offline-pdf-cache; teachers)',
            'Accept': 'application/pdf,*/*'
          },
          redirect: 'follow',
          cf: { cacheTtl: 86400, cacheEverything: true }
        });

        const headers = new Headers();
        const passthrough = ['content-type','content-length','content-disposition','last-modified','etag'];
        for (const k of passthrough) {
          const v = upstream.headers.get(k);
          if (v) headers.set(k, v);
        }
        headers.set('Access-Control-Allow-Origin', '*');
        headers.set('Cache-Control', 'public, max-age=2592000, immutable');
        headers.set('X-Proxied-From', parsed.hostname);

        return new Response(upstream.body, {
          status: upstream.status,
          statusText: upstream.statusText,
          headers
        });
      } catch (e) {
        return new Response('Upstream fetch failed: ' + e.message, {
          status: 502,
          headers: { 'content-type': 'text/plain' }
        });
      }
    }

    // Everything else: static asset fallback
    return env.ASSETS.fetch(request);
  }
};
