/* ClassMate Zim — service worker.
   Caches the app on first visit so future visits open instantly with no internet.
   Important for the Zim audience: schools with patchy connectivity, expensive data. */

const CACHE = 'classmate-zim-v11';
const SHELL = ['./', './index.html', './app.html'];

self.addEventListener('install', function(e){
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then(function(c){ return c.addAll(SHELL); })
  );
});

self.addEventListener('activate', function(e){
  e.waitUntil(
    caches.keys().then(function(keys){
      return Promise.all(keys.map(function(k){
        if(k !== CACHE) return caches.delete(k);
      }));
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', function(e){
  if(e.request.method !== 'GET') return;
  var url = new URL(e.request.url);
  /* Skip cross-origin requests — let them fail silently when offline. */
  if(url.origin !== self.location.origin) return;
  e.respondWith(
    caches.match(e.request).then(function(cached){
      if(cached) return cached;
      return fetch(e.request).then(function(resp){
        if(resp && resp.status === 200 && resp.type === 'basic'){
          var clone = resp.clone();
          caches.open(CACHE).then(function(c){ c.put(e.request, clone); });
        }
        return resp;
      }).catch(function(){
        /* Offline and not in cache — fall back to the cached app shell. */
        return caches.match('./index.html');
      });
    })
  );
});
