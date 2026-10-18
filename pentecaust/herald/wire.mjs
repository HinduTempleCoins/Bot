// pentecaust/herald/wire.mjs — Herald PRESS WIRE: our own EIN-Presswire / PR Newswire alternative.
//
// WHAT IT IS. The newsroom (newsroom.mjs) is our MSN/Yahoo-style news PORTAL (our originals + aggregated
// industry categories). THIS is the complementary WIRE: a formal press-release distribution service. Each
// release is a structured, AP-style document with its own permanent URL, full NewsArticle JSON-LD,
// OG/Twitter cards and canonical — one per MELEK/SoapBox SURFACE to start, and (optionally, moderated)
// submittable by others later. On publish each release is HANDED to our distribution (integrations/
// syndicate) so it fans out everywhere, link-bearing. Mounted at herald.soapbox.community/press.
//
// FLOW:  marketing/press/releases/**/*.md  (front-matter: title, dek, dateline, byline, category, beat,
//        date, contact, boilerplate, image, links)  ──load──▶  normalized release record  ──render──▶
//        permanent /press/release/:slug page + /press/rss.xml + /press/feed.json + /press/news-sitemap.xml
//        ──enqueue──▶  syndicate (nostr / websub / telegram / discord / mastodon / bluesky / hive).
//
// SUBMIT (EIN-style, OFF by default): others may POST a release at /press/submit — SSRF-checked (reusing
// the Directory/webring guard), queued, and MODERATED (nothing auto-publishes). Enabled only when
// WIRE_SUBMIT_OPEN=on; moderation is token-gated (WIRE_TOKEN / STATS_TOKEN) exactly like the web ring.
//
// House style: ESM, esc()/xesc() on every interpolation, injectable fetch + fs, soft-fail-never-throw,
// async handler(req,res,opts) exported for tests, CLI guarded. Holds no key, signs nothing, never
// broadcasts itself (distribution is delegated to the syndicate engine, which is itself injectable).

import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, appendFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { headTags } from '../../integrations/soapbox/seo.mjs';
import { keywordsFor, suggestForTopic } from './tags.mjs';
import { safeUrl, dedupeKey } from '../../integrations/soapbox/submissions.mjs';

const env = (k, d = '') => (typeof process !== 'undefined' && process.env && process.env[k]) || d;
export const BASE_URL = () => env('WIRE_BASE_URL', env('BASE_URL', 'https://herald.soapbox.community') + '/press').replace(/\/+$/, '');
export const RELEASES_DIR = () => env('WIRE_RELEASES_DIR', join(process.cwd(), 'marketing', 'press', 'releases'));
export const SUBMIT_FILE = () => env('WIRE_SUBMISSIONS', join(process.cwd(), 'data', 'wire-submissions.jsonl'));
const SITE_NAME = () => env('WIRE_SITE_NAME', 'SoapBox Wire');
const PUBLISHER = () => env('WIRE_PUBLISHER', 'Van Kush Family / SoapBox');
// EIN-style open submission is OFF unless explicitly turned on (one-line deploy flip).
export const submitOpen = () => /^(1|on|true|yes)$/i.test(env('WIRE_SUBMIT_OPEN', ''));

export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const xesc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
const slugify = (s) => String(s == null ? '' : s).toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 90);

let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = typeof fn === 'function' ? fn : ((...a) => globalThis.fetch(...a)); }
// distribution is delegated + injectable so tests never touch the network and a caller can dry-run.
let _syndicate = null;
export function __setSyndicate(fn) { _syndicate = typeof fn === 'function' ? fn : null; }
async function syndicateFn(item, opts) {
  if (_syndicate) return _syndicate(item, opts);
  try { const m = await import('../../integrations/syndicate/syndicate.mjs'); return m.syndicate(item, opts); }
  catch (e) { return { ok: false, error: String(e && e.message || e) }; }
}

// ── PILLARS (the ecosystem verticals) + BEATS (the 75 news beats) ───────────────────────────────────────
export const PILLARS = [
  { slug: 'melek', name: 'MELEK', blurb: 'The MELEK blockchain, witnesses, tokens and launches.' },
  { slug: 'prana', name: 'PRANA', blurb: 'The PRANA community-owned AI-compute chain.' },
  { slug: 'kula', name: 'KULA', blurb: 'The KULA economic layer and KulaSwap DEX.' },
  { slug: 'soapbox', name: 'SoapBox', blurb: 'SoapBox web properties, media and community surfaces.' },
  { slug: 'hathor', name: 'Hathor', blurb: 'Hathor — the AI founding witness.' },
];
export const PILLAR_BY_SLUG = Object.fromEntries(PILLARS.map((p) => [p.slug, p]));
export const isPillar = (s) => Object.prototype.hasOwnProperty.call(PILLAR_BY_SLUG, s);

function loadBeats() {
  try { const o = JSON.parse(realFs.read(env('WIRE_BEATS', join(process.cwd(), 'data', 'news-topics.json'))) || '{}'); return Array.isArray(o.topics) ? o.topics : []; }
  catch { return []; }
}
const realFs = {
  read: (p) => { try { return readFileSync(p, 'utf8'); } catch { return null; } },
  write: (p, s) => { try { mkdirSync(dirname(p), { recursive: true }); } catch {} try { writeFileSync(p, s); return true; } catch { return false; } },
  list: (dir) => { const out = []; const walk = (d) => { let ents; try { ents = readdirSync(d); } catch { return; } for (const e of ents) { const fp = join(d, e); let st; try { st = statSync(fp); } catch { continue; } if (st.isDirectory()) walk(fp); else if (/\.(md|markdown|txt)$/i.test(e)) out.push(fp); } }; walk(dir); return out; },
  append: (p, s) => { try { mkdirSync(dirname(p), { recursive: true }); } catch {} try { appendFileSync(p, s); return true; } catch { return false; } },
};
export const BEATS = loadBeats();
const BEAT_BY_SLUG = Object.fromEntries(BEATS.map((t) => [t.slug, t]));
export const isBeat = (s) => Object.prototype.hasOwnProperty.call(BEAT_BY_SLUG, s);

// ── front-matter parser (tolerant; --- fenced key:value + a `links:` list) ──────────────────────────────
export function parseFrontMatter(text) {
  const s = String(text == null ? '' : text);
  const m = s.match(/^﻿?---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
  if (!m) return { meta: {}, body: s.trim() };
  const meta = {}; let listKey = null;
  for (const raw of m[1].split('\n')) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) { listKey = null; continue; }
    const li = line.match(/^\s*-\s+(.*)$/);
    if (li && listKey) { (meta[listKey] = meta[listKey] || []).push(stripQuotes(li[1])); continue; }
    const kv = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
    if (!kv) { listKey = null; continue; }
    const key = kv[1].trim(); const val = kv[2].trim();
    if (val === '') { meta[key] = []; listKey = key; }      // start of a list (or empty)
    else { meta[key] = stripQuotes(val); listKey = null; }
  }
  return { meta, body: m[2].trim() };
}
const stripQuotes = (v) => String(v).replace(/^["']|["']$/g, '').trim();

// ── normalize a release record ──────────────────────────────────────────────────────────────────────────
export function normalizeRelease(raw = {}, body = '') {
  const title = String(raw.title || raw.headline || '').trim();
  if (!title) return null;
  let category = String(raw.pillar || raw.category || 'soapbox').toLowerCase();
  if (!isPillar(category)) category = 'soapbox';
  let beat = String(raw.beat || '').toLowerCase();
  if (beat && !isBeat(beat)) beat = '';
  const d = raw.date ? new Date(raw.date) : new Date();
  const iso = isNaN(d) ? new Date().toISOString() : d.toISOString();
  const slug = slugify(raw.slug || title) || ('release-' + Date.parse(iso));
  const links = []; const rawLinks = [].concat(raw.links || []).filter(Boolean);
  for (const l of rawLinks) { const safe = safeUrl(typeof l === 'string' ? l : (l && l.url)); if (safe) links.push({ url: safe, label: (l && l.label) ? String(l.label) : safe }); }
  return {
    slug,
    title,
    dek: String(raw.dek || raw.subheadline || raw.sub || '').trim(),
    dateline: String(raw.dateline || '').trim(),
    byline: String(raw.byline || PUBLISHER()).trim(),
    body: String(body || raw.body || '').trim(),
    boilerplate: String(raw.boilerplate || raw.about || '').trim(),
    contact: String(raw.contact || raw.media_contact || '').trim(),
    category, beat,
    date: iso,
    image: (safeUrl(raw.image) || '').toString(),
    links,
    canonical: (safeUrl(raw.canonical) || '').toString(),
    source: String(raw.source || '').trim() || null,  // set for moderated external submissions
  };
}

// ── load authored releases from the content dir (soft-fail → []) ────────────────────────────────────────
export function loadReleases(opts = {}) {
  const fs = opts.fs || realFs;
  const dir = opts.dir || RELEASES_DIR();
  let files;
  try { files = (fs.list || realFs.list)(dir); } catch { files = []; }
  const out = [];
  for (const f of files || []) {
    const text = (fs.read || realFs.read)(f);
    if (!text) continue;
    const { meta, body } = parseFrontMatter(text);
    const rec = normalizeRelease(meta, body);
    if (rec) out.push(rec);
  }
  // Herald × GenAI merge: releases with no authored image fall back to native-generated art
  // (sidecar data/release-art.json, produced by release-art.mjs on the CPU-SD worker). No network here.
  const art = loadReleaseArt(opts);
  if (art) for (const r of out) { if (!r.image && art[r.slug]) r.image = art[r.slug]; }
  return out;
}

let _artCache = null, _artAt = 0;
function loadReleaseArt(opts = {}) {
  if (opts.artMap) return opts.artMap;
  const now = Date.now();
  if (_artCache && now - _artAt < 60000) return _artCache;
  try {
    const file = env('RELEASE_ART_FILE', join(process.cwd(), 'data', 'release-art.json'));
    _artCache = JSON.parse(realFs.read(file) || '{}'); _artAt = now;
  } catch { _artCache = {}; _artAt = now; }
  return _artCache;
}

// ── submission store (EIN-style; JSONL, append-only, moderated — mirrors the web ring) ──────────────────
export class WireStore {
  constructor({ file = null } = {}) { this.file = file || null; this._mem = file ? null : []; }
  _lines() {
    if (!this.file) return this._mem.slice();
    const txt = realFs.read(this.file); if (!txt) return [];
    const out = []; for (const line of txt.split('\n')) { const t = line.trim(); if (!t) continue; try { out.push(JSON.parse(t)); } catch {} }
    return out;
  }
  _append(rec) {
    const line = JSON.stringify(rec);
    if (!this.file) { this._mem.push(JSON.parse(line)); return true; }
    return realFs.append(this.file, line + '\n');
  }
  all() {
    const byKey = new Map();
    for (const o of this._lines()) { if (!o || !o.slug) continue; byKey.set(o.slug, o); }
    return [...byKey.values()].sort((a, b) => String(b.date).localeCompare(String(a.date)));
  }
  pending() { return this.all().filter((s) => s.status === 'submitted'); }
  approved() { return this.all().filter((s) => s.status === 'approved'); }
  find(slug) { return this.all().find((s) => s.slug === slug) || null; }
  submit(raw = {}) {
    const rec = normalizeRelease(raw, raw.body);
    if (!rec) return { ok: false, error: 'headline required' };
    if (!rec.body || rec.body.length < 40) return { ok: false, error: 'body too short' };
    // make the submitted slug unique against what's already queued
    let slug = rec.slug; const existing = new Set(this.all().map((s) => s.slug));
    let n = 2; const base = slug; while (existing.has(slug)) slug = `${base}-${n++}`;
    const stored = { ...rec, slug, source: String(raw.source || raw.org || 'External submission').trim() || 'External submission', status: 'submitted', submitted_by: String(raw.by || '').slice(0, 80) || null, ts: Date.now() };
    if (!this._append(stored)) return { ok: false, error: 'write_failed' };
    return { ok: true, record: stored };
  }
  moderate(slug, action) {
    const entry = this.find(slug);
    if (!entry) return { ok: false, error: 'not_found' };
    if (action === 'approve') entry.status = 'approved';
    else if (action === 'reject') entry.status = 'rejected';
    else return { ok: false, error: 'bad_action' };
    entry.moderated_at = Date.now();
    if (!this._append(entry)) return { ok: false, error: 'write_failed' };
    return { ok: true, record: entry };
  }
}
let _store = null;
function defaultStore() { if (!_store) _store = new WireStore({ file: SUBMIT_FILE() }); return _store; }

// ── the combined published set: authored releases + approved submissions ────────────────────────────────
export function listReleases({ pillar = null, beat = null, limit = 200, offset = 0 } = {}, opts = {}) {
  const authored = Array.isArray(opts.releases) ? opts.releases.map((r) => (r && r.slug ? r : normalizeRelease(r, r && r.body))).filter(Boolean) : loadReleases(opts);
  const store = opts.store || defaultStore();
  let approved = []; try { approved = store.approved(); } catch {}
  const bySlug = new Map();
  for (const r of [...authored, ...approved]) if (r && r.slug && !bySlug.has(r.slug)) bySlug.set(r.slug, r);
  let items = [...bySlug.values()].sort((a, b) => String(b.date).localeCompare(String(a.date)));
  if (pillar && isPillar(pillar)) items = items.filter((x) => x.category === pillar);
  if (beat && isBeat(beat)) items = items.filter((x) => x.beat === beat);
  return items.slice(offset, offset + Math.max(0, limit));
}
export function getRelease(slug, opts = {}) { return listReleases({ limit: 100000 }, opts).find((x) => x.slug === slug) || null; }

// ── distribution: hand a release to the syndicate engine (link-bearing) ─────────────────────────────────
export function releaseUrl(r) { return r.canonical || `${BASE_URL()}/release/${encodeURIComponent(r.slug)}`; }
const firstPara = (b) => String(b || '').split(/\n{2,}/).map((s) => s.replace(/[#>*_`]/g, '').trim()).filter(Boolean)[0] || '';
export function toSyndicateItem(r) {
  return {
    title: r.title,
    summary: r.dek || firstPara(r.body),
    url: releaseUrl(r),
    feed: `${BASE_URL()}/rss.xml`,
    image: r.image || '',
    body: plainText(r.body),
    tags: [r.category, r.beat, 'press-release'].filter(Boolean),
  };
}
export async function distributeRelease(slug, opts = {}) {
  const r = getRelease(slug, opts);
  if (!r) return { ok: false, error: 'not_found' };
  const item = toSyndicateItem(r);
  const out = await syndicateFn(item, { dryRun: !!opts.dryRun, ...(opts.syndicate || {}) });
  return { ok: true, slug, item: { title: item.title, url: item.url }, result: out };
}

// ── AP-style body rendering + plain-text extraction ─────────────────────────────────────────────────────
const SAFE_LINK = /^https?:\/\/[^\s)]+$/i;
function mdInline(s) {
  // esc first, then re-introduce the small set of allowed inline markup on the escaped text.
  let out = esc(s);
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (m, text, url) => {
    const u = url.replace(/&amp;/g, '&');
    return SAFE_LINK.test(u) ? `<a href="${esc(u)}" rel="noopener">${text}</a>` : text;
  });
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
  return out;
}
function renderBody(body) {
  return String(body || '').split(/\n{2,}/).map((blk) => {
    const t = blk.trim();
    if (!t) return '';
    if (t === '---') return '<hr>';
    if (/^#{1,6}\s/.test(t)) { const h = Math.min(6, t.match(/^#+/)[0].length + 1); return `<h${h}>${mdInline(t.replace(/^#{1,6}\s+/, ''))}</h${h}>`; }
    if (/^>\s?/.test(t)) return `<blockquote>${t.split('\n').map((l) => mdInline(l.replace(/^>\s?/, ''))).join('<br>')}</blockquote>`;
    if (/^(\d+\.|-)\s/.test(t)) { const ol = /^\d+\./.test(t); const items = t.split('\n').map((l) => l.replace(/^(\d+\.|-)\s+/, '')).filter(Boolean); return `<${ol ? 'ol' : 'ul'}>${items.map((i) => `<li>${mdInline(i)}</li>`).join('')}</${ol ? 'ol' : 'ul'}>`; }
    return `<p>${t.split('\n').map(mdInline).join(' ')}</p>`;
  }).filter(Boolean).join('\n');
}
export function plainText(body) {
  return String(body || '').replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1').replace(/[#>*_`]/g, '').replace(/\n{2,}/g, '\n\n').trim();
}
const datelineOut = (r) => { const dl = (r.dateline || '').trim(); return dl ? dl.toUpperCase() + ' —' : ''; };

// ── page shell (shared head via seo.headTags) ───────────────────────────────────────────────────────────
const STYLE = `<style>
:root{--bg:#0e1016;--fg:#e7e9ee;--mut:#9aa3b2;--line:#232838;--acc:#36d399;--card:#161a26}
@media(prefers-color-scheme:light){:root:not([data-theme=dark]){--bg:#f7f8fb;--fg:#15181f;--mut:#5a6372;--line:#e2e6ef;--acc:#0a7d53;--card:#fff}}
:root[data-theme=dark]{--bg:#0e1016;--fg:#e7e9ee;--mut:#9aa3b2;--line:#232838;--acc:#36d399;--card:#161a26}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
a{color:var(--acc);text-decoration:none}a:hover{text-decoration:underline}
html{scroll-padding-top:92px}
header{border-bottom:1px solid var(--line);padding:12px 16px;position:sticky;top:0;background:var(--bg);z-index:5}
.wrap{max-width:860px;margin:0 auto;padding:0 16px}.brand{font-weight:800;font-size:20px;color:var(--fg)}.brand b{color:var(--acc)}
nav.pill{display:flex;gap:14px;flex-wrap:nowrap;overflow-x:auto;margin-top:7px;font-size:13px;-webkit-overflow-scrolling:touch;scrollbar-width:thin;overscroll-behavior-x:contain}nav.pill a{color:var(--mut);white-space:nowrap}
nav.pill::-webkit-scrollbar{height:0}
main{max-width:860px;margin:0 auto;padding:18px 16px 60px}
h1.sec{font-size:14px;text-transform:uppercase;letter-spacing:.08em;color:var(--mut);border-bottom:1px solid var(--line);padding-bottom:6px;margin:24px 0 10px}
.rel{display:block;padding:12px 0;border-bottom:1px solid var(--line)}.rel:last-child{border-bottom:0}
.rel .t{font-weight:700;font-size:18px;color:var(--fg)}.rel .d{color:var(--mut);font-size:14px;margin-top:3px}.rel .m{color:var(--mut);font-size:12px;margin-top:5px;text-transform:uppercase;letter-spacing:.04em}
.ffi{color:var(--acc);font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase}
article.pr{max-width:720px}article.pr .body p{margin:0 0 16px}article.pr .body h2{font-size:21px;margin:28px 0 10px}article.pr .body h3{font-size:18px}
article.pr .body blockquote{border-left:3px solid var(--acc);margin:0 0 16px;padding:4px 0 4px 16px;color:var(--mut)}
article.pr .body table{border-collapse:collapse;width:100%;font-size:14px;margin:0 0 16px}article.pr .body td,article.pr .body th{border:1px solid var(--line);padding:6px 9px;text-align:left}
.box{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px 16px;margin-top:18px;font-size:14px;color:var(--mut)}
.box b{color:var(--fg)}
.foot{color:var(--mut);font-size:13px;border-top:1px solid var(--line);margin-top:30px;padding-top:14px}
.empty{color:var(--mut);font-size:14px;padding:12px 0}
form.sub{display:grid;gap:10px;max-width:620px;margin-top:8px}
input,select,textarea{background:var(--bg);border:1px solid var(--line);border-radius:8px;color:var(--fg);padding:10px 12px;font:inherit;width:100%}
button{cursor:pointer;background:var(--acc);border:0;border-radius:8px;color:#04121f;font-weight:700;padding:11px 20px;font-size:15px;justify-self:start}
.hp{position:absolute;left:-9999px}
.ok{background:rgba(54,211,153,.13);border:1px solid var(--acc);border-radius:8px;padding:12px 14px}
.warn{background:rgba(217,164,65,.12);border:1px solid #d9a441;border-radius:8px;padding:12px 14px}
</style>`;
const PILLNAV = () => [`<a href="${esc(BASE_URL())}">Wire</a>`, `<a href="${esc(BASE_URL())}/categories">Categories</a>`, `<a href="${esc(BASE_URL())}/distribution">Distribution</a>`, `<a href="${esc(BASE_URL())}/embed">Embed</a>`, ...PILLARS.map((p) => `<a href="${esc(BASE_URL())}/pillar/${esc(p.slug)}">${esc(p.name)}</a>`), `<a href="${esc(BASE_URL())}/submit">Submit a release</a>`].join('');
function page({ title, desc = '', canonical = '', jsonld = null, body = '', keywords = [] }) {
  const head = headTags({ title, description: desc || SITE_NAME(), canonical, siteName: SITE_NAME(), ogType: 'article', site: { url: BASE_URL(), name: SITE_NAME() }, jsonld, keywords });
  return `<!doctype html><html lang=en><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<link rel="alternate" type="application/rss+xml" title="${esc(SITE_NAME())}" href="${esc(BASE_URL())}/rss.xml">
${head}${STYLE}</head><body>
<header><div class=wrap><div class=brand><a href="${esc(BASE_URL())}">SoapBox <b>Wire</b></a></div><nav class=pill>${PILLNAV()}</nav></div></header>
<main>${body}</main>
<footer class=wrap><div class=foot>${esc(SITE_NAME())} — the press wire of ${esc(PUBLISHER())}. Feeds: <a href="${esc(BASE_URL())}/rss.xml">RSS</a> · <a href="${esc(BASE_URL())}/feed.json">JSON</a> · <a href="${esc(BASE_URL())}/news-sitemap.xml">news-sitemap</a>. Every release has a permanent URL and is distributed across our channels.</div></footer>
</body></html>`;
}

const relRow = (r) => `<a class=rel href="${esc(releaseUrl(r))}"><div class=t>${esc(r.title)}</div>${r.dek ? `<div class=d>${esc(r.dek)}</div>` : ''}<div class=m><span class=ffi>${r.source ? 'Submitted' : 'Press Release'}</span> · ${esc((PILLAR_BY_SLUG[r.category] || {}).name || r.category)}${r.beat ? ' · ' + esc((BEAT_BY_SLUG[r.beat] || {}).name || r.beat) : ''} · ${esc(String(r.date).slice(0, 10))}</div></a>`;

export function renderIndex(opts = {}) {
  const items = listReleases({ limit: 100 }, opts);
  const counts = PILLARS.map((p) => ({ p, n: listReleases({ pillar: p.slug, limit: 100000 }, opts).length }));
  const pillarBar = `<div class=box><b>By pillar:</b> ${counts.map(({ p, n }) => `<a href="${esc(BASE_URL())}/pillar/${esc(p.slug)}">${esc(p.name)} (${n})</a>`).join(' · ')}</div>`;
  const body = `<h1 style="font-size:28px;margin:6px 0 4px">SoapBox Wire</h1>
    <p style="color:var(--mut);margin-top:0">Our own press wire — a permanent, structured, syndicated home for every MELEK / PRANA / KULA / SoapBox / Hathor announcement. Each release has its own URL, full structured data, and goes out across our distribution. <a href="${esc(BASE_URL())}/submit">Submit a release →</a></p>
    ${pillarBar}
    <h1 class=sec>Latest releases</h1>
    ${items.length ? items.map(relRow).join('') : '<div class=empty>No releases yet — the wire fills from marketing/press/releases and from moderated submissions.</div>'}`;
  return page({ title: SITE_NAME(), desc: 'The SoapBox / MELEK press wire — permanent, structured, syndicated press releases.', canonical: BASE_URL() + '/', body });
}

// ── Categories index, Distribution/reach, and Embeddable widgets (newswire-site features) ─────────────
export function renderCategories(opts = {}) {
  const pillarRows = PILLARS.map((p) => {
    const n = listReleases({ pillar: p.slug, limit: 100000 }, opts).length;
    return `<a class=rel href="${esc(BASE_URL())}/pillar/${esc(p.slug)}"><div class=t>${esc(p.name)} <span style="color:var(--mut);font-weight:400">(${n})</span></div><div class=d>${esc(p.blurb)}</div><div class=m><span class=ffi>Pillar</span> · <a href="${esc(BASE_URL())}/pillar/${esc(p.slug)}/rss.xml">RSS feed</a></div></a>`;
  }).join('');
  const beatRows = BEATS.map((b) => {
    const n = listReleases({ beat: b.slug, limit: 100000 }, opts).length;
    return `<a class=rel href="${esc(BASE_URL())}/beat/${esc(b.slug)}"><div class=t style="font-size:15px">${esc(b.name)}${n ? ` <span style="color:var(--mut);font-weight:400">(${n})</span>` : ''}</div><div class=m><a href="${esc(BASE_URL())}/beat/${esc(b.slug)}/rss.xml">RSS</a></div></a>`;
  }).join('');
  const body = `<h1 style="font-size:28px;margin:6px 0 4px">Categories</h1>
    <p style="color:var(--mut);margin-top:0">Every pillar and beat has its own page and its own RSS feed — the newswire-style industry sections. ${BEATS.length} beats across ${PILLARS.length} pillars. Any of these can be <a href="${esc(BASE_URL())}/embed">embedded</a> on another site.</p>
    <h1 class=sec>Pillars (${PILLARS.length})</h1>${pillarRows}
    <h1 class=sec>Beats (${BEATS.length})</h1>${beatRows}`;
  return page({ title: 'Categories — ' + SITE_NAME(), desc: 'Browse the SoapBox Wire by pillar and beat — every category has its own page and RSS feed.', canonical: BASE_URL() + '/categories', body });
}

export function renderDistribution(opts = {}) {
  const b = BASE_URL();
  const body = `<h1 style="font-size:28px;margin:6px 0 4px">Distribution &amp; Reach</h1>
    <p style="color:var(--mut);margin-top:0">Where every release goes — automatically, free, and permanently. This is our equivalent of a paid newswire's syndication network, run entirely on our own infrastructure, with nothing that can deplatform us.</p>
    <h1 class=sec>Search &amp; AI</h1>
    <div class=box><b>Google News</b> (NewsArticle structured data + a news-sitemap) · <b>IndexNow</b> → Bing · Yandex · Seznam · Naver (which feed Copilot, ChatGPT Search and Perplexity) · every AI and search crawler welcomed by name, with an <a href="${esc(b)}/robots.txt">robots</a> + llms.txt.</div>
    <h1 class=sec>Feeds anyone can ingest</h1>
    <div class=box>Global <a href="${esc(b)}/rss.xml">RSS</a> · <a href="${esc(b)}/feed.json">JSON Feed</a> · <a href="${esc(b)}/news-sitemap.xml">news-sitemap</a> — plus a <b>per-pillar and per-beat RSS feed</b> (${BEATS.length} beat feeds, on the <a href="${esc(b)}/categories">Categories</a> page) · and <b>WebSub</b> push for real-time subscribers.</div>
    <h1 class=sec>Decentralized &amp; undeplatformable</h1>
    <div class=box><b>Nostr</b> (multiple public relays) · the <b>fediverse / Mastodon</b> · <b>Bluesky</b> — every release fans out across our social channels and is permanently timestamped.</div>
    <h1 class=sec>Put it on your own site</h1>
    <div class=box>Any site can embed the wire — a widget or a feed. See <a href="${esc(b)}/embed">Widgets &amp; Embed →</a></div>
    <h1 class=sec>Get listed</h1>
    <div class=box>Have a release? <a href="${esc(b)}/submit">Submit it</a> — free, permanent, and distributed across everything above. A human reviews each submission before it publishes.</div>`;
  return page({ title: 'Distribution & Reach — ' + SITE_NAME(), desc: 'Where SoapBox Wire releases are distributed — Google News, Bing/Yandex via IndexNow, Nostr, the fediverse, RSS/JSON feeds, and embeddable widgets.', canonical: b + '/distribution', body });
}

function embedSnippet(kind, slug) {
  const src = `${BASE_URL()}/embed/${kind}${slug ? ('/' + slug) : ''}`;
  return `<iframe src="${src}" width="100%" height="460" loading="lazy" title="SoapBox Wire" style="border:1px solid #e2e6ef;border-radius:10px"></iframe>`;
}
export function renderEmbed(opts = {}) {
  const b = BASE_URL();
  const block = (label, code) => `<h1 class=sec>${esc(label)}</h1><textarea readonly rows=3 onclick="this.select()" style="font:12px/1.5 ui-monospace,Menlo,monospace">${esc(code)}</textarea>`;
  const firstBeat = BEATS[0] ? BEATS[0].slug : 'cryptocurrency';
  const body = `<h1 style="font-size:28px;margin:6px 0 4px">Widgets &amp; Embed</h1>
    <p style="color:var(--mut);margin-top:0">Put the SoapBox Wire on your own site. Copy a snippet below — it updates itself. Prefer a raw feed? Use the <a href="${esc(b)}/rss.xml">RSS</a> / <a href="${esc(b)}/feed.json">JSON</a>, or a per-beat feed from <a href="${esc(b)}/categories">Categories</a>.</p>
    ${block('Latest releases', embedSnippet('latest'))}
    ${block('A pillar (e.g. MELEK — swap the slug for any pillar)', embedSnippet('pillar', 'melek'))}
    ${block('A beat (swap the slug for any beat from Categories)', embedSnippet('beat', firstBeat))}
    ${block('A single release (use the release slug)', embedSnippet('release', 'your-release-slug'))}
    <h1 class=sec>JavaScript loader (no iframe)</h1>
    <p style="color:var(--mut);font-size:13px;margin:0 0 6px">Drop a div + our loader anywhere; it injects the widget inline.</p>
    <textarea readonly rows=2 onclick="this.select()" style="font:12px/1.5 ui-monospace,Menlo,monospace">${esc(`<div data-soapbox-wire="latest" data-count="5"></div>\n<script async src="${b}/widget.js"><\/script>`)}</textarea>
    <div class=box style="margin-top:20px"><b>Live preview</b><br>${embedSnippet('latest')}</div>`;
  return page({ title: 'Widgets & Embed — ' + SITE_NAME(), desc: 'Embed the SoapBox Wire on any site — iframe widgets, a JS loader, and RSS/JSON feeds.', canonical: b + '/embed', body });
}

export function renderWidget(kind, slug, opts = {}) {
  let items, title;
  if (kind === 'release') { const r = getRelease(slug, opts); if (!r) return null; items = [r]; title = r.title; }
  else if (kind === 'pillar') { if (!isPillar(slug)) return null; items = listReleases({ pillar: slug, limit: 8 }, opts); title = (PILLAR_BY_SLUG[slug] || {}).name || slug; }
  else if (kind === 'beat') { if (!isBeat(slug)) return null; items = listReleases({ beat: slug, limit: 8 }, opts); title = (BEAT_BY_SLUG[slug] || {}).name || slug; }
  else { items = listReleases({ limit: 8 }, opts); title = 'Latest'; }
  const rows = items.map((r) => `<a href="${esc(releaseUrl(r))}" target="_blank" rel="noopener" class=r><div class=t>${esc(r.title)}</div>${r.dek ? `<div class=d>${esc(String(r.dek).slice(0, 110))}</div>` : ''}</a>`).join('');
  return `<!doctype html><html lang=en><head><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>SoapBox Wire</title>
<style>:root{color-scheme:light dark}body{margin:0;font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#fff;color:#15181f}@media(prefers-color-scheme:dark){body{background:#0e1016;color:#e7e9ee}.r{border-color:#232838!important}.t{color:#e7e9ee!important}.f{border-color:#232838!important}}
.w{padding:10px 13px}.h{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:#0a7d53;font-weight:800;margin-bottom:5px}
.r{display:block;padding:9px 0;border-bottom:1px solid #e2e6ef;text-decoration:none}.r:last-child{border-bottom:0}.t{font-weight:700;color:#15181f;font-size:14px}.d{color:#5a6372;font-size:12px;margin-top:2px}
.f{font-size:11px;color:#9aa3b2;padding:8px 13px;border-top:1px solid #e2e6ef}.f a{color:#0a7d53;text-decoration:none}</style></head>
<body><div class=w><div class=h>SoapBox Wire · ${esc(title || '')}</div>${rows || '<div style="color:#9aa3b2">No releases yet.</div>'}</div>
<div class=f>Powered by <a href="${esc(BASE_URL())}" target="_blank" rel="noopener">herald.soapbox.community</a></div></body></html>`;
}

export function widgetJs() {
  return `(function(){var base=${JSON.stringify(BASE_URL())};[].forEach.call(document.querySelectorAll('[data-soapbox-wire]'),function(el){var kind=el.getAttribute('data-soapbox-wire')||'latest';var slug=el.getAttribute('data-slug')||'';var h=el.getAttribute('data-height')||'460';var f=document.createElement('iframe');f.src=base+'/embed/'+kind+(slug?'/'+slug:'');f.width='100%';f.height=h;f.loading='lazy';f.title='SoapBox Wire';f.style.border='1px solid #e2e6ef';f.style.borderRadius='10px';el.innerHTML='';el.appendChild(f);});})();`;
}

export function renderRelease(slug, opts = {}) {
  const r = getRelease(slug, opts); if (!r) return null;
  const pillar = PILLAR_BY_SLUG[r.category] || {};
  const url = `${BASE_URL()}/release/${encodeURIComponent(r.slug)}`;
  const { keywords, hashtags } = keywordsFor({ title: r.title, dek: r.dek, body: plainText(r.body), extra: [(PILLAR_BY_SLUG[r.category] || {}).name || r.category, r.beat].filter(Boolean) });
  const ld = {
    '@context': 'https://schema.org', '@type': 'NewsArticle',
    headline: r.title, description: r.dek || firstPara(r.body),
    datePublished: r.date, dateModified: r.date,
    author: [{ '@type': 'Organization', name: r.byline || PUBLISHER() }],
    publisher: { '@type': 'Organization', name: PUBLISHER() },
    mainEntityOfPage: url, articleSection: pillar.name || r.category,
    keywords: keywords.join(', '),
    articleBody: plainText(r.body),
    image: r.image ? [r.image] : undefined,
  };
  for (const k of Object.keys(ld)) if (ld[k] === undefined) delete ld[k];
  const linksBlock = r.links.length ? `<div class=box><b>Links:</b> ${r.links.map((l) => `<a href="${esc(l.url)}" rel="noopener">${esc(l.label)}</a>`).join(' · ')}</div>` : '';
  const contactBlock = r.contact ? `<div class=box><b>Media contact:</b> ${esc(r.contact)}</div>` : '';
  const boilerBlock = r.boilerplate ? `<div class=box><b>About:</b> ${esc(r.boilerplate)}</div>` : '';
  const srcNote = r.source ? `<div class=box>This release was submitted by <b>${esc(r.source)}</b> and reviewed before publication. ${esc(SITE_NAME())} distributes it as received; the submitter is responsible for its claims.</div>` : '';
  const dl = datelineOut(r);
  const lead = `${dl ? `<strong>${esc(dl)}</strong> ` : ''}`;
  const body = `<article class=pr>
    <div class=ffi>For Immediate Release · ${esc(String(r.date).slice(0, 10))}</div>
    <h1 style="font-size:30px;line-height:1.2;margin:6px 0 8px">${esc(r.title)}</h1>
    ${r.dek ? `<p style="font-size:19px;color:var(--mut);margin:0 0 12px">${esc(r.dek)}</p>` : ''}
    <div class=m style="color:var(--mut);font-size:13px;margin-bottom:16px;text-transform:uppercase;letter-spacing:.04em">${esc((PILLAR_BY_SLUG[r.category] || {}).name || r.category)}${r.beat ? ` · <a href="${esc(BASE_URL())}/beat/${esc(r.beat)}">${esc((BEAT_BY_SLUG[r.beat] || {}).name || r.beat)}</a>` : ''} · By ${esc(r.byline || PUBLISHER())}</div>
    ${r.image ? `<img src="${esc(r.image)}" alt="${esc(r.title)}" style="max-width:100%;border-radius:10px;margin-bottom:16px">` : ''}
    <div class=body>${lead}${renderBody(r.body)}</div>
    ${linksBlock}${contactBlock}${boilerBlock}${srcNote}
    ${hashtags.length ? `<div class=box><b>Topics:</b> ${hashtags.map((h) => `<a href="${esc(BASE_URL())}/keywords?q=${encodeURIComponent(h.replace(/^#/, ''))}" rel="tag">${esc(h)}</a>`).join(' ')}</div>` : ''}
    <div class=box><b>Distribution:</b> this release is carried across SoapBox Wire and syndicated to our channels. <b>Republishing?</b> Pick it up freely — attribute ${esc(PUBLISHER())} and link ${esc(url)}.</div>
  </article>`;
  return page({ title: `${r.title} — ${SITE_NAME()}`, desc: r.dek || firstPara(r.body), canonical: r.canonical || url, jsonld: ld, body, keywords });
}

export function renderPillar(slug, opts = {}) {
  const p = PILLAR_BY_SLUG[slug]; if (!p) return null;
  const items = listReleases({ pillar: slug, limit: 200 }, opts);
  const body = `<h1 style="font-size:26px;margin:6px 0 2px">${esc(p.name)} — press releases</h1>
    <p style="color:var(--mut);margin-top:0">${esc(p.blurb)} · <a href="${esc(BASE_URL())}/pillar/${esc(slug)}/rss.xml">RSS</a></p>
    ${items.length ? items.map(relRow).join('') : '<div class=empty>No releases in this pillar yet.</div>'}`;
  return page({ title: `${p.name} — ${SITE_NAME()}`, desc: p.blurb, canonical: `${BASE_URL()}/pillar/${slug}`, body });
}
export function renderBeat(slug, opts = {}) {
  const t = BEAT_BY_SLUG[slug]; if (!t) return null;
  const items = listReleases({ beat: slug, limit: 200 }, opts);
  const body = `<h1 style="font-size:26px;margin:6px 0 2px">${esc(t.name)} — press releases</h1>
    <p style="color:var(--mut);margin-top:0">Press releases on the ${esc(t.name)} beat${t.group ? ` · ${esc(t.group)}` : ''} · <a href="${esc(BASE_URL())}/beat/${esc(slug)}/rss.xml">RSS</a></p>
    ${items.length ? items.map(relRow).join('') : '<div class=empty>No releases on this beat yet.</div>'}`;
  return page({ title: `${t.name} press releases — ${SITE_NAME()}`, desc: `Press releases on the ${t.name} beat.`, canonical: `${BASE_URL()}/beat/${slug}`, body });
}

// ── feeds ───────────────────────────────────────────────────────────────────────────────────────────────
const rfc822 = (iso) => { const d = new Date(iso); return isNaN(d) ? new Date().toUTCString() : d.toUTCString(); };
export function renderRss({ pillar = null, beat = null } = {}, opts = {}) {
  const list = listReleases({ pillar, beat, limit: 100 }, opts);
  const scope = pillar ? (PILLAR_BY_SLUG[pillar] || {}).name : beat ? (BEAT_BY_SLUG[beat] || {}).name : null;
  const self = pillar ? `${BASE_URL()}/pillar/${pillar}/rss.xml` : beat ? `${BASE_URL()}/beat/${beat}/rss.xml` : `${BASE_URL()}/rss.xml`;
  const entries = list.map((r) => ['  <item>',
    `    <title>${xesc(r.title)}</title>`,
    `    <link>${xesc(releaseUrl(r))}</link>`,
    `    <guid isPermaLink="true">${xesc(`${BASE_URL()}/release/${encodeURIComponent(r.slug)}`)}</guid>`,
    `    <pubDate>${xesc(rfc822(r.date))}</pubDate>`,
    `    <dc:creator>${xesc(r.byline || PUBLISHER())}</dc:creator>`,
    `    <category>${xesc((PILLAR_BY_SLUG[r.category] || {}).name || r.category)}</category>`,
    `    <description>${xesc(r.dek || firstPara(r.body))}</description>`,
    r.image ? `    <enclosure url="${xesc(r.image)}" type="image/jpeg" />` : '',
    '  </item>'].filter(Boolean).join('\n')).join('\n');
  return ['<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:atom="http://www.w3.org/2005/Atom">',
    '<channel>',
    `  <title>${xesc(SITE_NAME())}${scope ? ' — ' + xesc(scope) : ''}</title>`,
    `  <link>${xesc(BASE_URL())}</link>`,
    `  <description>${xesc(scope ? scope + ' press releases' : 'SoapBox Wire — press releases.')}</description>`,
    '  <language>en-us</language>',
    `  <lastBuildDate>${xesc(rfc822(list[0] ? list[0].date : new Date().toISOString()))}</lastBuildDate>`,
    `  <atom:link href="${xesc(self)}" rel="self" type="application/rss+xml" />`,
    `  <atom:link href="${xesc(env('HERALD_WEBSUB_HUB', 'https://pubsubhubbub.appspot.com/'))}" rel="hub" />`,
    entries, '</channel>', '</rss>'].join('\n');
}
export function renderFeedJson(opts = {}) {
  const list = listReleases({ limit: 100 }, opts);
  return JSON.stringify({ version: 'https://jsonfeed.org/version/1.1', title: SITE_NAME(), home_page_url: BASE_URL(), feed_url: `${BASE_URL()}/feed.json`,
    items: list.map((r) => ({ id: `${BASE_URL()}/release/${encodeURIComponent(r.slug)}`, url: releaseUrl(r), title: r.title, summary: r.dek || firstPara(r.body), content_text: plainText(r.body), date_published: r.date, author: { name: r.byline || PUBLISHER() }, tags: [(PILLAR_BY_SLUG[r.category] || {}).name || r.category, r.beat].filter(Boolean) })) }, null, 1);
}
export function newsSitemap(opts = {}) {
  const cutoff = Date.now() - 2 * 864e5;
  const recent = listReleases({ limit: 1000 }, opts).filter((r) => { const t = Date.parse(r.date); return isNaN(t) || t >= cutoff; });
  const entries = recent.map((r) => `  <url><loc>${xesc(`${BASE_URL()}/release/${encodeURIComponent(r.slug)}`)}</loc><news:news><news:publication><news:name>${xesc(SITE_NAME())}</news:name><news:language>en</news:language></news:publication><news:publication_date>${xesc(r.date)}</news:publication_date><news:title>${xesc(r.title)}</news:title></news:news></url>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">\n${entries}\n</urlset>`;
}
// URL list for the host's MASTER sitemap (so herald's sitemap.xml can register the wire).
export function sitemapUrls(opts = {}) {
  return [BASE_URL() + '/', BASE_URL() + '/categories', BASE_URL() + '/distribution', BASE_URL() + '/embed',
    ...PILLARS.map((p) => `${BASE_URL()}/pillar/${p.slug}`),
    ...BEATS.map((b) => `${BASE_URL()}/beat/${b.slug}`),
    ...listReleases({ limit: 100000 }, opts).map((r) => `${BASE_URL()}/release/${encodeURIComponent(r.slug)}`)];
}
function sitemap(opts = {}) {
  const urls = [...sitemapUrls(opts), ...[...new Set(listReleases({ limit: 100000 }, opts).map((r) => r.beat).filter(Boolean))].map((b) => `${BASE_URL()}/beat/${b}`)];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${[...new Set(urls)].map((u) => `  <url><loc>${xesc(u)}</loc></url>`).join('\n')}\n</urlset>`;
}

// ── submit form + moderation ────────────────────────────────────────────────────────────────────────────
export function renderSubmit(msg = '', opts = {}) {
  if (!submitOpen()) {
    return page({ title: `Submit a release — ${SITE_NAME()}`, desc: 'Submit a press release to SoapBox Wire.', canonical: `${BASE_URL()}/submit`,
      body: `<h1 style="font-size:24px">Submit a press release</h1><div class=box>Open submissions are not enabled yet. ${esc(SITE_NAME())} currently carries releases for the MELEK / SoapBox ecosystem. Outside submissions will open soon — all are reviewed by a human before publication (nothing auto-publishes). For now, reach us via the <a href="${esc(BASE_URL())}">wire</a> contact.</div>` });
  }
  const pillarOpts = PILLARS.map((p) => `<option value=${esc(p.slug)}>${esc(p.name)}</option>`).join('');
  const body = `<h1 style="font-size:24px">Submit a press release</h1>
    <p style="color:var(--mut)">Submit a release for review. We SSRF-check every link and a human approves it before it is published and distributed — nothing auto-publishes.</p>
    ${msg}
    <form class=sub method=post action="${esc(BASE_URL())}/submit">
      <input type=text name=title placeholder="Headline (required)" required maxlength=200>
      <input type=text name=dek placeholder="Sub-headline / dek">
      <input type=text name=dateline placeholder="Dateline — City, State (e.g. Austin, Texas)">
      <input type=text name=byline placeholder="Byline / organization">
      <select name=category>${pillarOpts}</select>
      <textarea name=body rows=10 placeholder="Body (required). One paragraph per blank line. Inline [links](https://…) allowed." required></textarea>
      <input type=text name=links placeholder="Links (space or comma separated URLs)">
      <input type=text name=contact placeholder="Media contact (name · email)">
      <input type=text name=org placeholder="Submitting organization">
      <input type=text name=website class=hp tabindex=-1 autocomplete=off aria-hidden=true>
      <button type=submit>Submit for review</button>
    </form>`;
  return page({ title: `Submit a release — ${SITE_NAME()}`, desc: 'Submit a press release to SoapBox Wire — moderated.', canonical: `${BASE_URL()}/submit`, body });
}
export function renderModerate(token, provided, msg = '', opts = {}) {
  const store = opts.store || defaultStore();
  const t = provided;
  const pending = store.pending(); const approved = store.approved();
  const act = (slug, action, label, bg = 'var(--acc)') => `<form method=post action="${esc(BASE_URL())}/moderate" style="display:inline;margin-right:6px">
    <input type=hidden name=token value="${esc(t)}"><input type=hidden name=slug value="${esc(slug)}"><input type=hidden name=action value="${esc(action)}">
    <button type=submit style="padding:5px 12px;font-size:13px;background:${bg}">${esc(label)}</button></form>`;
  const row = (s) => `<div class=rel><div class=t>${esc(s.title)}</div><div class=d>${esc(s.dek || firstPara(s.body))}</div><div class=m>${esc(s.source || '')} · ${esc(s.category)} · ${esc(String(s.date).slice(0, 10))}</div>
    <div style="margin-top:6px">${s.status === 'submitted' ? act(s.slug, 'approve', 'Approve') + act(s.slug, 'reject', 'Reject', '#f85149') : esc(s.status)}</div></div>`;
  const body = `<h1 style="font-size:24px">Wire — moderation</h1><p style="color:var(--mut)">Token-gated. Nothing auto-publishes.</p>${msg ? `<div class=ok>${esc(msg)}</div>` : ''}
    <h1 class=sec>Pending (${pending.length})</h1>${pending.length ? pending.map(row).join('') : '<div class=empty>none</div>'}
    <h1 class=sec>Approved (${approved.length})</h1>${approved.length ? approved.map(row).join('') : '<div class=empty>none</div>'}`;
  return page({ title: `Moderation — ${SITE_NAME()}`, desc: '', canonical: `${BASE_URL()}/moderate`, body });
}

// ── /keywords — native keyword + hashtag research (no external API) ──────────────────────────────────────
export function renderKeywords(q = '', opts = {}) {
  const topic = String(q || '').slice(0, 200).trim();
  const r = topic ? suggestForTopic(topic) : null;
  const tagList = (arr) => (arr || []).map((h) => `<a href="${esc(BASE_URL())}/keywords?q=${encodeURIComponent(String(h || '').replace(/^#/, ''))}" rel="tag" style="display:inline-block;margin:3px 5px 3px 0;padding:4px 10px;border:1px solid var(--bd,#333);border-radius:14px;text-decoration:none">${esc(h)}</a>`).join(' ');
  const copyBtn = r ? `<button onclick="navigator.clipboard&&navigator.clipboard.writeText(${esc(JSON.stringify(r.hashtags.join(' ')))})" style="padding:4px 10px;font-size:13px">Copy</button>` : '';
  const results = r ? `
    <h1 class=sec>Keywords for "${esc(topic)}"</h1>
    <p style="color:var(--mut);font-size:13px">Primary: <b>${esc(r.primary)}</b> — put it in the headline, the first line, and one subhead. Don't stuff it (that trips Google News spam filters).</p>
    <div>${tagList(r.keywords)}</div>
    <h1 class=sec>Hashtags ${copyBtn}</h1>
    <div>${tagList(r.hashtags)}</div>
    <h1 class=sec>Long-tail angles (lower competition)</h1>
    <div>${tagList(r.longtail)}</div>` : '<p style="color:var(--mut)">Enter a topic to get keywords, hashtags, and long-tail angles — built natively from the topic itself, no third-party API.</p>';
  const body = `<h1 style="font-size:24px">Keyword &amp; Hashtag Research</h1>
    <p style="color:var(--mut)">Part of Herald. Give it a topic; get the tags that make a release, post, or campaign get found.</p>
    <form method=get action="${esc(BASE_URL())}/keywords" style="margin:14px 0">
      <input name=q value="${esc(topic)}" placeholder="a topic, e.g. fair-launch blockchain" style="padding:9px 12px;width:min(380px,70%);font:inherit">
      <button type=submit style="padding:9px 16px">Research</button>
    </form>${results}`;
  return page({ title: `Keyword & Hashtag Research — ${SITE_NAME()}`, desc: 'Find keywords, hashtags, and long-tail angles for any topic — native to Herald, no external API.', canonical: `${BASE_URL()}/keywords`, body });
}

// ── async handler(req,res,opts) ─────────────────────────────────────────────────────────────────────────
const send = (res, code, type, body) => { res.writeHead(code, { 'content-type': type, 'cache-control': 'public, max-age=120', 'access-control-allow-origin': '*' }); res.end(body); };
async function readBody(req) { let raw = ''; for await (const c of req) { raw += c; if (raw.length > 20000) break; } return new URLSearchParams(raw); }
const modOk = (token, provided) => !!token && provided === token;

export async function handler(req, res, opts = {}) {
  try {
    const u = new URL(req.url, BASE_URL().replace(/\/press$/, '') || 'http://localhost');
    const p = u.pathname.replace(/\/+$/, '') || '/';
    const token = opts.token != null ? String(opts.token) : (env('WIRE_TOKEN', '') || env('STATS_TOKEN', ''));
    let m;
    if (p === '/health') return send(res, 200, 'application/json', JSON.stringify({ ok: true, releases: listReleases({ limit: 100000 }, opts).length, pillars: PILLARS.length, beats: BEATS.length, submit_open: submitOpen() }));
    if (p === '/robots.txt') return send(res, 200, 'text/plain', `User-agent: *\nAllow: /\nSitemap: ${BASE_URL()}/sitemap.xml\n`);
    if (p === '/sitemap.xml') return send(res, 200, 'application/xml', sitemap(opts));
    if (p === '/news-sitemap.xml') return send(res, 200, 'application/xml', newsSitemap(opts));
    if (p === '/rss.xml') return send(res, 200, 'application/rss+xml', renderRss({}, opts));
    if (p === '/feed.json') return send(res, 200, 'application/feed+json', renderFeedJson(opts));
    if (p === '/keywords') return send(res, 200, 'text/html; charset=utf-8', renderKeywords(u.searchParams.get('q') || '', opts));
    if (/^\/[a-f0-9]{32}\.txt$/.test(p)) { const kf = env('INDEXNOW_KEY', '7b6e04a11e3b7552a138e9cc098bf9be'); if (p === `/${kf}.txt`) return send(res, 200, 'text/plain', kf); }
    if (p === '/' || p === '') return send(res, 200, 'text/html; charset=utf-8', renderIndex(opts));
    if (p === '/categories') return send(res, 200, 'text/html; charset=utf-8', renderCategories(opts));
    if (p === '/distribution') return send(res, 200, 'text/html; charset=utf-8', renderDistribution(opts));
    if (p === '/embed') return send(res, 200, 'text/html; charset=utf-8', renderEmbed(opts));
    if (p === '/widget.js') return send(res, 200, 'application/javascript; charset=utf-8', widgetJs());
    if (p === '/embed/latest') return send(res, 200, 'text/html; charset=utf-8', renderWidget('latest', null, opts));
    if ((m = p.match(/^\/embed\/(pillar|beat|release)\/([a-z0-9-]+)$/))) { const h = renderWidget(m[1], m[2], opts); return h ? send(res, 200, 'text/html; charset=utf-8', h) : send(res, 404, 'text/html; charset=utf-8', '<p>not found</p>'); }

    // distribution (token-gated): enqueue a release to syndicate. dryRun unless &send=1.
    if (p === '/api/distribute') {
      if (!modOk(token, u.searchParams.get('token') || '')) return send(res, 404, 'text/plain', '404');
      const slug = u.searchParams.get('slug') || '';
      const out = await distributeRelease(slug, { ...opts, dryRun: u.searchParams.get('send') !== '1' });
      return send(res, out.ok ? 200 : 404, 'application/json', JSON.stringify(out));
    }

    if (p === '/submit') {
      if (req.method === 'POST') {
        if (!submitOpen()) return send(res, 403, 'text/html; charset=utf-8', renderSubmit('', opts));
        const f = await readBody(req);
        if (f.get('website')) return send(res, 200, 'text/html; charset=utf-8', renderSubmit('', opts)); // honeypot
        const store = opts.store || defaultStore();
        const links = (f.get('links') || '').split(/[\s,]+/).filter(Boolean);
        const r = store.submit({ title: f.get('title'), dek: f.get('dek'), dateline: f.get('dateline'), byline: f.get('byline'), category: f.get('category'), body: f.get('body'), links, contact: f.get('contact'), org: f.get('org') });
        const msg = r.ok ? `<div class=ok>Thanks — your release is queued for review. A human approves every submission before it is published.</div>` : `<div class=warn>Couldn't accept that (${esc(r.error)}). Check the fields and try again.</div>`;
        return send(res, r.ok ? 200 : 400, 'text/html; charset=utf-8', renderSubmit(msg, opts));
      }
      return send(res, 200, 'text/html; charset=utf-8', renderSubmit('', opts));
    }

    if (p === '/moderate') {
      if (req.method === 'POST') {
        const f = await readBody(req); const provided = f.get('token') || '';
        if (!modOk(token, provided)) return send(res, 404, 'text/plain', '404');
        const store = opts.store || defaultStore();
        const out = store.moderate((f.get('slug') || '').trim(), (f.get('action') || '').trim());
        return send(res, 200, 'text/html; charset=utf-8', renderModerate(token, provided, out.ok ? `${out.record.status} ${out.record.title}` : `failed: ${out.error}`, opts));
      }
      const provided = u.searchParams.get('token') || '';
      if (!modOk(token, provided)) return send(res, 404, 'text/plain', '404');
      return send(res, 200, 'text/html; charset=utf-8', renderModerate(token, provided, u.searchParams.get('msg') || '', opts));
    }

    if ((m = p.match(/^\/pillar\/([a-z0-9-]+)\/rss\.xml$/))) return isPillar(m[1]) ? send(res, 200, 'application/rss+xml', renderRss({ pillar: m[1] }, opts)) : send(res, 404, 'text/plain', 'no feed');
    if ((m = p.match(/^\/pillar\/([a-z0-9-]+)$/))) { const h = renderPillar(m[1], opts); return h ? send(res, 200, 'text/html; charset=utf-8', h) : send(res, 404, 'text/html', page({ title: 'Not found', body: '<p>No such pillar.</p>' })); }
    if ((m = p.match(/^\/beat\/([a-z0-9-]+)\/rss\.xml$/))) return isBeat(m[1]) ? send(res, 200, 'application/rss+xml', renderRss({ beat: m[1] }, opts)) : send(res, 404, 'text/plain', 'no feed');
    if ((m = p.match(/^\/beat\/([a-z0-9-]+)$/))) { const h = renderBeat(m[1], opts); return h ? send(res, 200, 'text/html; charset=utf-8', h) : send(res, 404, 'text/html', page({ title: 'Not found', body: '<p>No such beat.</p>' })); }
    if ((m = p.match(/^\/release\/([a-z0-9-]+)$/))) { const h = renderRelease(m[1], opts); return h ? send(res, 200, 'text/html; charset=utf-8', h) : send(res, 404, 'text/html', page({ title: 'Not found', body: '<p>No such release.</p>' })); }

    return send(res, 404, 'text/html; charset=utf-8', page({ title: 'Not found', body: '<p>Not found.</p>' }));
  } catch (e) { try { res.writeHead(500, { 'content-type': 'text/plain' }); res.end('error'); } catch {} }
}

if (typeof process !== 'undefined' && process.argv && import.meta.url === `file://${process.argv[1]}`) {
  const { createServer } = await import('node:http');
  const PORT = Number(env('PORT', '8167'));
  createServer((req, res) => handler(req, res)).listen(PORT, () => console.log(`SoapBox Wire on :${PORT} — ${BASE_URL()} (${listReleases({ limit: 100000 }).length} releases, ${PILLARS.length} pillars, submit ${submitOpen() ? 'OPEN' : 'closed'})`));
}
