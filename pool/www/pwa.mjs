// pwa.mjs — register the service worker so the pool installs as a home-screen app.
//
// Tiny + safe: registers /sw.js at root scope only when the browser supports it and only on
// a secure context (https or localhost — SWs are disallowed elsewhere). No-ops cleanly in
// node (no navigator) so pages that import it stay importable under tests.
//
// The manifest <link> and apple-mobile meta tags live in each page's <head> (static HTML);
// this module only handles the runtime registration.

export function registerServiceWorker(nav = (typeof navigator !== 'undefined' ? navigator : null),
                                      loc = (typeof location !== 'undefined' ? location : null)) {
  if (!nav || !('serviceWorker' in nav)) return false;
  const secure = !loc || loc.protocol === 'https:' || loc.hostname === 'localhost' || loc.hostname === '127.0.0.1';
  if (!secure) return false;
  try {
    nav.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => { /* registration is best-effort */ });
    return true;
  } catch {
    return false;
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('load', () => registerServiceWorker());
}
