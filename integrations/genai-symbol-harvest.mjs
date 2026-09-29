// genai-symbol-harvest.mjs — the "occult & religious symbols" source set for the GenAI library. Sibling of
// genai-library-pull.mjs (same rules: keyless, licence-checked, provenance on every file, incremental).
//
// For each row of symbol-library-spec.mjs it:
//   1. fetches the Wikipedia article(s) named in the spec (the SOURCE: canonical URL + intro extract),
//   2. picks ONE openly licensed image from Wikimedia Commons, in order:
//        pinned `file` → the article's lead image if it is an SVG → a Commons SVG search (`q`)
//        → the article's lead raster image (only for rows marked `raster: true` — lead photos make bad silhouettes),
//      keeping ONLY Public Domain / CC0 / CC BY / CC BY-SA (anything else — GFDL-only, NC, ND, fair use,
//      non-free — is rejected), and never reusing a file already given to another symbol,
//   3. downloads it to <dir>/<id>.<ext> and records title / licence / author / source URL in manifest.json.
// Rows with `font: true` skip step 2 (they are rendered from Noto fonts by symbol_library.py).
//
// Soft-fail everywhere: a failed lookup leaves that symbol image-less, never throws. Injectable fetch →
// offline-testable (genai-symbol-harvest.test.mjs).
//
//   node integrations/genai-symbol-harvest.mjs --dir knowledge/symbols/src [--only ankh,djed] [--refresh]

import fs from 'node:fs';
import path from 'node:path';
import { SYMBOLS } from './symbol-library-spec.mjs';

const UA = 'MELEK-Hathor-SymbolLibrary/1.0 (https://github.com/HinduTempleCoins/Bot; open-licence harvester)';
let _fetch = (u, o = {}) => fetch(u, { ...o, headers: { 'User-Agent': UA, ...(o.headers || {}) } });
export function __setFetch(f) { _fetch = f || ((u, o = {}) => fetch(u, { ...o, headers: { 'User-Agent': UA, ...(o.headers || {}) } })); }

const COMMONS = 'https://commons.wikimedia.org/w/api.php';
const WIKI = 'https://en.wikipedia.org/w/api.php';
const MAX_BYTES = 3 * 1024 * 1024;

const stripHtml = (s) => String(s || '').replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/\s+/g, ' ').trim();

/** Licence gate. 'A' = PD/CC0 (mint-safe), 'B' = CC BY / CC BY-SA (attribution required), null = rejected. */
export function licenceBucket(short, usage = '') {
  const s = `${short || ''} ${usage || ''}`.toLowerCase();
  if (!s.trim()) return null;
  if (/\bnc\b|non-?commercial|\bnd\b|no-?deriv|fair use|non-?free|all rights reserved/.test(s)) return null;
  if (/cc0|public domain|\bpd\b|pd-|no restrictions/.test(s)) return 'A';
  if (/cc[ -]by(-sa)?[ -]?\d|cc[ -]by(-sa)?$|attribution/.test(s)) return 'B';
  return null; // GFDL-only, FAL, unknown → not in our allowed set
}

let _sleep = (ms) => new Promise((s) => setTimeout(s, ms));
export function __setSleep(f) { _sleep = f || ((ms) => new Promise((s) => setTimeout(s, ms))); }

// Wikimedia rate-limits bursts (HTTP 429) — back off politely (Retry-After, capped) and retry twice.
async function getJson(url) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await _fetch(url);
      if (r && r.status === 429) {
        const ra = parseInt((r.headers && r.headers.get && r.headers.get('retry-after')) || '', 10);
        await _sleep(Math.min(60, Number.isFinite(ra) ? ra : 10 * (attempt + 1)) * 1000); continue;
      }
      if (!r || !r.ok) return null;
      return await r.json();
    } catch { return null; }
  }
  return null;
}

/** Commons imageinfo for up to 50 File: titles → Map(title → info). */
export async function commonsInfo(titles) {
  const out = new Map();
  const list = [...new Set(titles.filter(Boolean))];
  for (let i = 0; i < list.length; i += 40) {
    const chunk = list.slice(i, i + 40);
    const j = await getJson(`${COMMONS}?action=query&format=json&redirects=1&prop=imageinfo&iiprop=url|size|mime|extmetadata&iiextmetadatafilter=LicenseShortName|UsageTerms|Artist|Credit|Copyrighted&titles=${encodeURIComponent(chunk.join('|'))}`);
    const pages = j && j.query && j.query.pages ? Object.values(j.query.pages) : [];
    const alias = new Map();
    for (const n of (j && j.query && [...(j.query.normalized || []), ...(j.query.redirects || [])]) || []) alias.set(n.to, n.from);
    for (const p of pages) {
      const ii = p.imageinfo && p.imageinfo[0];
      if (!ii) continue;
      const m = ii.extmetadata || {};
      const lic = m.LicenseShortName && m.LicenseShortName.value;
      const usage = m.UsageTerms && m.UsageTerms.value;
      const info = {
        title: p.title, url: String(ii.url || '').split('?')[0], mime: ii.mime, bytes: ii.size, width: ii.width, height: ii.height,
        licence: stripHtml(lic || usage || ''), bucket: licenceBucket(lic, usage),
        author: stripHtml((m.Artist && m.Artist.value) || (m.Credit && m.Credit.value) || '').slice(0, 300) || 'unknown',
        source: ii.descriptionurl || `https://commons.wikimedia.org/wiki/${encodeURIComponent(p.title.replace(/ /g, '_'))}`,
      };
      out.set(p.title, info);
      let a = p.title; while (alias.has(a)) { a = alias.get(a); out.set(a, info); }
    }
  }
  return out;
}

/** Wikipedia articles → [{title, url, extract, lead}] (lead = File: title of the page image, if any). */
export async function wikiArticles(titles) {
  const out = [];
  const list = [...new Set(titles.filter(Boolean))];
  for (let i = 0; i < list.length; i += 20) {
    const chunk = list.slice(i, i + 20);
    const j = await getJson(`${WIKI}?action=query&format=json&redirects=1&prop=pageimages|extracts|info&inprop=url&piprop=name&exintro=1&explaintext=1&exlimit=20&titles=${encodeURIComponent(chunk.join('|'))}`);
    const pages = j && j.query && j.query.pages ? Object.values(j.query.pages) : [];
    for (const p of pages) {
      if (p.missing !== undefined || !p.pageid) continue;
      out.push({ title: p.title, url: p.fullurl || `https://en.wikipedia.org/wiki/${encodeURIComponent(p.title.replace(/ /g, '_'))}`,
        extract: String(p.extract || '').slice(0, 1200), lead: p.pageimage ? `File:${p.pageimage.replace(/_/g, ' ')}` : null });
    }
  }
  return out;
}

const BAD_TITLE = /flag of|coat of arms|\bmap\b|locator|logo|\bcoa\b|blason|stamp|banknote|\bseal of the\b|wappen|escudo/i;

/** Commons SVG search, ranked by how many query words the file title contains. → [File: titles] */
export async function commonsSearchSvg(q, limit = 12) {
  const j = await getJson(`${COMMONS}?action=query&format=json&list=search&srnamespace=6&srlimit=${limit}&srsearch=${encodeURIComponent(`${q} filemime:image/svg+xml`)}`);
  const hits = (j && j.query && j.query.search) || [];
  const words = String(q).toLowerCase().split(/[^a-z0-9ÀÖØöø-ÿ]+/).filter((w) => w.length > 2 && !['svg', 'symbol', 'the'].includes(w));
  return hits.map((h, i) => {
    const t = h.title.toLowerCase();
    const score = words.filter((w) => t.includes(w)).length * 10 - i - (BAD_TITLE.test(h.title) ? 50 : 0);
    return { title: h.title, score };
  }).filter((h) => h.score > 0).sort((a, b) => b.score - a.score).map((h) => h.title);
}

/** Resolve sources + one licence-checked image for a spec row. Never throws. */
export async function harvestSymbol(spec, { used = new Set() } = {}) {
  const res = { id: spec.id, sources: [], image: null, via: null, rejected: [] };
  try {
    const arts = await wikiArticles(spec.wiki || []);
    res.sources = arts.map((a) => ({ title: a.title, url: a.url, extract: a.extract }));
    if (spec.font) return res;
    const leads = spec.lead === false ? [] : arts.map((a) => a.lead).filter(Boolean); // lead:false = the article's image is not the symbol
    const svgLead = leads.filter((l) => /\.svg$/i.test(l));
    const rasterLead = leads.filter((l) => !/\.svg$/i.test(l));
    const ordered = [];
    if (spec.file) ordered.push(['pinned', spec.file]);
    for (const l of svgLead) ordered.push(['wiki-lead', l]);
    if (spec.q) for (const t of await commonsSearchSvg(spec.q)) ordered.push(['search', t]);
    if (spec.raster) for (const l of rasterLead) ordered.push(['wiki-lead-raster', l]);
    const info = await commonsInfo(ordered.map(([, t]) => t));
    for (const [via, t] of ordered) {
      const i = info.get(t);
      if (!i) { res.rejected.push({ title: t, why: 'not on Commons' }); continue; }
      if (used.has(i.title)) continue;
      if (!i.bucket) { res.rejected.push({ title: t, why: `licence: ${i.licence || 'unknown'}` }); continue; }
      if (i.bytes > MAX_BYTES) { res.rejected.push({ title: t, why: 'too large' }); continue; }
      if (!/image\/(svg\+xml|png|jpeg)/.test(i.mime || '')) continue;
      res.image = i; res.via = via; used.add(i.title);
      break;
    }
  } catch { /* soft-fail */ }
  return res;
}

const extOf = (mime) => (/svg/.test(mime) ? 'svg' : /png/.test(mime) ? 'png' : 'jpg');

/** Harvest the whole spec (or `only`) into `dir`: images + manifest.json. Incremental unless refresh. */
export async function harvestSymbols({ dir = 'knowledge/symbols/src', only = null, refresh = false, specs = SYMBOLS, delayMs = 150 } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const mfPath = path.join(dir, 'manifest.json');
  let mf = {};
  try { mf = JSON.parse(fs.readFileSync(mfPath, 'utf8')); } catch { mf = {}; }
  const used = new Set(Object.entries(mf).filter(([id]) => !only || !only.includes(id)).map(([, v]) => v.image && v.image.title).filter(Boolean));
  const stats = { symbols: 0, images: 0, downloaded: 0, fontOnly: 0, none: 0, byVia: {} };
  for (const spec of specs) {
    if (only && !only.includes(spec.id)) continue;
    stats.symbols++;
    if (!refresh && mf[spec.id] && (mf[spec.id].image || spec.font) && mf[spec.id].sources && mf[spec.id].sources.length) {
      if (mf[spec.id].image) stats.images++; else stats.fontOnly++;
      continue;
    }
    const r = await harvestSymbol(spec, { used });
    // a refreshed row must not leave a stale image behind (e.g. an earlier wrong pick)
    try { for (const f of fs.readdirSync(dir)) if (f.startsWith(`${spec.id}.`) && f !== 'manifest.json') fs.unlinkSync(path.join(dir, f)); } catch { /* ignore */ }
    const entry = { sources: r.sources, image: null, via: r.via, rejected: r.rejected.slice(0, 6), at: new Date().toISOString() };
    if (r.image) {
      const file = `${spec.id}.${extOf(r.image.mime)}`;
      try {
        const ir = await _fetch(r.image.url);
        if (ir && ir.ok) {
          const b = Buffer.from(await ir.arrayBuffer());
          if (b.length > 64 && b.length <= MAX_BYTES) {
            fs.writeFileSync(path.join(dir, file), b);
            entry.image = { file, title: r.image.title, licence: r.image.licence, bucket: r.image.bucket, author: r.image.author, source: r.image.source, url: r.image.url, mime: r.image.mime };
            stats.downloaded++;
          }
        }
      } catch { /* soft-fail */ }
    }
    if (entry.image) { stats.images++; stats.byVia[r.via] = (stats.byVia[r.via] || 0) + 1; } else if (spec.font) stats.fontOnly++; else stats.none++;
    mf[spec.id] = entry;
    fs.writeFileSync(mfPath, JSON.stringify(mf, null, 1));
    if (delayMs) await new Promise((s) => setTimeout(s, delayMs));
  }
  return stats;
}

if (process.argv[1] && process.argv[1].endsWith('genai-symbol-harvest.mjs')) {
  const a = process.argv; const gi = (k, d) => { const i = a.indexOf(k); return i > -1 ? a[i + 1] : d; };
  const only = gi('--only', null);
  const r = await harvestSymbols({ dir: gi('--dir', 'knowledge/symbols/src'), only: only ? only.split(',') : null, refresh: a.includes('--refresh'), delayMs: parseInt(gi('--delay', '150'), 10) });
  console.log(JSON.stringify(r, null, 2));
}
