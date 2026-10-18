// integrations/films-credits.mjs — full cast & crew for SoapBox Films, from Wikidata (CC0).
//
// The catalog (films-wikidata.mjs) keeps only a short "Directed by / Starring" line per film. This builds the
// complete credits behind it: every credited cast member plus director, screenwriter, composer, producer,
// director of photography and editor — each with its Wikidata id, so a name links to a person page that
// lists that person's whole filmography.
//
// Two files, both NDJSON, read on demand by the server through a byte-offset index (they are far too big to
// hold in memory alongside everything else the web dispatcher serves):
//   credits.ndjson  {"id":"Q153723","cast":[["Q35332","Brad Pitt"],…],"dir":[…],"wri":[…],"mus":[…],"pro":[…],"dop":[…],"edt":[…]}
//   people.ndjson   {"q":"Q35332","n":"Brad Pitt","sl":151,"f":[["Q153723","cast"],["Q…","pro"],…]}
//
// House style: ESM, injectable fetch (via films-wikidata's __setFetch), soft-fail (a failed batch is skipped).
//   node integrations/films-credits.mjs build --films data/films/films.ndjson --out data/films [--batch 80]
import { readFileSync, writeFileSync, renameSync, openSync, readSync, closeSync, statSync } from 'node:fs';
import path from 'node:path';
import { sparql } from './films-wikidata.mjs';

// Wikidata property → our short role key. Checked against wikidata.org labels.
export const ROLES = {
  P161: 'cast',  // cast member
  P57: 'dir',    // director
  P58: 'wri',    // screenwriter
  P86: 'mus',    // composer
  P162: 'pro',   // producer
  P344: 'dop',   // director of photography
  P1040: 'edt',  // film editor
};
export const ROLE_NAMES = { cast: 'Cast', dir: 'Directed by', wri: 'Written by', mus: 'Music by', pro: 'Produced by', dop: 'Cinematography', edt: 'Edited by' };
export const ROLE_ORDER = ['dir', 'wri', 'cast', 'pro', 'mus', 'dop', 'edt'];

const isQid = (s) => /^Q\d{1,12}$/.test(String(s || ''));

/** One query per batch: one row per (film, role, person) with the person's English label and sitelinks. */
export function creditsQuery(qids) {
  const values = qids.filter(isQid).map((q) => `wd:${q}`).join(' ');
  const parts = Object.keys(ROLES).map((p) => `{ ?f wdt:${p} ?v . BIND("${p}" AS ?p) }`).join(' UNION\n');
  return `SELECT ?f ?p ?v ?vLabel ?sl WHERE {
VALUES ?f { ${values} }
${parts}
OPTIONAL { ?v wikibase:sitelinks ?sl . }
SERVICE wikibase:label { bd:serviceParam wikibase:language "en,mul". }
}`;
}

/** Fold SPARQL rows into {filmId → credits record} and {personId → {n, sl}}. */
export function foldCredits(rows, films = new Map(), people = new Map()) {
  for (const b of rows || []) {
    try {
      const f = b.f.value.split('/').pop(), p = b.p.value, q = b.v.value.split('/').pop();
      const role = ROLES[p]; const n = (b.vLabel && b.vLabel.value) || '';
      if (!isQid(f) || !role || !isQid(q) || !n || n === q) continue;   // unlabelled items are skipped
      const sl = b.sl ? +b.sl.value || 0 : 0;
      if (!films.has(f)) films.set(f, { id: f });
      const rec = films.get(f);
      (rec[role] ||= []);
      if (!rec[role].some((x) => x[0] === q)) rec[role].push([q, n, sl]);
      const pe = people.get(q);
      if (!pe) people.set(q, { q, n, sl, f: [[f, role]] });
      else if (!pe.f.some((x) => x[0] === f && x[1] === role)) pe.f.push([f, role]);
    } catch { /* one bad row never drops the batch */ }
  }
  return { films, people };
}

/** Best-known first within each role (by sitelinks), then strip the sitelink count from the stored pair. */
export function finishFilm(rec) {
  const out = { id: rec.id };
  for (const role of ROLE_ORDER) if (rec[role] && rec[role].length) out[role] = [...rec[role]].sort((a, b) => b[2] - a[2]).map(([q, n]) => [q, n]);
  return out;
}

export async function build({ films, out, batch = 80, log = () => {}, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  const ids = readFileSync(films, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l).id; } catch { return null; } }).filter(isQid);
  const filmMap = new Map(), people = new Map();
  let ok = 0, failed = 0;
  for (let i = 0; i < ids.length; i += batch) {
    const slice = ids.slice(i, i + batch);
    let rows = await sparql(creditsQuery(slice), { timeoutMs: 90000 });
    if (!rows) { await sleep(5000); rows = await sparql(creditsQuery(slice), { timeoutMs: 90000 }); }   // one retry
    if (rows) { foldCredits(rows, filmMap, people); ok++; } else failed++;
    if ((i / batch) % 25 === 0) log(`${Math.min(i + batch, ids.length)}/${ids.length} films · ${people.size} people · ${failed} failed batches`);
    await sleep(800);   // be polite to the public endpoint
  }
  const cTmp = path.join(out, 'credits.ndjson.new'), pTmp = path.join(out, 'people.ndjson.new');
  writeFileSync(cTmp, [...filmMap.values()].map((r) => JSON.stringify(finishFilm(r))).join('\n') + '\n');
  writeFileSync(pTmp, [...people.values()].sort((a, b) => b.sl - a.sl).map((p) => JSON.stringify(p)).join('\n') + '\n');
  renameSync(cTmp, path.join(out, 'credits.ndjson')); renameSync(pTmp, path.join(out, 'people.ndjson'));
  log(`done: ${filmMap.size} films with credits, ${people.size} people, ${ok} batches ok, ${failed} failed`);
  return { films: filmMap.size, people: people.size, ok, failed };
}

// ── reading: a byte-offset index over an NDJSON file, lines fetched with one pread each ────────────────────
/**
 * Index an NDJSON file by a key field without keeping the records in memory: key → [offset, length].
 * Also returns a light name list when `nameField` is given (for people search).
 */
export function indexNdjson(file, keyField, { nameField = null } = {}) {
  const idx = new Map(); const names = [];
  let fd; try { fd = openSync(file, 'r'); } catch { return { idx, names, file: null, mtime: 0 }; }
  try {
    const size = statSync(file).size; const buf = Buffer.alloc(1 << 20);
    let pos = 0, carry = Buffer.alloc(0), lineStart = 0;
    while (pos < size) {
      const n = readSync(fd, buf, 0, buf.length, pos);
      if (n <= 0) break;
      const chunk = Buffer.concat([carry, buf.subarray(0, n)]);
      let s = 0;
      for (let i = 0; i < chunk.length; i++) {
        if (chunk[i] !== 10) continue;
        const line = chunk.subarray(s, i);
        const off = lineStart + s;
        if (line.length) {
          // the key (and name) sit at the front of each record: parse just enough of the line
          const head = line.subarray(0, Math.min(line.length, 400)).toString('utf8');
          const km = head.match(new RegExp(`"${keyField}":"(Q\\d+)"`));
          if (km) {
            idx.set(km[1], [off, line.length]);
            if (nameField) { const nm = head.match(new RegExp(`"${nameField}":"((?:[^"\\\\]|\\\\.)*)"`)); if (nm) names.push([km[1], JSON.parse(`"${nm[1]}"`)]); }
          }
        }
        s = i + 1;
      }
      lineStart += s; carry = chunk.subarray(s); pos += n;
    }
  } finally { closeSync(fd); }
  return { idx, names, file, mtime: statSync(file).mtimeMs };
}

export function readRecord(index, key) {
  const hit = index && index.file && index.idx.get(key);
  if (!hit) return null;
  let fd; try {
    fd = openSync(index.file, 'r'); const b = Buffer.alloc(hit[1]); readSync(fd, b, 0, hit[1], hit[0]);
    return JSON.parse(b.toString('utf8'));
  } catch { return null; } finally { if (fd !== undefined) try { closeSync(fd); } catch { /* */ } }
}

if (process.argv[1] && process.argv[1].endsWith('films-credits.mjs')) {
  const a = process.argv.slice(2); const get = (k, d) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : d; };
  if (a[0] === 'build') {
    const r = await build({ films: get('--films', 'data/films/films.ndjson'), out: get('--out', 'data/films'), batch: +get('--batch', 80), log: (m) => console.log(`[credits] ${m}`) });
    process.exit(r.films ? 0 : 1);
  } else console.log('usage: node integrations/films-credits.mjs build --films <films.ndjson> --out <dir> [--batch 80]');
}
