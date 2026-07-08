// Minimal offline support: NETWORK-FIRST with a cache fallback. Online players
// always get the freshest build (no stale-deploy problem); everything fetched
// once — code, art, music, sfx — is cached, so the game keeps working offline
// after the first visit. Bump the cache name to drop old entries.
const CACHE = 'hang-on-fren-v1';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches
      .keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET' || !req.url.startsWith(self.location.origin)) return;
  event.respondWith(
    fetch(req)
      .then(res => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(cache => cache.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req).then(hit => hit || Response.error())),
  );
});
