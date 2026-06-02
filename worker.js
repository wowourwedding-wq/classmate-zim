/* ClassMate Zim — Cloudflare Worker.
   Serves static assets + proxies ZIMSEC PDF requests.

   ZIMSEC publishes papers via WordPress Download Manager. The catalog links
   to /download/<slug>/ pages that contain a hidden `?wpdmdl=<id>` button —
   THAT is the URL that returns the actual PDF binary. So the proxy:
     1. Receives /zimsec-proxy?url=https://www5.zimsec.co.zw/download/<slug>/
     2. Fetches that page server-side, grep's the wpdmdl=<id>
     3. Fetches /?wpdmdl=<id> (returns the PDF)
     4. Strips Content-Disposition: attachment so the PDF opens INLINE in a tab
        instead of forcing a download dialog
     5. Returns to caller with long Cache-Control so the Service Worker can
        store it for offline use
*/

const ALLOWED_HOSTS = new Set(['www5.zimsec.co.zw']);

async function fetchUpstream(targetUrl) {
  return fetch(targetUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; ClassMate-Zim/1.0; +offline-cache)',
      'Accept': 'application/pdf,text/html;q=0.9,*/*;q=0.8'
    },
    redirect: 'follow',
    cf: { cacheTtl: 86400, cacheEverything: true }
  });
}

async function findWpdmdlId(downloadPageUrl) {
  const resp = await fetchUpstream(downloadPageUrl);
  if (!resp.ok) return null;
  const html = await resp.text();
  /* Look for any wpdmdl=<digits> in the page HTML. */
  const m = html.match(/wpdmdl=(\d+)/);
  return m ? m[1] : null;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

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
        let upstream;

        if (parsed.searchParams.has('wpdmdl')) {
          /* Direct PDF endpoint — fetch as-is */
          upstream = await fetchUpstream(parsed.toString());
        } else if (parsed.pathname.startsWith('/download/')) {
          /* Resolve the WordPress Download Manager ID from the page */
          const id = await findWpdmdlId(parsed.toString());
          if (!id) {
            return new Response(
              'Could not locate PDF download link on ZIMSEC page. The paper may have been removed or renamed.',
              { status: 502, headers: { 'content-type': 'text/plain' } }
            );
          }
          upstream = await fetchUpstream(`https://www5.zimsec.co.zw/?wpdmdl=${id}`);
        } else {
          return new Response('Unrecognised ZIMSEC URL pattern', { status: 400 });
        }

        /* Build response headers — pass through useful ones, normalise the rest. */
        const headers = new Headers();
        const passthrough = ['content-type', 'content-length', 'last-modified', 'etag'];
        for (const k of passthrough) {
          const v = upstream.headers.get(k);
          if (v) headers.set(k, v);
        }
        /* Force inline display so PDFs render in-tab on mobile + desktop. */
        const cd = upstream.headers.get('content-disposition') || '';
        if (cd) headers.set('content-disposition', cd.replace(/^\s*attachment\s*;?/i, 'inline;'));
        else    headers.set('content-disposition', 'inline');
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

    return env.ASSETS.fetch(request);
  }
};
