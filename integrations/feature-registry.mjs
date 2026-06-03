// feature-registry.mjs — the inventory behind the Soapy.blog admin "Features" catalog.
//
// The operator can't see, from the running subdomains alone, everything that's been BUILT in the
// repo. Dozens of integration modules and vertical pages exist that aren't yet surfaced on a live
// SoapBox subdomain. This module enumerates every built capability and classifies it:
//
//   • LIVE        — imported by a live server (soapbox / admin) or wired into a surfaced page/vertical
//   • BUILT       — module exists with a test, but nothing live imports it yet  ("ready to surface")
//   • SCAFFOLD    — module exists but has no test yet                            ("in progress")
//
// so the admin portal can show "here's what you have that the public can't see yet" and the operator
// can flip a front-facing flag per capability (the flag store records INTENT; a deploy step consumes it).
//
// Pure-ish + soft-fail. The filesystem scan is injectable (__setFs) so tests run offline on fixtures.
// No network. No secrets — only module filenames, categories, and on/off flags ever leave here.
//
//   import { repoFeatures, summary, getFlags, setFlag } from './feature-registry.mjs'
//   const feats = await repoFeatures();        // [{ id, path, category, status, surface, hasTest }]
//   node integrations/feature-registry.mjs     # print the catalog + counts

import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');                       // repo root
const FLAGS_PATH = join(ROOT, 'data', 'feature-flags.json');

// injectable fs (tests pass a fake; default is the real node:fs/promises)
let _fs = { readdir, readFile };
export function __setFs(fake) { _fs = fake || { readdir, readFile }; }

// ── categorisation: filename/path → a human bucket ───────────────────────────
// First matching rule wins; order from most to least specific.
const CATEGORY_RULES = [
  [/(^|\/)games\//i, 'Games'],
  [/^chains?\//i, 'Blockchain / multichain'],
  [/^soapbox\/adapters\//i, 'Market data adapters'],
  [/^soapbox\//i, 'SoapBox Data verticals'],
  [/(grant|vault|credential|secret|admin-auth|ifttt|walletconnect|siwe|oauth|aa-grant)/i, 'Auth / vault / grants'],
  [/(trade|angelicalist|profit|staking|market-entry|exchange|he-token|he-market)/i, 'Trading'],
  [/(cheetah|fact|wiki|grounding|library|rag|scraper|search)/i, 'Knowledge / search'],
  [/(llm|model|router|rules|mycin|lora|smol|tiny|eval|langfuse|certainty|ensemble)/i, 'AI / reasoning'],
  [/(bio|consent|consciousness|biodao|nft-mint)/i, 'Bio-NFT'],
  [/(watcher|diagnostic|infra|metrics|security|notify|monitor)/i, 'Infra / monitoring'],
  [/(comms|social|connector|assistant|telegram|discord|matrix|smart-home)/i, 'Comms / connectors'],
  [/(game-agent|offerwall|access-bond|economy)/i, 'Games'],
  [/(resource-center|provenance|viewcounter|hashtags|widgets|listing-seo)/i, 'Platform plumbing'],
];

export function categoryFor(relPath) {
  for (const [re, cat] of CATEGORY_RULES) if (re.test(relPath)) return cat;
  return 'Other integrations';
}

// ── launch tiers: the operator's decision lens (operator feedback 2026-06-03) ─
// "Most things aren't going live anyways... stuff that might go Front Facing
// First based on our Discussions should be at the Top." Tiers sort the catalog
// by the decision actually being made, not by code taxonomy:
//
//   FRONT-FACING FIRST — candidates for the next public portals per the v3
//     synthesis + operator decisions (Law.SoapBox / Politics.SoapBox, benefits,
//     gov-records business accountability, media catalog, data verticals).
//   PUBLIC CANDIDATE   — could become a public page; no decision forced yet.
//   GATED              — blocked on something real (chain launch, MELEK-Signer,
//     operator approval, a license/registration) — not a go-live toggle.
//   INTERNAL TOOL      — runs FOR the operator/AIs (monitoring, brief/annal
//     machinery, admin surfaces). Never a public page; "go live" doesn't apply.
//   BUILDING BLOCK     — a library other modules import (rankers, schemas,
//     parsers). Ships inside other features; never a page of its own.
const TIERS = ['FRONT-FACING FIRST', 'PUBLIC CANDIDATE', 'GATED', 'INTERNAL TOOL', 'BUILDING BLOCK'];

// first match wins, checked before category fallbacks
const TIER_RULES = [
  // the Law.SoapBox / Politics.SoapBox decision set + civic spine
  [/(lawyer|court|caselaw|legal|judge|fec|congress|lobby|fara|election|civic|politic)/i, 'FRONT-FACING FIRST'],
  [/(benefits|grants|sba|usaspending)/i, 'FRONT-FACING FIRST'],
  // business-accountability records (the neighborhood-Crunchbase backbone)
  [/(fda-recalls|cpsc|nhtsa|fsis|osha|cfpb|fbi-crime|scam|sec-edgar|opencorporates|recalls)/i, 'FRONT-FACING FIRST'],
  // big data verticals already proven on data.soapbox
  [/(fred|census|worldbank|pubmed|patents|wikidata|treasury|vehicle|market-health)/i, 'FRONT-FACING FIRST'],
  // building blocks: libraries other modules import, never pages
  [/(bm25|provenance|schema(\.|$)|certainty|digest|tracking|widgets|viewcounter|routing|steemd|he-client|page-factory)/i, 'BUILDING BLOCK'],
];

const TIER_BY_CATEGORY = {
  'Trading': 'GATED',                       // operator-gated (zero-WIF, dry-run rules)
  'Blockchain / multichain': 'GATED',       // gated on MELEK chain + signer
  'Bio-NFT': 'GATED',                       // Phase 3
  'Auth / vault / grants': 'GATED',         // signer/operator boundary
  'Infra / monitoring': 'INTERNAL TOOL',
  'AI / reasoning': 'INTERNAL TOOL',
  'Platform plumbing': 'INTERNAL TOOL',
  'Comms / connectors': 'INTERNAL TOOL',
};

// why a gated thing is gated — shown to the operator instead of a dead toggle
export function gateReasonFor(f) {
  if (f.category === 'Trading') return 'gated: live trading needs your explicit approval (dry-run until then)';
  if (f.category === 'Blockchain / multichain') return 'gated: waiting on MELEK chain endpoint + MELEK-Signer';
  if (f.category === 'Bio-NFT') return 'gated: Phase 3 (conversational Witness) work';
  if (f.category === 'Auth / vault / grants') return 'gated: key-custody boundary — ships with the signer step';
  return null;
}

export function tierFor(f) {
  for (const [re, tier] of TIER_RULES) if (re.test(f.id)) return tier;
  if (TIER_BY_CATEGORY[f.category]) return TIER_BY_CATEGORY[f.category];
  return 'PUBLIC CANDIDATE';
}

export function tierOrder() { return TIERS.slice(); }

// ── plain-English description: read the module's own header comment ──────────
// Repo convention: every module opens with `// name.mjs — what this is...`
// followed by comment lines. That header IS the human description — surface it
// instead of making the operator guess from a filename.
export async function descriptionFor(root, relPath) {
  let txt = '';
  try { txt = await _fs.readFile(join(root, relPath), 'utf8'); } catch { return ''; }
  const lines = txt.split('\n', 14);
  const out = [];
  for (const line of lines) {
    const m = /^\/\/\s?(.*)$/.exec(line.trim());
    if (!m) { if (out.length) break; else continue; }
    let s = m[1].trim();
    if (!s) { if (out.length) break; else continue; }
    // drop the leading "name.mjs — " so the sentence starts with the substance
    s = s.replace(/^[\w./-]+\.(mjs|js)\s*[—–-]\s*/, '');
    out.push(s);
    if (out.join(' ').length > 220) break;
  }
  let d = out.join(' ').replace(/\s+/g, ' ').trim();
  if (d.length > 240) d = d.slice(0, 237).replace(/\s+\S*$/, '') + '…';
  return d;
}

// a friendlier display name from a module id
export function labelFor(relPath) {
  const base = basename(relPath).replace(/\.mjs$/, '').replace(/\.js$/, '');
  return base.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

// ── discover module files under integrations/ (recursive, skips tests) ───────
async function listMjs(dir, rel = '') {
  let entries = [];
  try { entries = await _fs.readdir(dir, { withFileTypes: true }); }
  catch { return []; }
  const out = [];
  for (const e of entries) {
    const name = e.name;
    const childRel = rel ? `${rel}/${name}` : name;
    if (e.isDirectory()) {
      if (name === 'node_modules' || name.startsWith('.')) continue;
      out.push(...await listMjs(join(dir, name), childRel));
    } else if (/\.(mjs|js)$/.test(name) && !/\.test\.(mjs|js)$/.test(name)) {
      out.push(childRel);
    }
  }
  return out;
}

// which module ids does a live server / surfaced file import? (substring match on the import path)
async function surfacedSet(root) {
  const surfaceFiles = [
    ['site/soapbox/server.mjs', 'data.soapbox.community'],
    ['site/soapbox/verticals.mjs', 'data.soapbox.community'],
    ['site/admin/server.mjs', 'soapy.blog (admin)'],
    ['integrations/resource-center.mjs', 'Resource Center'],
  ];
  const surfaced = new Map();      // module-basename → surface label
  for (const [f, label] of surfaceFiles) {
    let txt = '';
    try { txt = await _fs.readFile(join(root, f), 'utf8'); } catch { continue; }
    // capture every relative import's final path segment, e.g. './soapbox/coin-socials.mjs' → coin-socials
    const re = /from\s+['"]([^'"]+\.(?:mjs|js))['"]/g;
    let m;
    while ((m = re.exec(txt))) {
      const seg = basename(m[1]).replace(/\.(mjs|js)$/, '');
      if (!surfaced.has(seg)) surfaced.set(seg, label);
    }
  }
  return surfaced;
}

// ── the catalog ──────────────────────────────────────────────────────────────
export async function repoFeatures({ root = ROOT } = {}) {
  const mods = await listMjs(join(root, 'integrations'), '');
  const surfaced = await surfacedSet(root);
  const seenTests = new Set();
  // collect which modules have a sibling .test file
  for (const m of mods) { /* placeholder to keep order */ void m; }
  const testRel = (await listMjsTests(join(root, 'integrations'), ''));
  for (const t of testRel) seenTests.add(t.replace(/\.test\.(mjs|js)$/, ''));

  const flags = await getFlags();
  const feats = await Promise.all(mods
    .filter((m) => !/^(index)\.mjs$/.test(m))          // keep barrels visible? skip pure index barrels
    .map(async (rel) => {
      const id = rel.replace(/\.(mjs|js)$/, '');
      const seg = basename(id);
      const surface = surfaced.get(seg) || null;
      const hasTest = seenTests.has(id);
      const status = surface ? 'LIVE' : (hasTest ? 'BUILT' : 'SCAFFOLD');
      const f = {
        id, path: `integrations/${rel}`,
        label: labelFor(rel),
        category: categoryFor(rel),
        surface,                                         // where it's live, or null
        hasTest,
        status,
        flag: normalizeFlag(flags[id]),                  // operator's decision { state, note, at } | null
        description: await descriptionFor(root, `integrations/${rel}`),
      };
      f.tier = tierFor(f);
      f.gateReason = f.tier === 'GATED' ? gateReasonFor(f) : null;
      return f;
    }));
  const tierRank = Object.fromEntries(tierOrder().map((t, i) => [t, i]));
  feats.sort((a, b) => (tierRank[a.tier] - tierRank[b.tier])
    || a.category.localeCompare(b.category) || a.label.localeCompare(b.label));
  return feats;
}

// tests live next to modules; list them separately so we can mark hasTest
async function listMjsTests(dir, rel = '') {
  let entries = [];
  try { entries = await _fs.readdir(dir, { withFileTypes: true }); }
  catch { return []; }
  const out = [];
  for (const e of entries) {
    const childRel = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      out.push(...await listMjsTests(join(dir, e.name), childRel));
    } else if (/\.test\.(mjs|js)$/.test(e.name)) {
      out.push(childRel);
    }
  }
  return out;
}

export async function summary({ root = ROOT } = {}) {
  const feats = await repoFeatures({ root });
  const byStatus = { LIVE: 0, BUILT: 0, SCAFFOLD: 0 };
  const byCategory = {};
  for (const f of feats) {
    byStatus[f.status] = (byStatus[f.status] || 0) + 1;
    byCategory[f.category] = byCategory[f.category] || { total: 0, live: 0, hidden: 0 };
    byCategory[f.category].total++;
    if (f.status === 'LIVE') byCategory[f.category].live++; else byCategory[f.category].hidden++;
  }
  return { total: feats.length, byStatus, byCategory, hidden: feats.filter((f) => f.status !== 'LIVE').length };
}

// ── front-facing flag store (records operator INTENT; deploy step consumes it) ─
let _flagCache = null;
export async function getFlags() {
  if (_flagCache) return _flagCache;
  try {
    const txt = await _fs.readFile(FLAGS_PATH, 'utf8');
    _flagCache = JSON.parse(txt) || {};
  } catch { _flagCache = {}; }
  return _flagCache;
}

// Decision states (operator feedback 2026-06-03: "more interactive than just
// hidden or go-live"). Stored shape: { state, note, at }. Back-compat: old
// boolean true reads as { state: 'queue' }.
export const FLAG_STATES = ['queue', 'later', 'never'];

export function normalizeFlag(v) {
  if (v == null || v === false) return null;
  if (v === true) return { state: 'queue', note: '', at: null };
  if (typeof v === 'object' && FLAG_STATES.includes(v.state)) {
    return { state: v.state, note: String(v.note || ''), at: v.at || null };
  }
  return null;
}

// set a feature's decision. `state` ∈ FLAG_STATES, or null/'clear'/false to clear.
// Legacy boolean `true` still means 'queue'. Persists to data/feature-flags.json.
export async function setFlag(id, state, note = '') {
  const flags = await getFlags();
  const key = String(id);
  if (state === true) state = 'queue';
  if (state == null || state === false || state === 'clear' || state === '0') {
    delete flags[key];
  } else if (FLAG_STATES.includes(state)) {
    flags[key] = { state, note: String(note || '').slice(0, 280), at: new Date().toISOString() };
  } else {
    return { ok: false, id: key, error: `unknown state '${state}'` };
  }
  _flagCache = flags;
  try {
    if (!existsSync(dirname(FLAGS_PATH))) await mkdir(dirname(FLAGS_PATH), { recursive: true });
    await writeFile(FLAGS_PATH, JSON.stringify(flags, null, 2));
    return { ok: true, id: key, state: flags[key]?.state ?? null };
  } catch (e) {
    return { ok: false, id: key, error: e?.message || String(e) };
  }
}

export function __resetFlagCache() { _flagCache = null; }

// ── CLI ───────────────────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('feature-registry.mjs')) {
  (async () => {
    const s = await summary();
    const feats = await repoFeatures();
    console.log(`Features: ${s.total} total · LIVE ${s.byStatus.LIVE} · BUILT (hidden) ${s.byStatus.BUILT} · SCAFFOLD ${s.byStatus.SCAFFOLD}`);
    console.log(`\nBuilt but NOT yet on a live subdomain (${s.hidden}):`);
    for (const f of feats.filter((x) => x.status !== 'LIVE').slice(0, 40)) {
      console.log(`  [${f.status}] ${f.category} · ${f.label}  (${f.path})`);
    }
  })();
}
