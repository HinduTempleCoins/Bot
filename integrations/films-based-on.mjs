// films-based-on.mjs — which films are based on which books (Wikidata P144 "based on"), and whether each book
// is readable free: its Project Gutenberg ebook id (P2034, on the work or on one of its editions via P747) and its
// publication year. Output: data/films/based-on.json, read by SoapBox Films (film pages: "Based on the book") and
// by the Library (Gutenberg books: "Films of this book").
//
//   node integrations/films-based-on.mjs build --films data/films/films.ndjson --out data/films/based-on.json
//
// Keyless (Wikidata Query Service), batched, soft-fail per batch, injectable fetch.

import fs from 'node:fs';
import readline from 'node:readline';

const WDQS = 'https://query.wikidata.org/sparql';
const UA = 'SoapBoxFilms/1.0 (https://stream.soapbox.community/films; books link)';
let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

export function sparqlFor(qids) {
  return `SELECT ?f ?b ?bLabel ?aLabel ?pub ?gut ?kindLabel WHERE {
  VALUES ?f { ${qids.map((q) => `wd:${q}`).join(' ')} }
  ?f wdt:P144 ?b .
  OPTIONAL { ?b wdt:P50 ?a . }
  OPTIONAL { ?b wdt:P577 ?pub . }
  OPTIONAL { ?b wdt:P31 ?kind . }
  OPTIONAL { { ?b wdt:P2034 ?gut . } UNION { ?b wdt:P747 ?ed . ?ed wdt:P2034 ?gut . } }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}`;
}

const qid = (u) => String(u || '').replace(/^.*\//, '');

/** Fold SPARQL rows into { film: [ { id, t, a, y, kind, gut } ] }. Pure. */
export function foldRows(rows, into = {}) {
  for (const row of rows || []) {
    const f = qid(row.f && row.f.value);
    const b = qid(row.b && row.b.value);
    if (!/^Q\d+$/.test(f) || !/^Q\d+$/.test(b)) continue;
    const t = row.bLabel && row.bLabel.value;
    if (!t || /^Q\d+$/.test(t)) continue; // unlabelled item
    const list = (into[f] ||= []);
    let e = list.find((x) => x.id === b);
    if (!e) { e = { id: b, t, a: [], y: 0, kind: [], gut: [] }; list.push(e); }
    const a = row.aLabel && row.aLabel.value;
    if (a && !/^Q\d+$/.test(a) && !e.a.includes(a)) e.a.push(a);
    const y = row.pub ? +String(row.pub.value).slice(0, 5).replace(/^\+/, '').slice(0, 4) : 0;
    if (y > 0 && (!e.y || y < e.y)) e.y = y;
    const k = row.kindLabel && row.kindLabel.value;
    if (k && !/^Q\d+$/.test(k) && !e.kind.includes(k) && e.kind.length < 3) e.kind.push(k);
    const g = row.gut && String(row.gut.value).trim();
    if (g && /^\d+$/.test(g) && !e.gut.includes(g)) e.gut.push(g);
  }
  return into;
}

export async function queryBatch(qids) {
  try {
    const r = await _fetch(WDQS, { method: 'POST', headers: { 'user-agent': UA, accept: 'application/sparql-results+json', 'content-type': 'application/x-www-form-urlencoded' }, body: `query=${encodeURIComponent(sparqlFor(qids))}` });
    if (!r || !r.ok) return null;
    const j = await r.json();
    return (j && j.results && j.results.bindings) || [];
  } catch { return null; }
}

/** { byFilm, byGutenberg: { id: [film…] }, byBook: { qid: [film…] } } */
export function indexes(byFilm) {
  const byGutenberg = {}; const byBook = {};
  for (const [f, books] of Object.entries(byFilm)) {
    for (const b of books) {
      (byBook[b.id] ||= []).push(f);
      for (const g of b.gut) (byGutenberg[g] ||= []).push(f);
    }
  }
  return { byGutenberg, byBook };
}

async function readQids(file) {
  const out = [];
  const rl = readline.createInterface({ input: fs.createReadStream(file) });
  for await (const line of rl) { try { const r = JSON.parse(line); if (r && /^Q\d+$/.test(r.id)) out.push(r.id); } catch {} }
  return out;
}

if (process.argv[1] && process.argv[1].endsWith('films-based-on.mjs') && process.argv[2] === 'build') {
  const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
  const films = arg('--films', 'data/films/films.ndjson');
  const out = arg('--out', 'data/films/based-on.json');
  const size = +arg('--batch', '250');
  const qids = await readQids(films);
  const byFilm = {};
  let failed = 0;
  for (let i = 0; i < qids.length; i += size) {
    let rows = await queryBatch(qids.slice(i, i + size));
    if (rows === null) { await new Promise((r) => setTimeout(r, 5000)); rows = await queryBatch(qids.slice(i, i + size)); }
    if (rows === null) { failed += 1; continue; }
    foldRows(rows, byFilm);
    if ((i / size) % 20 === 0) console.log(`${i + size}/${qids.length} films · ${Object.keys(byFilm).length} based on something`);
    await new Promise((r) => setTimeout(r, 400));
  }
  const idx = indexes(byFilm);
  fs.writeFileSync(out, JSON.stringify({ built: new Date().toISOString(), films: qids.length, failedBatches: failed, byFilm, ...idx }));
  const withGut = Object.values(byFilm).filter((bs) => bs.some((b) => b.gut.length)).length;
  console.log(`done: ${Object.keys(byFilm).length} films based on a work; ${withGut} with a Gutenberg text; ${failed} failed batches → ${out}`);
}
