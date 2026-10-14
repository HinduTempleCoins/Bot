// brain-seed-systemmap.mjs — seat the whole-estate map INTO a decades-brain so Hathor knows every
// surface and repo she runs, not just the one she lives in. This is the "didn't know about Herald" fix
// (operator): the system map (integrations/system-brain-map.mjs → knowledge/system-map.json) exists as a
// file; this WIRES it into the brain as retrievable layers.
//
// It is NOT a data library — it teaches an existing brain via its own surfaces:
//   • each site  → brain.teachDoc (2000s TF-IDF retrieval) so "is there a herald?" finds it
//   • each repo  → brain.teachDoc so repo knowledge is reachable
//   • a summary  → brain.teachPattern (1960s) so "list your sites / how many surfaces" answers instantly
//   • optional   → brain.remember (2010s MiniLM embedding) when an embedder is wired, for fuzzy recall
//
// Pure + soft-fail + injectable (pass a map object, or a file path; tests pass a fixture). No network.
//
//   import { seedSystemMap } from './brain-seed-systemmap.mjs';
//   const { sites, repos } = seedSystemMap(brain, { map });      // or { mapFile: 'knowledge/system-map.json' }
//   node integrations/brain-seed-systemmap.mjs                    # coverage report against the live map

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const clip = (s, n) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, n);

/** Load the generated system map (object passthrough, or read the JSON file). Soft-fails to empty. */
export function loadMap({ map, mapFile } = {}) {
  if (map && typeof map === 'object') return map;
  const f = mapFile || join(ROOT, 'knowledge/system-map.json');
  try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return { sites: [], repos: [], counts: {} }; }
}

/** One retrieval document per site: host + app + purpose, answered with a one-line card. */
export function siteDoc(s) {
  const host = clip(s.host, 80), app = clip(s.app, 60), purpose = clip(s.purpose, 300);
  return {
    id: `site:${host}`,
    text: `${host} ${app} ${purpose}`.trim(),
    answer: `**${host}**${app ? ` (${app})` : ''}${purpose ? ` — ${purpose}` : ''}`,
  };
}

/** One retrieval document per repo: name + lang + desc + readme head. */
export function repoDoc(r) {
  const name = clip(r.name, 80), lang = clip(r.lang, 30);
  const desc = clip(r.desc || '', 300), readme = clip(r.readme || '', 400);
  return {
    id: `repo:${name}`,
    text: `${name} ${lang} ${desc} ${readme}`.trim(),
    answer: `**${name}**${lang ? ` (${lang})` : ''} — ${desc || readme || 'repository'}`,
  };
}

/** A whole-estate summary line for the 1960s pattern layer. */
export function estateSummary(map) {
  const c = map.counts || {};
  const sites = c.sites ?? (map.sites || []).length;
  const repos = c.repos ?? (map.repos || []).length;
  const apps = c.apps ?? new Set((map.sites || []).map((s) => s.app)).size;
  return `I run ${sites} live surfaces across ${apps} apps and ${repos} repositories — the whole MELEK / `
    + `SoapBox / Pentecaust / Van Kush estate. Ask me about any surface by name (e.g. Herald, the Wire, `
    + `the Library, the mining pool) and I can tell you what it is.`;
}

/**
 * Seat the map into a decades-brain. The brain must expose teachDoc; teachPattern and remember are used
 * when present. Returns {sites, repos, embedded} counts. Soft-fails per entry; never throws.
 * @param {object} brain  a createBrain() instance (decades-brain.mjs)
 * @param {object} opts   { map, mapFile, embedder } — map object or file; optional async embedder for 2010s layer
 */
export async function seedSystemMap(brain, opts = {}) {
  if (!brain || typeof brain.teachDoc !== 'function') return { sites: 0, repos: 0, embedded: 0, ok: false };
  const map = loadMap(opts);
  let sites = 0, repos = 0, embedded = 0;

  for (const s of (map.sites || [])) {
    try { const d = siteDoc(s); if (!d.text) continue; brain.teachDoc(d.id, d.text, d.answer); sites++;
      if (opts.embedder && typeof brain.remember === 'function') { if (await brain.remember(d.text, d.answer)) embedded++; }
    } catch { /* soft-fail this entry */ }
  }
  for (const r of (map.repos || [])) {
    try { const d = repoDoc(r); if (!d.text) continue; brain.teachDoc(d.id, d.text, d.answer); repos++;
      if (opts.embedder && typeof brain.remember === 'function') { if (await brain.remember(d.text, d.answer)) embedded++; }
    } catch { /* soft-fail this entry */ }
  }
  if (typeof brain.teachPattern === 'function') {
    try {
      brain.teachPattern('estate-map',
        /\b(how many|list|what are|show).*(sites|surfaces|domains|repos|repositories|estate|everything you (run|have)|whole system|all the)\b/i,
        estateSummary(map));
    } catch { /* soft-fail */ }
  }
  return { sites, repos, embedded, ok: true };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const map = loadMap({});
  console.log('system map:', JSON.stringify(map.counts || {}));
  console.log('sample site doc :', siteDoc((map.sites || [])[0] || {}));
  console.log('sample repo doc :', repoDoc((map.repos || [])[0] || {}));
  console.log('estate summary  :', estateSummary(map));
}
