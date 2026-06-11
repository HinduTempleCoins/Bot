// integrations/scrape-throttle.mjs — per-host outbound crawl pacing for the web-scraper work.
//
// WHY THIS EXISTS
//   The scraper/librarian crawls must be polite: "Rate limits (2 seconds between requests)" to any
//   single host. This module is the per-HOST outbound pacer — it answers "how long must I wait before
//   I hit this host again?" so a crawl loop can respect a minimum interval per host.
//
//   DISTINCT FROM integrations/rate-limit.mjs — that one is an IP/fingerprint ABUSE CAP guarding the
//   faucet/signup surfaces (inbound, sliding-window counters, allow/deny). THIS module is outbound
//   crawl politeness: a min-interval scheduler keyed by the host WE are fetching from. No counting,
//   no deny — just "wait this many ms."
//
// DESIGN
//   • Pure + offline-testable. The clock is injectable (`now`); the module NEVER sleeps and NEVER
//     uses a real timer. A caller decides how to wait (await a delay, setTimeout, a queue, etc.).
//   • `nextDelay(host)` returns the ms to wait before the next request to `host` (0 if enough time
//     has already elapsed since the last `mark`). It does NOT mutate state — purely a question.
//   • `mark(host)` records that a request to `host` happened "now" (per injected clock).
//   • SOFT-FAIL: bad/empty hosts are normalized to a stable bucket; nothing throws. A negative or
//     non-finite minIntervalMs falls back to the default. Out-of-order/duplicate marks are tolerated.
//   • `waitTimes(hosts, minIntervalMs)` is a deterministic planner: given an ordered crawl list, it
//     returns the scheduled offset (ms from t0) for each request, pacing repeats of the same host by
//     minIntervalMs. Pure, no clock, for offline tests and pre-flight crawl estimates.
//
// USAGE
//   import { makeThrottle } from '../integrations/scrape-throttle.mjs';
//   const t = makeThrottle({ minIntervalMs: 2000 });
//   const wait = t.nextDelay(host);     // ms to wait (0 if clear)
//   if (wait > 0) await sleep(wait);    // caller owns the actual waiting
//   await fetchPage(url);
//   t.mark(host);                       // record after the request

const DEFAULT_MIN_INTERVAL_MS = 2000;

// Normalize whatever the caller passes (URL, "https://h/p", "Host:80", undefined) to a stable
// per-host bucket key. Never throws; falls back to the raw string, then to a sentinel.
export function hostKey(host) {
  if (host == null) return '(none)';
  let s = String(host).trim();
  if (s === '') return '(none)';
  // If it looks like a URL, pull the hostname.
  try {
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) {
      const u = new URL(s);
      if (u.hostname) return u.hostname.toLowerCase();
    }
  } catch {
    // fall through to raw handling
  }
  // Strip any path and port from a bare "host[:port]/path" form.
  s = s.split('/')[0].split(':')[0].trim();
  return s === '' ? '(none)' : s.toLowerCase();
}

function sanitizeInterval(ms, fallback = DEFAULT_MIN_INTERVAL_MS) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return n;
}

// makeThrottle({ minIntervalMs, now }) -> { nextDelay, mark, lastMark, reset, minIntervalMs }
export function makeThrottle({ minIntervalMs = DEFAULT_MIN_INTERVAL_MS, now = () => Date.now() } = {}) {
  const min = sanitizeInterval(minIntervalMs);
  const clock = typeof now === 'function' ? now : () => Date.now();
  const last = new Map(); // hostKey -> last request timestamp (per clock)

  function clockNow() {
    const t = Number(clock());
    return Number.isFinite(t) ? t : 0;
  }

  // ms a caller must wait before the next request to `host`. 0 if enough time elapsed.
  function nextDelay(host) {
    const key = hostKey(host);
    if (!last.has(key)) return 0;
    const elapsed = clockNow() - last.get(key);
    if (!Number.isFinite(elapsed) || elapsed >= min) return 0;
    const wait = min - elapsed;
    return wait > 0 ? wait : 0;
  }

  // Record that a request to `host` happened now (per the injected clock).
  function mark(host) {
    last.set(hostKey(host), clockNow());
  }

  // Last recorded timestamp for a host (or null).
  function lastMark(host) {
    const key = hostKey(host);
    return last.has(key) ? last.get(key) : null;
  }

  // Forget a host's history (or all hosts if none given).
  function reset(host) {
    if (host === undefined) last.clear();
    else last.delete(hostKey(host));
  }

  return { nextDelay, mark, lastMark, reset, minIntervalMs: min };
}

// waitTimes(hosts, minIntervalMs) -> array of scheduled offsets (ms from t0), one per host in order.
// Deterministic, clock-free planner: each request to a host is paced minIntervalMs after that host's
// previous request. Different hosts do not block one another (each starts at 0 unless it repeats).
export function waitTimes(hosts, minIntervalMs = DEFAULT_MIN_INTERVAL_MS) {
  const min = sanitizeInterval(minIntervalMs);
  const list = Array.isArray(hosts) ? hosts : [];
  const lastAt = new Map(); // hostKey -> last scheduled offset
  const out = [];
  for (const h of list) {
    const key = hostKey(h);
    let at = 0;
    if (lastAt.has(key)) at = lastAt.get(key) + min;
    lastAt.set(key, at);
    out.push(at);
  }
  return out;
}

export default { makeThrottle, waitTimes, hostKey };
