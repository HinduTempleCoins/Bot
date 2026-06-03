// analytics-selfhost.mjs — self-hosted, privacy-first analytics (Umami/Plausible-style) that backs the
// real view counters (task #128). First-party, COOKIELESS event model with NO third-party trackers and
// NO PII at rest. It is the measured source the visible "X views" badge (soapbox/viewcounter.mjs) sits on
// top of, and it shares the privacy posture of soapbox/analytics.mjs: no cookies, no stored IPs/UAs.
//
// The Plausible privacy model: instead of a cookie or a stored identifier, a visitor is reduced to a
// ONE-WAY daily hash of (salt + day + ip + ua + domain). The salt rotates every day, so the same person
// produces a DIFFERENT hash tomorrow — uniques are countable within a day but visitors are UNLINKABLE
// across days. The raw ip/ua never touch the store; only the hash does.
//
// This module is the pure event model + an in-memory store for testing/local use. A REAL deploy runs
// Umami or Plausible (Postgres/ClickHouse) or a small SQLite table behind the same shape — see
// umamiConfig()/plausibleConfig() for the env-var NAMES (no secrets here, ever) and the site script tag.
//
//   import { dailyVisitorId, recordEvent, summary, memStore } from './analytics-selfhost.mjs'
//   const store = memStore();
//   const v = dailyVisitorId({ ip: '1.2.3.4', ua: 'Mozilla/5.0', salt: 'rot', day: '2026-06-03' });
//   recordEvent(store, { path: '/markets', visitor: v, ts: Date.now() });
//   summary(store, {});
//   node integrations/analytics-selfhost.mjs   # tiny offline demo

import { createHash, randomBytes } from 'node:crypto';

// ---- clock (injectable for tests) ----
let _now = () => Date.now();
export function __setNow(fn) { _now = fn || (() => Date.now()); }

// day string (UTC) from a timestamp — the daily-salt rotation boundary.
export function dayOf(ts = _now()) {
  const t = typeof ts === 'number' ? ts : Date.parse(ts);
  if (!Number.isFinite(t)) return 'unknown';
  return new Date(t).toISOString().slice(0, 10);
}

// ---- daily-rotating salt ----
// A real deploy persists ONE random salt per day (and discards yesterday's, so old hashes can never be
// recomputed). Here we expose a generator so callers/tests control it. Never derive the salt from the
// visitor input — that would make it reversible.
export function newDailySalt() {
  return randomBytes(32).toString('hex');
}

// dailyVisitorId({ ip, ua, salt, day }) → one-way sha256 hash that is STABLE within a day for the same
// input but UNLINKABLE across days (because salt+day rotate). The raw ip/ua are hashed and discarded —
// they are never returned, never stored. Reversal is infeasible (sha256 over a high-entropy daily salt).
export function dailyVisitorId({ ip = '', ua = '', salt = '', day } = {}) {
  const d = day || dayOf();
  // salt + day are both part of the digest so a leaked single-day hash can't be carried forward, and
  // the same (ip,ua) yields a different digest once the day (and salt) roll over.
  return createHash('sha256')
    .update(String(salt))
    .update('|').update(String(d))
    .update('|').update(String(ip))
    .update('|').update(String(ua))
    .digest('hex');
}

// ---- store: in-memory append-only event log ----
// An event is { path, type, visitor(hash), day, ts, ref }. NO raw ip/ua — only the daily hash. A real
// backend (Umami/Plausible/SQLite) stores the same columns; this Map-backed store is process-local and
// resets on restart.
export function memStore() {
  const events = [];
  return {
    push(ev) { events.push(ev); return ev; },
    all() { return events.slice(); },
    get length() { return events.length; },
  };
}

const REF_NONE = '(direct)';
function hostnameOf(u) {
  if (!u) return REF_NONE;
  try { return new URL(u).hostname || REF_NONE; } catch { return String(u).slice(0, 40); }
}
function normPath(p) {
  const s = String(p == null ? '' : p).trim();
  if (!s) return '/';
  return s.split('?')[0].split('#')[0].slice(0, 200) || '/';
}

// recordEvent(store, { path, type, visitor, ts, ref }) — append a privacy-safe event. The `visitor`
// is expected to be a daily hash (from dailyVisitorId); we NEVER accept or store a raw ip/ua here.
// Soft-fail: bad input or a bad store returns null instead of throwing (analytics must never break a page).
export function recordEvent(store, { path, type = 'pageview', visitor = '', ts, when, ref = '' } = {}) {
  try {
    if (!store || typeof store.push !== 'function') return null;
    const at = ts != null ? ts : (when != null ? when : _now());
    const ev = {
      path: normPath(path),
      type: String(type || 'pageview'),
      visitor: String(visitor || ''), // a daily hash, or '' when no visitor signal is available
      day: dayOf(at),
      ts: at,
      ref: hostnameOf(ref),
    };
    return store.push(ev);
  } catch {
    return null; // soft-fail: never let analytics throw into a request path
  }
}

const bump = (o, k) => { o[k] = (o[k] || 0) + 1; };
const top = (o, n) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, n);

// summary(store, { from, to, type }) → { pageviews, uniques, topPages, topReferrers, byDay }. PURE: reads
// the event log, computes nothing it can't measure. Uniques are counted via the daily hash (so the same
// visitor twice in a day = 1 unique). `from`/`to` are inclusive day strings ('YYYY-MM-DD') or timestamps.
export function summary(store, { from = null, to = null, type = 'pageview' } = {}) {
  const empty = { pageviews: 0, uniques: 0, topPages: [], topReferrers: [], byDay: [] };
  if (!store || typeof store.all !== 'function') return empty;
  const fromDay = from == null ? null : (String(from).length === 10 ? String(from) : dayOf(from));
  const toDay = to == null ? null : (String(to).length === 10 ? String(to) : dayOf(to));

  const pages = {};
  const referrers = {};
  const days = {};
  const uniqAll = new Set();
  let pageviews = 0;

  for (const ev of store.all()) {
    if (type && ev.type !== type) continue;
    if (fromDay && ev.day < fromDay) continue;
    if (toDay && ev.day > toDay) continue;
    pageviews++;
    bump(pages, ev.path);
    bump(referrers, ev.ref || REF_NONE);
    bump(days, ev.day);
    if (ev.visitor) uniqAll.add(ev.visitor); // daily hash; same visitor same day collapses to one
  }

  return {
    pageviews,
    uniques: uniqAll.size,
    topPages: top(pages, 15),
    topReferrers: top(referrers, 10),
    byDay: Object.entries(days).sort().map(([d, c]) => [d, c]),
  };
}

// viewsForPath(store, path) — pageview count for one path (0 if never seen; never invented).
export function viewsForPath(store, path) {
  if (!store || typeof store.all !== 'function') return 0;
  const p = normPath(path);
  let n = 0;
  for (const ev of store.all()) if (ev.type === 'pageview' && ev.path === p) n++;
  return n;
}

// bounceRate(store) — fraction of single-pageview daily-visitors (a "bounce" = a visitor who, within a
// day, viewed exactly one page). Returns 0..1. A visitor with no hash can't be tracked, so is excluded.
export function bounceRate(store) {
  if (!store || typeof store.all !== 'function') return 0;
  const seen = new Map(); // (visitor|day) → distinct path count
  for (const ev of store.all()) {
    if (ev.type !== 'pageview' || !ev.visitor) continue;
    const k = ev.visitor + '|' + ev.day;
    let set = seen.get(k);
    if (!set) { set = new Set(); seen.set(k, set); }
    set.add(ev.path);
  }
  const total = seen.size;
  if (!total) return 0;
  let bounced = 0;
  for (const set of seen.values()) if (set.size <= 1) bounced++;
  return bounced / total;
}

// ---- self-host deploy config (env-var NAMES only — NO secrets in this file or its output) ----

// plausibleConfig({ domain }) — env-var NAMES for a self-hosted Plausible Community Edition deploy plus
// the one-line, cookieless script tag for the site. Values are placeholders/names; real secrets live in
// the host's environment / vault, never here.
export function plausibleConfig({ domain = 'example.com' } = {}) {
  return {
    product: 'plausible',
    cookieless: true,
    storesPII: false,
    // env-var NAMES the operator sets on the Plausible host (see Plausible CE docs). No values.
    envNames: [
      'BASE_URL',            // public URL of the self-hosted Plausible instance
      'SECRET_KEY_BASE',     // app secret (generated on the host, never committed)
      'DATABASE_URL',        // Postgres connection (credentials live in the host env)
      'CLICKHOUSE_DATABASE_URL',
      'TOTP_VAULT_KEY',
      'DISABLE_REGISTRATION',
    ],
    // first-party, cookieless beacon. `data-domain` is the only site-specific value; no API key in markup.
    scriptTag: `<script defer data-domain="${domain}" src="https://plausible.${domain}/js/script.js"></script>`,
    note: 'Self-hosted Plausible CE (Postgres + ClickHouse). Cookieless, no PII; daily-salt visitor hashing.',
  };
}

// umamiConfig({ domain }) — env-var NAMES for a self-hosted Umami deploy plus its cookieless tracker tag.
export function umamiConfig({ domain = 'example.com' } = {}) {
  return {
    product: 'umami',
    cookieless: true,
    storesPII: false,
    envNames: [
      'DATABASE_URL',        // Postgres/MySQL connection (credentials in host env, never committed)
      'DATABASE_TYPE',       // 'postgresql' | 'mysql'
      'APP_SECRET',          // app secret (generated on the host)
      'HASH_SALT',           // salt used for the daily visitor hash (rotated; kept off the repo)
      'DISABLE_TELEMETRY',
    ],
    // Umami's tracker: a website id (public, not a secret) + the self-hosted script URL. No cookies.
    scriptTag: `<script defer data-website-id="UMAMI_WEBSITE_ID" src="https://umami.${domain}/script.js"></script>`,
    note: 'Self-hosted Umami (Postgres/MySQL). Cookieless, no PII; hashed visitor id rotates daily.',
  };
}

// CLI — tiny offline demo (no network, no fabrication). Guarded so importing is side-effect free.
if (process.argv[1] && process.argv[1].endsWith('analytics-selfhost.mjs')) {
  const store = memStore();
  const day = '2026-06-03';
  const salt = newDailySalt();
  const a = dailyVisitorId({ ip: '1.2.3.4', ua: 'Firefox', salt, day });
  const b = dailyVisitorId({ ip: '5.6.7.8', ua: 'Safari', salt, day });
  recordEvent(store, { path: '/markets', visitor: a, ts: Date.parse(day) });
  recordEvent(store, { path: '/stocks', visitor: a, ts: Date.parse(day), ref: 'https://news.ycombinator.com/' });
  recordEvent(store, { path: '/markets', visitor: b, ts: Date.parse(day) });
  const s = summary(store, {});
  console.log('Self-hosted analytics (cookieless, no PII) — demo:\n' + '─'.repeat(56));
  console.log(`  pageviews: ${s.pageviews}   uniques: ${s.uniques}   bounce: ${(bounceRate(store) * 100).toFixed(0)}%`);
  console.log('  top pages:'); for (const [p, c] of s.topPages) console.log(`    ${String(c).padStart(4)}  ${p}`);
  console.log('  referrers:'); for (const [r, c] of s.topReferrers) console.log(`    ${String(c).padStart(4)}  ${r}`);
  console.log('─'.repeat(56));
  console.log('  plausible tag:', plausibleConfig({ domain: 'soapbox.community' }).scriptTag);
  console.log('  stored event sample (no raw ip/ua):', JSON.stringify(store.all()[0]));
}
