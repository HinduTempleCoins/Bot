// rc-usage.mjs — the Admin-Panel "Resource Center: what we use vs. what we have" report.
//
// Operator ask: "the Admin Panel should show some of the stuff we have that is NOT being used in
// the Resource Center, and what we ARE using."
//
// The repo has TWO bodies of data capability:
//   1. The 66-entry government API CATALOG in soapbox/govapis.mjs (GOV_APIS) — agencies + endpoints
//      we know about, each flagged keyless / api.data.gov-key / own-key.
//   2. Dozens of BUILT reader/data modules under integrations/ and integrations/soapbox/ (fred,
//      fbi-crime, treasury-fiscal, usgs-hazards, gov-readers, aviation, census-acs, worldbank, …).
//
// The Resource Center engine (resource-center.mjs) is the 24/7 intelligence pass. It only imports a
// HANDFUL of these (market-universe, macro, held-asset-scan, + a few advisory dynamic imports). The
// vast majority of built readers exist but the Resource Center never pulls them in — they're "on the
// shelf." This module makes that gap legible: it cross-references the catalog + the built modules
// against what resource-center.mjs (and the live SoapBox server) actually IMPORT, and labels each:
//
//   • USED      — imported by resource-center.mjs (in the RC intelligence pass)
//   • SURFACED  — not in RC, but imported by the live SoapBox server (public site uses it)
//   • UNUSED    — built (module + often a test) but nothing wires it into RC or the live site
//
// Pure-ish + soft-fail. Sources are INJECTABLE via __setSources({ readFile, readdir, govApis,
// govSummary }) so tests run fully offline on fixtures. No network. No secrets — only module
// filenames, agency/endpoint names, and on/off classifications ever leave here.
//
//   import { rcUsage, summary, __setSources } from './rc-usage.mjs'
//   const report = await rcUsage();   // { modules:[…], catalog:[…], summary:{…} }
//   node integrations/rc-usage.mjs            # print the report
//   node integrations/rc-usage.mjs --json     # raw JSON

import { readFile as _realReadFile, readdir as _realReaddir } from 'node:fs/promises';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');                                   // repo root
const INTEGRATIONS = join(ROOT, 'integrations');

// ── injectable sources (tests pass fakes; defaults hit the real repo / govapis) ──────────────────
// govApis / govSummary default to a DEFENSIVE import of govapis.mjs so a broken catalog can never take
// this report down — if the import fails we simply report an empty catalog.
let _src = {
  readFile: _realReadFile,
  readdir: _realReaddir,
  govApis: null,        // null → lazy-load from govapis.mjs on first use
  govSummary: null,
};
export function __setSources(obj) {
  _src = {
    readFile: obj?.readFile || _realReadFile,
    readdir: obj?.readdir || _realReaddir,
    govApis: obj?.govApis ?? null,
    govSummary: obj?.govSummary ?? null,
  };
}

// the files whose imports define "in use". RC = the Resource Center engine; the rest = live surfaces.
const RC_FILE = 'integrations/resource-center.mjs';
const SURFACE_FILES = [
  'site/soapbox/server.mjs',
  'site/soapbox/verticals.mjs',
  'site/admin/server.mjs',
];

// reader/data modules that aren't market/trade plumbing get a friendlier domain label for the panel.
// Pure cosmetic grouping; an unmatched module falls through to 'Data readers'.
const DOMAIN_RULES = [
  [/(gov-readers|usaspend|congress|openfec|fec|fema|usgs|treasury|fed-opportunit|datagov|patents|wikidata|census|worldbank|world-bank)/i, 'Government & civic data'],
  [/(fred|bls|bea|eia|energy|macro|stocks|sec-edgar|market|invest|onramp)/i, 'Economy & markets'],
  [/(fbi-crime|public-safety|workplace-safety|scam|cfpb|cpsc|fda-recall|recall|hazard)/i, 'Safety & accountability'],
  [/(cdc|pharma|health|usda|nutrition|biodiversity)/i, 'Health, food & nature'],
  [/(weather|noaa|aviation|flights|osm-poi|parks|nasa|maps|routing)/i, 'Weather, space & places'],
  [/(pubmed|library|lib-search|oai-pmh|legal|lawyer|courtlistener)/i, 'Knowledge & law'],
];
function domainFor(rel) {
  for (const [re, d] of DOMAIN_RULES) if (re.test(rel)) return d;
  return 'Data readers';
}

// a module is a "data reader" candidate (vs. site plumbing/cache/seo) if it looks like one of our
// source readers. We deliberately keep the catalog focused on data capability, not every util file.
const READER_HINT = /(gov|fred|bls|bea|eia|fbi|crime|treasury|usgs|fema|fec|congress|census|worldbank|world-bank|patents|wikidata|cdc|pharma|usda|nutrition|biodiversity|weather|noaa|aviation|flights|osm-poi|parks|nasa|pubmed|library|lib-search|oai-pmh|sec-edgar|cfpb|cpsc|recall|hazard|public-safety|workplace-safety|scam|energy|datagov|fed-opportunit|benefits|fcc-broadband|legal|lawyer)/i;

const labelFor = (rel) =>
  basename(rel).replace(/\.(mjs|js)$/, '').replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

// ── helpers ──────────────────────────────────────────────────────────────────────────────────────
async function readText(rel) {
  try { return await _src.readFile(join(ROOT, rel), 'utf8'); } catch { return ''; }
}

// every module basename imported by a file (static `from '…'` OR dynamic `import('…')`).
function importedSegments(txt) {
  const segs = new Set();
  const reStatic = /from\s+['"]([^'"]+\.(?:mjs|js))['"]/g;
  const reDyn = /import\(\s*['"]([^'"]+\.(?:mjs|js))['"]\s*\)/g;
  for (const re of [reStatic, reDyn]) {
    let m;
    while ((m = re.exec(txt))) segs.add(basename(m[1]).replace(/\.(mjs|js)$/, ''));
  }
  return segs;
}

// recursive list of reader modules under integrations/ (skips tests, node_modules, dotdirs).
async function listReaderModules(dir = INTEGRATIONS, rel = 'integrations') {
  let entries = [];
  try { entries = await _src.readdir(dir, { withFileTypes: true }); } catch { return []; }
  const out = [];
  const tests = new Set();
  for (const e of entries) {
    const name = e.name;
    const childRel = `${rel}/${name}`;
    if (e.isDirectory && e.isDirectory()) {
      if (name === 'node_modules' || name.startsWith('.')) continue;
      out.push(...await listReaderModules(join(dir, name), childRel));
    } else if (/\.test\.(mjs|js)$/.test(name)) {
      tests.add(name.replace(/\.test\.(mjs|js)$/, ''));
    } else if (/\.(mjs|js)$/.test(name)) {
      out.push({ rel: childRel, base: name.replace(/\.(mjs|js)$/, '') });
    }
  }
  // mark hasTest using the sibling-test set we collected at this level
  for (const m of out) if (m.rel.startsWith(`${rel}/`) && tests.has(m.base)) m.hasTest = true;
  return out;
}

// ── the catalog of GOV_APIS entries (from govapis.mjs), with whether RC pulls a reader for them ────
async function loadGov() {
  if (Array.isArray(_src.govApis)) return { apis: _src.govApis, summary: _src.govSummary || null };
  try {
    const mod = await import('./soapbox/govapis.mjs');
    return { apis: Array.isArray(mod.GOV_APIS) ? mod.GOV_APIS : [], summary: mod.summary ? mod.summary() : null };
  } catch {
    return { apis: [], summary: null };
  }
}

// ── the report ─────────────────────────────────────────────────────────────────────────────────
export async function rcUsage() {
  const rcTxt = await readText(RC_FILE);
  const rcImports = importedSegments(rcTxt);

  // union of everything the live surfaces import (site is "using" it even if RC isn't)
  const surfaceImports = new Set();
  const surfaceWhere = new Map();           // segment → first surface that imports it
  for (const f of SURFACE_FILES) {
    const segs = importedSegments(await readText(f));
    for (const s of segs) {
      surfaceImports.add(s);
      if (!surfaceWhere.has(s)) surfaceWhere.set(s, f);
    }
  }

  // 1) BUILT reader modules → USED / SURFACED / UNUSED.
  //    Include a module if it LOOKS like a data reader OR if the Resource Center actually imports it
  //    (an RC dependency is "in use" by definition, even if its name doesn't match the reader hint).
  const all = await listReaderModules();
  const modules = all
    // exclude self + the gov CATALOG backbone (govapis is the catalog this tool reads, not a reader).
    .filter((m) => (READER_HINT.test(m.rel) || rcImports.has(m.base)) && !/^(rc-usage|govapis)$/.test(m.base))
    .map((m) => {
      const used = rcImports.has(m.base);
      const surfaced = !used && surfaceImports.has(m.base);
      const status = used ? 'USED' : surfaced ? 'SURFACED' : 'UNUSED';
      return {
        id: m.base,
        path: m.rel,
        label: labelFor(m.rel),
        domain: domainFor(m.rel),
        hasTest: !!m.hasTest,
        status,                                          // USED | SURFACED | UNUSED
        usedBy: used ? RC_FILE : surfaced ? (surfaceWhere.get(m.base) || null) : null,
      };
    })
    .sort((a, b) => a.domain.localeCompare(b.domain) || a.label.localeCompare(b.label));

  // 2) GOV_APIS catalog — for each entry, do we have a built reader that looks like it, and is it USED?
  //    (heuristic name-match against built module basenames — advisory, like everything here.)
  const { apis, summary: govSum } = await loadGov();
  const builtById = new Map(modules.map((m) => [m.id, m]));
  const catalog = apis.map((e) => {
    const reader = guessReaderFor(e, builtById);
    return {
      agency: e.agency || '',
      name: e.name || '',
      domain: e.domain || '',
      keyless: !!e.keyless,
      keyViaDataGov: !!e.keyViaDataGov,
      reader: reader ? reader.id : null,                 // the built module that serves it, if any
      readerStatus: reader ? reader.status : 'NO READER',// USED | SURFACED | UNUSED | NO READER
      pageIdea: e.pageIdea || '',
    };
  });

  // 3) roll-up the admin panel renders at the top
  const modByStatus = { USED: 0, SURFACED: 0, UNUSED: 0 };
  for (const m of modules) modByStatus[m.status]++;
  const catByReader = { USED: 0, SURFACED: 0, UNUSED: 0, 'NO READER': 0 };
  for (const c of catalog) catByReader[c.readerStatus]++;

  const summaryOut = {
    modules: { total: modules.length, ...modByStatus },
    catalog: { total: catalog.length, byReaderStatus: catByReader, ...(govSum ? { keyless: govSum.keyless, ownKey: govSum.ownKey } : {}) },
    // the headline numbers for the panel: how much do we have that the RC isn't using?
    onTheShelf: modByStatus.UNUSED + modByStatus.SURFACED,
    inUseByRC: modByStatus.USED,
  };

  return { modules, catalog, summary: summaryOut };
}

// heuristic: which built reader serves a catalog entry? Match the entry's agency/name tokens against
// module ids. Returns the best (USED-preferred) match, or null.
function guessReaderFor(entry, builtById) {
  const hay = `${entry.agency} ${entry.name}`.toLowerCase();
  const tokens = hay.match(/[a-z]{3,}/g) || [];
  let best = null;
  for (const m of builtById.values()) {
    const idTokens = m.id.toLowerCase().split(/[^a-z]+/).filter((t) => t.length >= 3);
    if (idTokens.some((t) => tokens.includes(t))) {
      if (!best || (m.status === 'USED' && best.status !== 'USED')) best = m;
    }
  }
  return best;
}

// convenience wrapper used by the admin route + CLI
export async function summary() {
  return (await rcUsage()).summary;
}

// ── CLI ────────────────────────────────────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('rc-usage.mjs')) {
  const rep = await rcUsage();
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(rep, null, 2));
  } else {
    const s = rep.summary;
    console.log('Resource Center — what we USE vs. what we HAVE');
    console.log('─'.repeat(64));
    console.log(`Built data readers: ${s.modules.total}  ·  in use by RC: ${s.modules.USED}  ·  on the shelf: ${s.onTheShelf} (surfaced ${s.modules.SURFACED} / unused ${s.modules.UNUSED})`);
    console.log(`Gov API catalog: ${s.catalog.total} entries  ·  with a reader: ${s.catalog.total - s.catalog.byReaderStatus['NO READER']}  ·  no reader yet: ${s.catalog.byReaderStatus['NO READER']}`);
    console.log('\nBUILT but NOT used in the Resource Center:');
    for (const m of rep.modules.filter((x) => x.status !== 'USED')) {
      console.log(`  [${m.status.padEnd(8)}] ${m.domain.padEnd(26)} ${m.label}  (${m.path})`);
    }
    console.log('\nIN USE by the Resource Center:');
    for (const m of rep.modules.filter((x) => x.status === 'USED')) {
      console.log(`  [USED] ${m.domain.padEnd(26)} ${m.label}`);
    }
  }
}
