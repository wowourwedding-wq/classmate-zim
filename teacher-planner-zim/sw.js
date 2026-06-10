/* ClassMate Zim — service worker.
   Caches the app on first visit so future visits open instantly with no internet.
   Important for the Zim audience: schools with patchy connectivity, expensive data.

   Two caches:
     - SHELL_CACHE (versioned)      — HTML/JS/CSS app shell, bumped each release
     - PAPERS_CACHE (long-lived)    — ZIMSEC PDFs cached via /zimsec-proxy.
                                      Survives shell version bumps so teachers
                                      don't have to re-download after updates.
*/

const SHELL_CACHE = 'classmate-zim-v38';
const PAPERS_CACHE = 'classmate-zim-papers-v1';
const SHELL = ['./', './index.html'];

self.addEventListener('install', function(e){
  self.skipWaiting();
  e.waitUntil(
    caches.open(SHELL_CACHE).then(function(c){ return c.addAll(SHELL); })
  );
});

self.addEventListener('activate', function(e){
  e.waitUntil(
    caches.keys().then(function(keys){
      return Promise.all(keys.map(function(k){
        /* Keep SHELL_CACHE (current) + PAPERS_CACHE (always). Delete other old shells. */
        if(k === SHELL_CACHE || k === PAPERS_CACHE) return null;
        if(k.startsWith('classmate-zim-papers-')) return null;  /* never wipe paper caches */
        return caches.delete(k);
      }));
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', function(e){
  if(e.request.method !== 'GET') return;
  var url = new URL(e.request.url);
  /* Only handle same-origin requests. */
  if(url.origin !== self.location.origin) return;

  /* ZIMSEC PDF proxy — cache aggressively, long-lived bucket. */
  if(url.pathname === '/zimsec-proxy' || url.pathname === '/zimsec-proxy/'){
    e.respondWith(
      caches.open(PAPERS_CACHE).then(function(cache){
        return cache.match(e.request).then(function(cached){
          if(cached) return cached;
          return fetch(e.request).then(function(resp){
            /* Cache successful responses for later offline access. */
            if(resp && resp.status === 200){
              cache.put(e.request, resp.clone());
            }
            return resp;
          }).catch(function(){
            return new Response('Offline — paper not yet cached. Connect once on Wi-Fi to download.', {
              status: 503, headers: {'content-type':'text/plain'}
            });
          });
        });
      })
    );
    return;
  }

  /* App shell — cache-first with network fallback. */
  e.respondWith(
    caches.match(e.request).then(function(cached){
      if(cached) return cached;
      return fetch(e.request).then(function(resp){
        if(resp && resp.status === 200 && resp.type === 'basic'){
          var clone = resp.clone();
          caches.open(SHELL_CACHE).then(function(c){ c.put(e.request, clone); });
        }
        return resp;
      }).catch(function(){
        return caches.match('./index.html');
      });
    })
  );
});

/* Message handler so the page can ask about cached papers + clear papers. */
self.addEventListener('message', function(e){
  if(!e.data || !e.data.type) return;
  if(e.data.type === 'COUNT_PAPERS'){
    caches.open(PAPERS_CACHE).then(function(c){
      c.keys().then(function(keys){
        e.source.postMessage({type:'PAPERS_COUNT', count: keys.length});
      });
    });
  } else if(e.data.type === 'CLEAR_PAPERS'){
    caches.delete(PAPERS_CACHE).then(function(){
      e.source.postMessage({type:'PAPERS_CLEARED'});
    });
  } else if(e.data.type === 'CHECK_PAPER'){
    /* { url: '/zimsec-proxy?url=...' } -> { type:'PAPER_STATUS', url, cached: bool } */
    caches.open(PAPERS_CACHE).then(function(c){
      c.match(e.data.url).then(function(m){
        e.source.postMessage({type:'PAPER_STATUS', url: e.data.url, cached: !!m});
      });
    });
  }
});
