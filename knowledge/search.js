// knowledge/search.js — deterministic topic lookup over the scripture corpus. No LLM.
// Scores each scripture document against a query (title + key_themes + id), so the command menu,
// the Phase-3 corpus-index, and the Witness can route a topic to the right document + cite it.
//
//   node knowledge/search.js "egregore tulpa"
//   import { searchScripture } from './knowledge/search.js'

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const INDEX = path.join(HERE, 'scripture', '_index.json');

function load() {
  const d = JSON.parse(readFileSync(INDEX, 'utf8'));
  return d.documents || d.scriptures || Object.values(d).find(Array.isArray) || [];
}

const norm = (s) => String(s || '').toLowerCase();

// score a doc against the query terms: title hit = 3, theme hit = 2, id hit = 1
function score(doc, terms) {
  const title = norm(doc.title), themes = (doc.key_themes || []).map(norm).join(' | '), id = norm(doc.id);
  let s = 0; const why = [];
  for (const t of terms) {
    if (title.includes(t)) { s += 3; why.push(`title:${t}`); }
    const themeHit = (doc.key_themes || []).find(k => norm(k).includes(t));
    if (themeHit) { s += 2; why.push(`theme:${themeHit}`); }
    if (id.includes(t)) { s += 1; }
  }
  return { score: s, why };
}

export function searchScripture(query, { limit = 5 } = {}) {
  const terms = norm(query).split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  return load()
    .map(doc => ({ id: doc.id, title: doc.title, file: doc.file_md, key_themes: doc.key_themes || [], ...score(doc, terms) }))
    .filter(d => d.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

if (process.argv[1] && process.argv[1].endsWith('search.js')) {
  const q = process.argv.slice(2).join(' ');
  if (!q) { console.error('usage: node knowledge/search.js "<topic>"'); process.exit(1); }
  const hits = searchScripture(q);
  if (!hits.length) { console.log(`No scripture matches for "${q}".`); process.exit(0); }
  console.log(`Scripture matches for "${q}":`);
  for (const h of hits) {
    console.log(`\n  [${h.score}] ${h.title}`);
    console.log(`      cite: knowledge/scripture/${h.file}`);
    console.log(`      themes: ${h.key_themes.slice(0, 4).join(' · ')}`);
    if (h.why.length) console.log(`      matched: ${[...new Set(h.why)].join(', ')}`);
  }
}
