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
//   • ranged media requests (<audio> music beds)  → see "Ranged media" below.
//     The browser asks for a Range and the server answers 206, which Cache
//     Storage refuses, so they used to bypass the cache altogether. Now the
//     full body is cached as a 200 and later Range requests are sliced from it.
//   • everything else  → network-first (safe default).
//
// Bump CACHE to evict the previous scheme wholesale. (Not bumped for the ranged
// media work: it only adds entries of the same shape, and a bump would evict
// the ~100 art files for no benefit.)
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

// ---- Ranged media -----------------------------------------------------------
// <audio> asks for `Range: bytes=0-` (Chromium) or small probes first (Safari),
// and the server replies 206. Entries are keyed by plain URL so any later
// request, ranged or not, finds them.
//
//   miss  → the request goes to the network untouched, so streaming and start-up
//           time are unchanged. A 206 that covers the whole entity (Chromium's
//           initial `bytes=0-`) is cloned into the cache as a 200 with no second
//           download. A genuinely partial 206 passes through and triggers one
//           deduplicated background fetch of the full file. Tiny probes (Safari
//           opens with `bytes=0-1`) are ignored, because the browser follows
//           them with a whole-file range that is then stored without a second
//           download; fetching in full on the probe would race it.
//   hit   → a 200 is sliced into a correct 206 (Content-Range, Accept-Ranges,
//           Content-Length, Content-Type). Opaque responses are never stored,
//           so they are never sliced.
const MAX_MEDIA_BYTES = 16 * 1024 * 1024; // refuse to cache anything larger
const PROBE_BYTES = 1024; // partial responses this small are probes, not playback
const filling = new Set(); // URLs being stored or fetched in full right now
const revalidated = new Set(); // URLs already revalidated by this worker instance

const MIME = { m4a: 'audio/mp4', mp3: 'audio/mpeg', ogg: 'audio/ogg', opus: 'audio/ogg', wav: 'audio/wav' };

// `bytes 0-9/10` -> { start, end, total }; null for `*` totals or anything odd.
function parseContentRange(value) {
  const m = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(value || '');
  return m ? { start: +m[1], end: +m[2], total: +m[3] } : null;
}

// A single `bytes=a-b`, `bytes=a-` or `bytes=-n` against `size`. Returns
// { start, end } (inclusive), 'unsatisfiable', or null when the header should be
// ignored (multi-range or malformed, in which case the full 200 is served).
function parseRange(header, size) {
  const m = /^bytes=(\d*)-(\d*)$/.exec((header || '').trim());
  if (!m || (m[1] === '' && m[2] === '')) return null;
  if (m[1] === '') {
    const n = +m[2];
    return n === 0 || size === 0 ? 'unsatisfiable' : { start: Math.max(0, size - n), end: size - 1 };
  }
  const start = +m[1];
  if (start >= size) return 'unsatisfiable';
  const end = m[2] === '' ? size - 1 : Math.min(+m[2], size - 1);
  return end < start ? null : { start, end };
}

async function sliceResponse(hit, rangeHeader, url) {
  const blob = await hit.blob();
  const size = blob.size;
  const range = parseRange(rangeHeader, size);
  if (range === 'unsatisfiable') {
    return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
  }
  const type = hit.headers.get('Content-Type') || MIME[url.pathname.split('.').pop()] || 'application/octet-stream';
  const headers = new Headers({ 'Content-Type': type, 'Accept-Ranges': 'bytes' });
  for (const h of ['ETag', 'Last-Modified']) if (hit.headers.has(h)) headers.set(h, hit.headers.get(h));
  if (!range) {
    headers.set('Content-Length', String(size));
    return new Response(blob, { status: 200, headers });
  }
  headers.set('Content-Range', `bytes ${range.start}-${range.end}/${size}`);
  headers.set('Content-Length', String(range.end - range.start + 1));
  return new Response(blob.slice(range.start, range.end + 1), { status: 206, headers });
}

// Store a full-entity response (200, or a 206 spanning the whole file rewritten
// as a 200) under the plain URL.
async function storeFull(url, res) {
  const cache = await caches.open(CACHE);
  await cache.put(url, res);
}

function asFull200(res) {
  const headers = new Headers(res.headers);
  headers.delete('Content-Range');
  headers.set('Accept-Ranges', 'bytes');
  return new Response(res.body, { status: 200, headers });
}

// One background full download per URL, for browsers that only issue partial
// ranges. Does nothing if a store is already under way.
function fetchFull(event, url) {
  if (filling.has(url)) return;
  filling.add(url);
  const job = fetch(url)
    .then(res => {
      const len = +res.headers.get('Content-Length');
      if (res.status === 200 && res.type === 'basic' && !(len > MAX_MEDIA_BYTES)) return storeFull(url, res);
    })
    .catch(() => undefined)
    .finally(() => filling.delete(url));
  event.waitUntil(job);
}

// Once per worker instance per URL, ask the server whether the cached body is
// still current. A 304 costs a header exchange, never the body, so a media
// change still lands one visit later without re-downloading on every Range.
// With no validator to send there is nothing cheap to ask, so skip.
function revalidate(event, url, hit) {
  if (revalidated.has(url)) return;
  revalidated.add(url);
  const headers = new Headers();
  if (hit.headers.has('ETag')) headers.set('If-None-Match', hit.headers.get('ETag'));
  else if (hit.headers.has('Last-Modified')) headers.set('If-Modified-Since', hit.headers.get('Last-Modified'));
  else return;
  const job = fetch(url, { headers })
    .then(res => (res.status === 200 && res.type === 'basic' ? storeFull(url, res) : undefined))
    .catch(() => undefined);
  event.waitUntil(job);
}

async function rangedMedia(event, req, url) {
  const key = req.url;
  const cache = await caches.open(CACHE);
  const hit = await cache.match(key);
  if (hit && hit.status === 200 && hit.type !== 'opaque') {
    revalidate(event, key, hit);
    return sliceResponse(hit, req.headers.get('range'), url);
  }
  let res;
  try {
    res = await fetch(req);
  } catch {
    return Response.error();
  }
  if (res.type === 'opaque' || filling.has(key)) return res;
  const tooBig = +res.headers.get('Content-Length') > MAX_MEDIA_BYTES;
  const encoded = res.headers.has('Content-Encoding'); // Content-Range would not match the decoded body
  if (res.status === 200 && !tooBig) {
    // The server ignored the Range: we already hold the whole body.
    filling.add(key);
    event.waitUntil(storeFull(key, res.clone()).catch(() => undefined).finally(() => filling.delete(key)));
  } else if (res.status === 206 && !tooBig && !encoded) {
    const cr = parseContentRange(res.headers.get('Content-Range'));
    if (cr && cr.total <= MAX_MEDIA_BYTES) {
      if (cr.start === 0 && cr.end === cr.total - 1) {
        filling.add(key);
        event.waitUntil(storeFull(key, asFull200(res.clone())).catch(() => undefined).finally(() => filling.delete(key)));
      } else if (cr.end - cr.start + 1 > PROBE_BYTES) {
        fetchFull(event, key);
      }
    }
  }
  return res;
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
  } else if (isMedia(url) && req.headers.has('range')) {
    event.respondWith(rangedMedia(event, req, url));
  } else if (isMedia(url)) {
    event.respondWith(staleWhileRevalidate(event, req));
  } else {
    event.respondWith(networkFirst(req));
  }
});
