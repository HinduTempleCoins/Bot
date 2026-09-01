// dev-trust-guard.mjs — the code-level guard around the DEV-TRUST foot-gun (shared by Pentecaust + invites).
//
// THE FOOT-GUN
//   Three env flags — PENTECAUST_DEV_TRUST, TEAMS_DEV_TRUST_QUERY (both read by pentecaust/{auth,server}.mjs)
//   and INVITES_DEV_TRUST (signup/invites.mjs) — let a request assert its own identity via an
//   `x-melek-account` header (or a query field) so the reference client + offline suites work WITHOUT a real
//   login. They were env-var-only: set on a PUBLIC deploy, that header would impersonate ANY account,
//   including the witness `hathor`. This module makes dev-trust safe by construction:
//
//     1) honorDevTrust(req, flagOn) — dev-trust is honored for a request ONLY when its flag is set AND we are
//        not in production AND the request is GENUINELY LOCAL (loopback socket, no proxy-forwarding header).
//        Off loopback, or in production, the header/query is inert — it can impersonate no one.
//     2) assertStartupSafe({ host }) — the process REFUSES TO START (logs loudly + exits non-zero) if ANY
//        dev-trust flag is set while a production indicator is present (a production env marker, or binding a
//        non-loopback host). A stray flag on a public box is a crash, never a silent auth bypass.
//
//   Normal MELEK-Signer / session auth is completely unaffected — this only gates the dev-trust *fallback*.
//
//   import { honorDevTrust, assertStartupSafe } from './dev-trust-guard.mjs'  (Pentecaust: '../signup/…')

const env = (k) => (typeof process !== 'undefined' && process.env && process.env[k]) || '';

// The dev-trust flags across the messenger + invite surfaces. Any one of them, set to '1', enables the
// asserted-identity fallback on its surface — so the startup guard treats any of them as "dev-trust is on".
export const DEV_TRUST_FLAGS = ['PENTECAUST_DEV_TRUST', 'TEAMS_DEV_TRUST_QUERY', 'INVITES_DEV_TRUST'];
export function anyDevTrustFlag() { return DEV_TRUST_FLAGS.some((k) => env(k) === '1'); }

// Loopback hosts — the only addresses a "genuinely local" request may arrive from / bind to.
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1', 'localhost', '']);
export function isLoopbackHost(host) {
  return LOOPBACK.has(String(host == null ? '' : host).trim().toLowerCase());
}

// A request is genuinely local ONLY if it arrived on a loopback socket AND carries no proxy-forwarding
// header. The forwarding check is load-bearing: a public app behind a reverse proxy binds loopback, so the
// proxy connects from 127.0.0.1 — the socket alone would falsely look local. A request that came THROUGH a
// proxy (x-forwarded-for / x-real-ip / forwarded) is from a public client and is never trusted as local.
export function isLoopbackReq(req) {
  try {
    const h = (req && req.headers) || {};
    if (h['x-forwarded-for'] || h['x-real-ip'] || h['forwarded']) return false;
    const ra = req && req.socket && req.socket.remoteAddress;
    if (!ra) return false;                        // no socket info → not provably local → fail closed
    return isLoopbackHost(ra);
  } catch { return false; }
}

// Production is indicated by an explicit env marker (MELEK_ENV / NODE_ENV / PENTECAUST_ENV === 'production',
// or PROD=1) OR — for the startup check — by binding a non-loopback host. `host` is optional: the per-request
// honor path calls this with no host (env markers only); the startup path passes the bind host.
export function productionIndicator({ host } = {}) {
  const isProd = (k) => String(env(k)).trim().toLowerCase() === 'production';
  if (isProd('MELEK_ENV') || isProd('NODE_ENV') || isProd('PENTECAUST_ENV')) return true;
  if (env('PROD') === '1') return true;
  if (host != null && host !== '' && !isLoopbackHost(host)) return true;
  return false;
}

// Per-request decision: honor the dev-trust fallback for THIS request? Only when the caller's flag is on, we
// are not in production, and the request is genuinely local. Otherwise dev-trust is inert.
export function honorDevTrust(req, flagOn) {
  return !!flagOn && !productionIndicator() && isLoopbackReq(req);
}

// Startup refusal: if a dev-trust flag is set while a production indicator is present, DO NOT SERVE — log
// loudly and exit non-zero. log/exit are injectable so the behaviour is offline-testable without killing the
// test process. Returns true when it is safe to start, false when it refused (after calling exit).
export function assertStartupSafe({ host, log = console.error, exit = process.exit } = {}) {
  if (anyDevTrustFlag() && productionIndicator({ host })) {
    log('[dev-trust-guard] FATAL: a DEV-TRUST flag (' + DEV_TRUST_FLAGS.join(' / ') + ') is set while a ' +
      'production indicator is present (production env marker or non-loopback bind host=' + String(host) + '). ' +
      'Refusing to start: dev-trust would let an x-melek-account header impersonate ANY account (including hathor). ' +
      'Unset the flag(s) for any public/production deploy.');
    exit(1);
    return false;
  }
  return true;
}
