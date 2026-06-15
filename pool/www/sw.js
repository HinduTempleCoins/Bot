/* SoapBox Pool — service worker (tiny + safe).
 *
 * Strategy:
 *   - Static shell (HTML/CSS/JS/icons/manifest): CACHE-FIRST, so add-to-home-screen opens
 *     instantly and works offline. Updated copies are fetched in the background and the
 *     cache version bump (CACHE_VERSION) drops the old cache on activate.
 *   - The pool API (/api/...) and the mining WebSocket (/ws): NETWORK-FIRST and NEVER
 *     persisted. Live stats must be live; a stale balance/hashrate would be a lie. We pass
 *     these straight through and do not put their responses in any cache.
 *
 * Honest + minimal: we only precache our own first-party static files, nothing third-party,
 * and the API is always the network. No background sync, no push, no tracking.
 */

const CACHE_VERSION = 'soapbox-pool-v3';   // v3: Hathor chat widget + browser-safe brain (process guard)

// The static app shell to precache. Keep this list small and first-party only.
const CACHE_LIST = [
  '/',
  '/index.html',
  '/mycoins.html',
  '/style.css',
  '/manifest.webmanifest',
  '/icon.svg',
  '/icon-maskable.svg',
];

// Requests we must NEVER cache (must stay live).
function isLive(url) {
  return url.pathname.startsWith('/api/') || url.pathname === '/ws';
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(CACHE_LIST)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return; // only ever cache idempotent GETs

  let url;
  try { url = new URL(req.url); } catch { return; }

  // Same-origin only; let cross-origin requests go straight to the network.
  if (url.origin !== self.location.origin) return;

  // Live data: network-first, never persisted. On failure, surface the error (don't fake it).
  if (isLive(url)) {
    event.respondWith(fetch(req));
    return;
  }

  // Static shell: cache-first, with a background refresh of the cached copy.
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          // Only cache successful, basic (same-origin) responses.
          if (res && res.ok && res.type === 'basic') {
            const copy = res.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put(req, copy));
          }
          return res;
        })
        .catch(() => cached); // offline: fall back to whatever we have
      return cached || network;
    })
  );
});
