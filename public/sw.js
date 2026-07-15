// Offline + fast repeat visits. Strategy per request class:
//
//   • navigations + version.json  → NETWORK-FIRST. Players always land on the
//     freshest index.html (and thus the newest hashed bundle) and the deploy
//     stamp is never served stale. Cache is the offline fallback.
//   • hashed build assets (/assets/*)  → CACHE-FIRST. Vite content-hashes these,
//     so a given URL is immutable; a new deploy ships new filenames that miss
//     the cache and fetch fresh. Code freshness is fully preserved.
//   • static media (art / music / sfx / pickups / icons)  → STALE-WHILE-
//     REVALIDATE. Big files with stable names load instantly from cache and
//     refresh in the background, so a media change lands one visit later.
//   • everything else  → network-first (safe default).
//
// Bump CACHE to evict the previous scheme wholesale.
const CACHE = 'hang-on-fren-v2';

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

// Only 200 responses are cacheable: audio/video often reply 206 Partial Content
// to Range requests, and Cache.put() throws on those. Skip range requests too.
function cacheable(req, res) {
  return res && res.status === 200 && res.type !== 'opaque' && !req.headers.has('range');
}

function put(req, res) {
  if (!cacheable(req, res)) return;
  const copy = res.clone();
  caches.open(CACHE).then(cache => cache.put(req, copy)).catch(() => undefined);
}

async function networkFirst(req) {
  try {
    const res = await fetch(req);
    put(req, res);
    return res;
  } catch {
    const hit = await caches.match(req);
    return hit || Response.error();
  }
}

async function cacheFirst(req) {
  const hit = await caches.match(req);
  if (hit) return hit;
  try {
    const res = await fetch(req);
    put(req, res);
    return res;
  } catch {
    return Response.error();
  }
}

// Serve cache immediately, refresh in the background. Returns the cached copy at
// once when present; otherwise waits on the network. `event.waitUntil` keeps the
// worker alive for the background refresh.
function staleWhileRevalidate(event, req) {
  return caches.match(req).then(hit => {
    const fetching = fetch(req)
      .then(res => {
        put(req, res);
        return res;
      })
      .catch(() => hit || Response.error());
    if (hit) {
      event.waitUntil(fetching);
      return hit;
    }
    return fetching;
  });
}

const isHashedAsset = url => url.pathname.includes('/assets/');
const isMedia = url =>
  /\/(art|music|sfx|pickups|icons)\//.test(url.pathname) ||
  /\.(webp|m4a|mp3|ogg|png|jpe?g|svg|woff2?)$/.test(url.pathname);
const isVersion = url => url.pathname.endsWith('/version.json');

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET' || !req.url.startsWith(self.location.origin)) return;
  const url = new URL(req.url);

  if (req.mode === 'navigate' || isVersion(url)) {
    event.respondWith(networkFirst(req));
  } else if (isHashedAsset(url)) {
    event.respondWith(cacheFirst(req));
  } else if (isMedia(url)) {
    event.respondWith(staleWhileRevalidate(event, req));
  } else {
    event.respondWith(networkFirst(req));
  }
});
