// hierophant-ingest.mjs — pull the Hierophant's PUBLIC-DOMAIN primary texts into the brain, so Hathor
// HOLDS the Iliad / Gilgamesh / Rigveda / Book of the Dead and teaches from them — not just links out.
// Mirrors integrations/language-ingest.mjs: we ingest ONLY openly-licensed sources (Project Gutenberg
// public-domain full texts), declare the license, and SKIP anything that isn't clearly reusable
// (sacred-texts.com stays link-only — Cloudflare-walled + unclear terms).
//
// Output: knowledge/hierophant/<id>.json = { id, title, tradition, source, license, fetchedAt, chars, text }
// That dir registers automatically as a KNOWLEDGE corpus (knowledge/brain-corpus.mjs → knowledgeCorpora),
// so retrieval / embeddings pick the texts up with no extra wiring.
//
// Injectable fetch (offline-testable) + DRY-RUN by default (--apply to write) + soft-fail per source,
// never throws. The real network run executes on the box (connectivity + disk).
//
//   node integrations/hierophant-ingest.mjs                 # dry-run: what WOULD be ingested
//   node integrations/hierophant-ingest.mjs --apply         # fetch + write the JSON datasets
//   node integrations/hierophant-ingest.mjs --apply --only=gilgamesh,iliad

import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TEXTS } from './hierophant-catalog.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'knowledge', 'hierophant');

/** Gutenberg ebook URL -> its plain-text URL (cache/epub/<id>/pg<id>.txt). Null if not a gutenberg url. */
export function gutenbergTextUrl(ebookUrl) {
  const m = String(ebookUrl || '').match(/gutenberg\.org\/(?:ebooks|files|cache\/epub)\/(\d+)/);
  return m ? `https://www.gutenberg.org/cache/epub/${m[1]}/pg${m[1]}.txt` : null;
}

/** Strip Project Gutenberg header/footer boilerplate; normalize whitespace. */
export function stripGutenberg(text) {
  let t = String(text || '').replace(/\r\n/g, '\n');
  const start = t.match(/\*\*\*\s*START OF (?:THE|THIS) PROJECT GUTENBERG EBOOK[^\n]*\*\*\*/i);
  if (start) t = t.slice(start.index + start[0].length);
  const end = t.match(/\*\*\*\s*END OF (?:THE|THIS) PROJECT GUTENBERG EBOOK/i);
  if (end) t = t.slice(0, end.index);
  return t.replace(/\n{3,}/g, '\n\n').trim();
}

/** The catalog texts that have an openly-licensed (Gutenberg) source we can ingest. */
export function ingestable() {
  return TEXTS.filter((t) => t.links && t.links.gutenberg)
    .map((t) => ({ id: t.id, title: t.title, tradition: t.tradition, url: gutenbergTextUrl(t.links.gutenberg) }))
    .filter((t) => t.url);
}

/** Fetch + clean one text. Returns the record (or {id, error}). Injectable fetch; never throws. */
export async function ingestOne(entry, { fetch = globalThis.fetch, maxBytes = 3_000_000 } = {}) {
  try {
    const res = await fetch(entry.url);
    if (!res || !res.ok) return { id: entry.id, error: `http ${res && res.status}` };
    let raw = await res.text();
    if (raw.length > maxBytes) raw = raw.slice(0, maxBytes);
    const text = stripGutenberg(raw);
    if (!text || text.length < 200) return { id: entry.id, error: 'empty after strip' };
    return { id: entry.id, title: entry.title, tradition: entry.tradition, source: entry.url,
      license: 'public-domain (Project Gutenberg)', fetchedAt: new Date().toISOString(), chars: text.length, text };
  } catch (e) { return { id: entry.id, error: String(e.message || e).slice(0, 80) }; }
}

/** Ingest all (or `only`) texts. Dry-run unless apply:true. Returns a report. */
export async function ingest({ fetch = globalThis.fetch, apply = false, only = null, outDir = OUT_DIR, limit = 0, throttleMs = 1500 } = {}) {
  let list = ingestable();
  if (only && only.length) list = list.filter((t) => only.includes(t.id));
  if (limit > 0) list = list.slice(0, limit);
  if (apply) await mkdir(outDir, { recursive: true });
  const done = [], failed = []; const manifest = [];
  for (const entry of list) {
    const rec = await ingestOne(entry, { fetch });
    if (rec.error) { failed.push(rec); }
    else {
      if (apply) await writeFile(path.join(outDir, `${rec.id}.json`), JSON.stringify(rec));
      done.push({ id: rec.id, title: rec.title, tradition: rec.tradition, chars: rec.chars });
      manifest.push({ id: rec.id, title: rec.title, tradition: rec.tradition, source: rec.source, chars: rec.chars });
    }
    if (apply && throttleMs) await new Promise((r) => setTimeout(r, throttleMs)); // be kind to Gutenberg
  }
  if (apply) await writeFile(path.join(outDir, 'manifest.json'), JSON.stringify({ generated: new Date().toISOString(), count: manifest.length, texts: manifest }, null, 2));
  return { candidates: list.length, ingested: done.length, failed: failed.length, done, failures: failed, applied: apply };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const apply = process.argv.includes('--apply');
  const onlyArg = process.argv.find((a) => a.startsWith('--only='));
  const only = onlyArg ? onlyArg.slice('--only='.length).split(',') : null;
  ingest({ apply, only }).then((r) => console.log(JSON.stringify({ ...r, done: r.done.map((d) => `${d.id} (${d.chars}c)`) }, null, 2)));
}
