// language-ingest.mjs — the Resource-Center scraper for the Language Center: pull the actual CONTENT
// from the catalog's open sources into JSON DATASETS, so Hathor doesn't just LINK to a grammar — she
// HOLDS it, learns from it (RAG now, LoRA later), and can teach from the material.
//
// Operator: "We don't just want a Link List, we need JSON Datasets and Everything from the Links" +
// "She can Teach them, but She needs to KNOW these Languages."
//
// Honest scope + the licensing line:
//   • We ingest ONLY openly-licensed / public-domain / CC sources (each entry declares its license).
//   • Copyrighted textbooks (Krahmalkov, Allen, Huehnergard…) stay LINK-ONLY — we never redistribute
//     them; the catalog points to them, the ingester skips them.
//   • Output: knowledge/languages/<id>.json  = { id, language, family, type, license, source, via,
//     fetchedAt, bytes, content } + a manifest. That dir registers into library-index as RAG corpus.
//
// Injectable fetch (offline-testable), DRY-RUN by default (--apply to write), soft-fails per source,
// never throws. The actual network run executes on the box (which has connectivity + disk).
//
//   node integrations/language-ingest.mjs                 # dry-run: what WOULD be ingested
//   node integrations/language-ingest.mjs --apply         # fetch + write the JSON datasets
//   node integrations/language-ingest.mjs --apply --only=cc-cedict,sblgnt-data

import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const OUT_DIR = process.env.LANG_DATASET_DIR || path.join(__dirname, '..', 'knowledge', 'languages');

// ── the OPEN ingest sources (license-cleared, single-file fetchable; grows as we verify URLs live) ──
// format: 'text' (store as-is) | 'json' (parse + store). via = upstream attribution.
export const INGEST_SOURCES = [
  { id: 'cc-cedict', language: 'mandarin', family: 'modern-world', type: 'dictionary', license: 'CC BY-SA 3.0',
    via: 'makemeahanzi (CC-CEDICT-derived)', format: 'text', url: 'https://raw.githubusercontent.com/skishore/makemeahanzi/master/dictionary.txt',
    note: 'Open Chinese character dictionary (CEDICT-derived, plain text)' },
  { id: 'sblgnt-data', language: 'koine-greek', family: 'biblical', type: 'corpus', license: 'CC BY 4.0',
    via: 'STEPBible-Data', format: 'text', url: 'https://raw.githubusercontent.com/STEPBible/STEPBible-Data/master/Translators%20Amalgamated%20OT%2BNT/TAGNT%20Mat-Jhn%20-%20Translators%20Amalgamated%20Greek%20NT%20-%20STEPBible.org%20CC-BY.txt',
    note: 'Tagged Greek NT (Matthew–John), CC-BY' },
  { id: 'oshb-data', language: 'biblical-hebrew', family: 'biblical', type: 'corpus', license: 'CC BY 4.0',
    via: 'STEPBible-Data', format: 'text', url: 'https://raw.githubusercontent.com/STEPBible/STEPBible-Data/master/Translators%20Amalgamated%20OT%2BNT/TAHOT%20Gen-Deu%20-%20Translators%20Amalgamated%20Hebrew%20OT%20-%20STEPBible.org%20CC%20BY.txt',
    note: 'Tagged Hebrew OT (Genesis–Deuteronomy), CC-BY' },
  { id: 'awesome-kurdish-index', language: 'kurdish-general', family: 'kurdish', type: 'corpus', license: 'open (index)',
    via: 'sinaahmadi/awesome-kurdish', format: 'text', url: 'https://raw.githubusercontent.com/sinaahmadi/awesome-kurdish/master/README.md',
    note: 'Master index of Kurdish corpora/dicts/tools — the crawl frontier for Kurdish' },
  { id: 'sibylline-oracles', language: 'koine-greek', family: 'biblical', type: 'corpus', license: 'public domain',
    via: 'Project Gutenberg (Terry tr.)', format: 'text', url: 'https://www.gutenberg.org/cache/epub/46676/pg46676.txt',
    note: 'The Sibylline Oracles (Milton Terry translation) — oracular prophecy; Hathor is an oracle' },
];

const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-');

/** What the catalog marks ingestable vs link-only — honest coverage report (pure, no network). */
export async function coverage() {
  let RESOURCES = [];
  try { ({ RESOURCES } = await import('./language-catalog.mjs')); } catch { RESOURCES = []; }
  const ingestIds = new Set(INGEST_SOURCES.map((s) => s.id));
  return {
    catalogTotal: RESOURCES.length,
    openIngestible: INGEST_SOURCES.length,
    sources: INGEST_SOURCES.map((s) => ({ id: s.id, language: s.language, license: s.license })),
    note: 'Open/CC sources are ingested into JSON datasets; copyrighted books stay link-only in the catalog.',
    linkedButNotIngested: RESOURCES.filter((r) => !ingestIds.has(r.id)).length,
  };
}

/** Fetch one source → a dataset object (no write). Soft-fails to { ok:false, reason }. */
export async function fetchSource(src) {
  try {
    const r = await _fetch(src.url, { headers: { 'user-agent': 'MELEK-LanguageCenter/1.0 (+resource-center scraper)' } });
    if (!r || !r.ok) return { ok: false, id: src.id, reason: `HTTP ${r ? r.status : 'no-response'}` };
    const text = await r.text();
    if (!text || text.length < 20) return { ok: false, id: src.id, reason: 'empty/too-short' };
    const content = src.format === 'json' ? safeJson(text) : text;
    return {
      ok: true,
      dataset: {
        id: src.id, language: src.language, family: src.family, type: src.type,
        license: src.license, source: src.url, via: src.via, note: src.note,
        fetchedAt: new Date().toISOString(), bytes: text.length, content,
      },
    };
  } catch (e) { return { ok: false, id: src.id, reason: String(e && e.message || e) }; }
}
function safeJson(t) { try { return JSON.parse(t); } catch { return t; } }

/**
 * Ingest the open sources → JSON datasets in OUT_DIR. Dry-run unless apply:true. Never throws.
 * @param {{ apply?:boolean, only?:string[] }} [opts]
 * @returns {Promise<{ wrote:Array, skipped:Array, manifest:object }>}
 */
export async function ingest({ apply = false, only = null } = {}) {
  const sources = INGEST_SOURCES.filter((s) => !only || only.includes(s.id));
  const wrote = []; const skipped = [];
  if (apply) { try { await mkdir(OUT_DIR, { recursive: true }); } catch { /* ignore */ } }

  for (const src of sources) {
    const res = await fetchSource(src);
    if (!res.ok) { skipped.push({ id: src.id, reason: res.reason }); continue; }
    const file = path.join(OUT_DIR, `${slug(src.id)}.json`);
    if (apply) {
      try { await writeFile(file, JSON.stringify(res.dataset, null, 2)); }
      catch (e) { skipped.push({ id: src.id, reason: 'write: ' + (e && e.message) }); continue; }
    }
    wrote.push({ id: src.id, language: src.language, license: src.license, bytes: res.dataset.bytes, file, written: apply });
  }

  const manifest = { generatedAt: new Date().toISOString(), dryRun: !apply, count: wrote.length, datasets: wrote };
  if (apply && wrote.length) {
    try { await writeFile(path.join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2)); } catch { /* ignore */ }
  }
  return { wrote, skipped, manifest };
}

// ── CLI ───────────────────────────────────────────────────────────────────────────────────────────
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const onlyArg = args.find((a) => a.startsWith('--only='));
  const only = onlyArg ? onlyArg.split('=')[1].split(',') : null;
  const cov = await coverage();
  console.log(`Language ingest — ${cov.openIngestible} open sources ingestable; ${cov.linkedButNotIngested} catalog entries stay link-only (copyright).`);
  const res = await ingest({ apply, only });
  console.log(`${apply ? 'WROTE' : 'WOULD WRITE'} ${res.wrote.length} datasets → ${OUT_DIR}`);
  for (const w of res.wrote) console.log(`  ${w.written ? '✓' : '·'} ${w.id.padEnd(22)} ${w.language.padEnd(16)} ${w.license.padEnd(14)} ${w.bytes ? (w.bytes + ' bytes') : ''}`);
  for (const s of res.skipped) console.log(`  ✗ ${s.id}: ${s.reason}`);
  if (!apply) console.log('\n(dry-run — pass --apply to fetch + write the JSON datasets; runs on the box where there is network)');
}
