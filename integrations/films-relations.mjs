// films-relations.mjs — how films belong together, from Wikidata:
//   follows / followed by (P155 / P156)       → prequel / sequel chains
//   part of the series (P179, ordinal P1545)  → film series, in order
//   media franchise (P8345)                   → franchises
//   takes place in fictional universe (P1434) → universes
//   production company (P272)                 → the brand at the top (Pixar, Hammer, Universal…)
//   based on (P144) another film              → remakes (the book side lives in films-based-on.mjs)
// Output: data/films/relations.json → { byFilm: { Q: { prev, next, series:[{id,t,n}], franchise:[{id,t}],
//   universe:[{id,t}], studio:[{id,t}], remakeOf:[Q] } }, groups: { Q: { t, kind, films:[Q] } } }.
// Keyless (WDQS), batched, soft-fail per batch, injectable fetch.
//
//   node integrations/films-relations.mjs build --films data/films/films.ndjson --out data/films/relations.json

import fs from 'node:fs';
import readline from 'node:readline';

const WDQS = 'https://query.wikidata.org/sparql';
const UA = 'SoapBoxFilms/1.0 (https://stream.soapbox.community/films; relations)';
let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

const PROPS = { P155: 'prev', P156: 'next', P179: 'series', P8345: 'franchise', P1434: 'universe', P272: 'studio', P144: 'basedOn' };

export function sparqlFor(qids) {
  const u = (p, extra = '') => `{ ?f wdt:${p} ?v . BIND("${p}" AS ?p) ${extra}}`;
  return `SELECT ?f ?p ?v ?vLabel ?n ?isFilm WHERE {
  VALUES ?f { ${qids.map((q) => `wd:${q}`).join(' ')} }
  { ${[u('P155'), u('P156'), u('P8345'), u('P1434'), u('P272'),
    '{ ?f p:P179 ?st . ?st ps:P179 ?v . OPTIONAL { ?st pq:P1545 ?n . } BIND("P179" AS ?p) }',
    '{ ?f wdt:P144 ?v . ?v wdt:P31/wdt:P279? wd:Q11424 . BIND("P144" AS ?p) BIND(true AS ?isFilm) }'].join(' UNION ')} }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}`;
}

export const NOT_A_SERIES = /^list of |greatest|\bbest\b|\btop \d+|\d+ (films|movies)|filmography|in film$/i;
const qid = (u) => String(u || '').replace(/^.*\//, '');

/** Fold rows. Pure. */
export function foldRows(rows, out = { byFilm: {}, groups: {} }) {
  for (const row of rows || []) {
    const f = qid(row.f && row.f.value);
    const v = qid(row.v && row.v.value);
    const p = row.p && row.p.value;
    const role = PROPS[p];
    if (!/^Q\d+$/.test(f) || !/^Q\d+$/.test(v) || !role) continue;
    const t = row.vLabel && row.vLabel.value;
    const e = (out.byFilm[f] ||= {});
    if (role === 'prev' || role === 'next') { e[role] = e[role] || v; continue; }
    if (role === 'basedOn') { if (row.isFilm && row.isFilm.value === 'true') { (e.remakeOf ||= []); if (!e.remakeOf.includes(v)) e.remakeOf.push(v); } continue; }
    if (!t || /^Q\d+$/.test(t)) continue;
    if (role === 'series' && NOT_A_SERIES.test(t)) continue; // "list of Pixar films", "BBC's 100 Greatest…"
    const list = (e[role] ||= []);
    let item = list.find((x) => x.id === v);
    if (!item) { item = { id: v, t }; list.push(item); }
    const n = row.n && parseFloat(row.n.value);
    if (role === 'series' && Number.isFinite(n)) item.n = n;
    const g = (out.groups[v] ||= { t, kind: role, films: [] });
    if (!g.films.includes(f)) g.films.push(f);
  }
  return out;
}

export async function queryBatch(qids) {
  try {
    const r = await _fetch(WDQS, { method: 'POST', headers: { 'user-agent': UA, accept: 'application/sparql-results+json', 'content-type': 'application/x-www-form-urlencoded' }, body: `query=${encodeURIComponent(sparqlFor(qids))}` });
    if (!r || !r.ok) return null;
    const j = await r.json();
    return (j && j.results && j.results.bindings) || [];
  } catch { return null; }
}

async function readQids(file) {
  const out = [];
  const rl = readline.createInterface({ input: fs.createReadStream(file) });
  for await (const line of rl) { try { const r = JSON.parse(line); if (r && /^Q\d+$/.test(r.id)) out.push(r.id); } catch {} }
  return out;
}

if (process.argv[1] && process.argv[1].endsWith('films-relations.mjs') && process.argv[2] === 'build') {
  const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
  const qids = await readQids(arg('--films', 'data/films/films.ndjson'));
  const outFile = arg('--out', 'data/films/relations.json');
  const size = +arg('--batch', '150');
  const out = { byFilm: {}, groups: {} };
  let failed = 0;
  for (let i = 0; i < qids.length; i += size) {
    let rows = await queryBatch(qids.slice(i, i + size));
    if (rows === null) { await new Promise((r) => setTimeout(r, 8000)); rows = await queryBatch(qids.slice(i, i + size)); }
    if (rows === null) { failed += 1; continue; }
    foldRows(rows, out);
    if ((i / size) % 40 === 0) console.log(`${i + size}/${qids.length} · ${Object.keys(out.groups).length} groups`);
    await new Promise((r) => setTimeout(r, 400));
  }
  // groups with one film are noise for browsing, except studios (a brand with one film is still a brand)
  for (const [k, g] of Object.entries(out.groups)) if (g.films.length < 2 && g.kind !== 'studio') delete out.groups[k];
  fs.writeFileSync(outFile, JSON.stringify({ built: new Date().toISOString(), films: qids.length, failedBatches: failed, ...out }));
  const count = (k) => Object.values(out.groups).filter((g) => g.kind === k).length;
  console.log(`done: ${count('studio')} studios, ${count('franchise')} franchises, ${count('universe')} universes, ${count('series')} series; ${Object.values(out.byFilm).filter((e) => e.remakeOf).length} remakes; ${failed} failed batches → ${outFile}`);
}
