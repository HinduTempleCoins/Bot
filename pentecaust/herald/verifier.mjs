// pentecaust/herald/verifier.mjs — Pentecaust HERALD backlink verifier (outreach brief, Component 4:
// "automatic confirmation that placed links are live and whether they pass authority"). After a placement
// partner tells us a link is live, Herald fetches the page and confirms: does the page actually resolve
// (HTTP status), is there an <a href> pointing at our target URL, and does that anchor pass authority
// (dofollow) or is it neutralized (rel=nofollow/ugc/sponsored). This is verification only — it never
// broadcasts, never writes the chain, never touches keys.
//
// POLITENESS: we fetch each placement page ONCE with an honest, self-identifying User-Agent (HERALD_UA) so
// site owners can see who we are, and we pace verifyAll under a requests-per-minute cap. robots.txt is the
// other half of polite crawling — respecting a site's robots directives is a planned follow-up; this module
// deliberately does NOT fetch or parse robots.txt (one fetch per placement page, no crawl expansion).
//
// SOFT-FAIL NEVER THROW: every path returns a safe shape; a network error or a bad row yields
// { verdict: 'link_down' } rather than an exception.
//
//   import { checkLink, verifyAll, __setFetch, __setSleep } from './verifier.mjs'

const env = (k, d) => (typeof process !== 'undefined' && process.env && process.env[k]) || d;
const now = (o) => (o && o.now != null ? o.now : Date.now());

const HERALD_UA = () => env('HERALD_UA', 'HeraldBacklinkVerifier/1.0 (+https://melek.salon)');
const VERIFY_RPM = () => Math.max(1, Number(env('HERALD_VERIFY_RPM', '30')) || 30);

// ── injectable network (tests inject fake HTML responses and assert on recorded calls) ─────────────────
let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

// ── injectable sleeper (tests inject a no-op so throttle pacing never spends real time) ────────────────
let _sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export function __setSleep(fn) { _sleep = fn || ((ms) => new Promise((r) => setTimeout(r, ms))); }

// Normalize a URL to host+path (lowercased host, trailing slash tolerated) for tolerant matching.
function normUrl(u) {
  try {
    const url = new URL(String(u));
    const host = url.host.toLowerCase();
    let path = url.pathname || '/';
    if (path.length > 1) path = path.replace(/\/+$/, '');  // drop trailing slash(es), keep bare "/"
    return { host, path, key: host + path };
  } catch { return null; }
}

// Does `href` point at the same target (exact, or same host+path tolerant of trailing slash)?
function hrefMatchesTarget(href, target) {
  const h = String(href || '').trim();
  if (!h) return false;
  if (h === String(target)) return true;
  const a = normUrl(h); const b = normUrl(target);
  return !!(a && b && a.key === b.key);
}

// Pull rel tokens (nofollow / ugc / sponsored) off a raw <a ...> tag, case-insensitive.
const AUTHORITY_BLOCKERS = ['nofollow', 'ugc', 'sponsored'];
function relTokens(anchorTag) {
  const m = /\brel\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(String(anchorTag || ''));
  const raw = m ? (m[2] ?? m[3] ?? m[4] ?? '') : '';
  const toks = raw.toLowerCase().split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
  return AUTHORITY_BLOCKERS.filter((b) => toks.includes(b));
}

// Scan HTML for an <a href> matching targetUrl; return { present, rel } for the first match.
function scanAnchors(html, targetUrl) {
  const s = String(html || '');
  const re = /<a\b[^>]*>/gi;
  let m;
  while ((m = re.exec(s)) !== null) {
    const tag = m[0];
    const hrefM = /\bhref\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag);
    const href = hrefM ? (hrefM[2] ?? hrefM[3] ?? hrefM[4] ?? '') : '';
    if (hrefMatchesTarget(href, targetUrl)) return { present: true, rel: relTokens(tag) };
  }
  return { present: false, rel: [] };
}

function verdictFor({ status, present, rel }) {
  if (status >= 400 || !present) return 'link_down';
  return rel.length ? 'link_live' : 'verified_dofollow';
}

// ── check a single placed link ─────────────────────────────────────────────────────────────────────────
export async function checkLink({ liveLinkUrl, targetUrl } = {}, opts = {}) {
  const page = String(liveLinkUrl || '').trim();
  const target = String(targetUrl || '').trim();
  if (!page || !target) {
    return { ok: false, verdict: 'link_down', present: false, rel: [], reason: 'liveLinkUrl and targetUrl required', checkedAt: now(opts) };
  }
  try {
    const r = await _fetch(page, { headers: { 'user-agent': HERALD_UA(), accept: 'text/html' }, redirect: 'follow' });
    const status = Number(r && r.status) || 0;
    let html = '';
    try { html = await r.text(); } catch { html = ''; }
    const { present, rel } = scanAnchors(html, target);
    const verdict = verdictFor({ status, present, rel });
    return { ok: true, status, present, rel, verdict, checkedAt: now(opts) };
  } catch (e) {
    return { ok: false, verdict: 'link_down', present: false, rel: [], reason: String((e && e.message) || 'fetch error'), checkedAt: now(opts) };
  }
}

// ── verify a batch, paced under HERALD_VERIFY_RPM ────────────────────────────────────────────────────────
export async function verifyAll(rows, opts = {}) {
  const list = Array.isArray(rows) ? rows : [];
  const rpm = VERIFY_RPM();
  const gap = Math.ceil(60000 / rpm);   // ms between fetches to stay under the cap
  const out = [];
  for (let i = 0; i < list.length; i++) {
    if (i > 0) { try { await _sleep(gap); } catch {} }
    const row = list[i] || {};
    const res = await checkLink({ liveLinkUrl: row.liveLinkUrl, targetUrl: row.targetUrl }, opts);
    out.push({ id: row.id ?? null, ...res });
  }
  return out;
}

// ── CLI (guarded) — verify one link from argv, for quick manual checks ──────────────────────────────────
async function _main() {
  const [liveLinkUrl, targetUrl] = process.argv.slice(2);
  const res = await checkLink({ liveLinkUrl, targetUrl });
  console.log(JSON.stringify(res, null, 2));
}
if (typeof process !== 'undefined' && process.argv && process.argv[1]) {
  try {
    const { fileURLToPath } = await import('node:url');
    if (fileURLToPath(import.meta.url) === process.argv[1]) _main();
  } catch {}
}
