// dossier-bot.mjs — the autonomous "wiki-editor" accountability bot.
//
// Works the long tail over time: for any politician / company it gathers the SAME dimensions we
// curated by hand for Paxton & Menendez — Wikipedia (cited), GDELT news, SEC EDGAR filings, and
// congressional STOCK-Act trades — and writes a dossier JSON the politics site renders.
//
// DISCIPLINE (inherited, enforced structurally): FACTS + SOURCES, never verdicts. Every event
// carries its source URL. Nothing is fabricated — the bot only records what a source actually says,
// and marks the subject of each claim. Auto-built dossiers are flagged (auto:true, verified:false,
// a provenance note) so a human pass can confirm and promote them. It uses Wikipedia and says so.
//
// Runs incrementally: runQueue() processes N subjects per pass off a roster, tracks state, and is
// driven by a systemd timer on the box — a slow, steady editor, not a firehose.
//
//   node integrations/dossier-bot.mjs build "Josh Hawley"
//   node integrations/dossier-bot.mjs run --limit 5
//   node integrations/dossier-bot.mjs seed-congress > /tmp/roster.json

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as apis from './accountability-apis.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..');
const DEFAULT_DIR = join(REPO, 'knowledge', 'accountability');

const str = (v) => (v == null ? '' : String(v)).trim();
export function slugify(name) {
  return str(name).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}

// Default dependency set — the real readers. Tests inject fakes.
const REAL_DEPS = {
  wikipediaSummary: apis.wikipediaSummary,
  classifySentences: apis.classifySentences,
  discoverMedia: apis.discoverMedia,
  secEdgarFullText: apis.secEdgarFullText,
  congressTrades: apis.congressTrades,
};

const evKey = (e) => `${str(e.type)}::${str(e.label).toLowerCase().replace(/\s+/g, ' ').slice(0, 60)}`;

/**
 * Build (do not write) a dossier object for one subject. Pulls Wikipedia + GDELT (+ SEC for orgs,
 * + congressional trades for members). Never throws. Returns a dossier or null if there's nothing
 * sourced to say (we don't file an empty page).
 *   opts: { kind:'person'|'org', chamber:'senate'|'house', party, office, builtAt, deps }
 */
export async function buildDossierFor(name, opts = {}) {
  const who = str(name);
  if (!who) return null;
  const deps = { ...REAL_DEPS, ...(opts.deps || {}) };
  const kind = opts.kind === 'org' ? 'org' : 'person';
  const builtFrom = [];
  const records = [];

  // 1) Wikipedia — identity + a cited bio, and watchdog sentences from the extract.
  let wiki = null;
  // 60k chars ≈ most of a long bio, so late "Controversies"/"Disclosures" sections aren't truncated away.
  try { wiki = await deps.wikipediaSummary(who, { full: true, maxChars: 60000 }); } catch { wiki = null; }
  if (wiki) {
    builtFrom.push('Wikipedia');
    const fromExtract = deps.classifySentences(wiki.extract, { subject: who, source: wiki.source });
    records.push(...fromExtract);
  }

  // 2) GDELT — recent news classified into candidate events.
  let media = [];
  try { media = await deps.discoverMedia(who); } catch { media = []; }
  if (media.length) builtFrom.push('GDELT news');
  records.push(...media);

  // 3) Holdings — congressional trades (members) or SEC insider filings (orgs/people).
  if (kind === 'person' && opts.chamber) {
    let trades = [];
    try { trades = await deps.congressTrades(who, { chamber: opts.chamber, max: 25 }); } catch { trades = []; }
    if (trades.length) builtFrom.push(opts.chamber === 'house' ? 'House Stock Watcher' : 'Senate Stock Watcher');
    records.push(...trades);
  }
  if (kind === 'org') {
    let sec = [];
    try { sec = await deps.secEdgarFullText(who, { forms: '4', max: 15 }); } catch { sec = []; }
    if (sec.length) builtFrom.push('SEC EDGAR');
    records.push(...sec);
  }

  // Nothing sourced → don't file an empty page.
  const sourced = records.filter((r) => r && (r.source || r.holder || r.subject));
  if (!sourced.length && !wiki) return null;

  // De-dupe events by type+label.
  const seen = new Set();
  const deduped = [];
  for (const r of records) {
    const k = r.type && r.label ? evKey(r) : JSON.stringify(r).slice(0, 80);
    if (seen.has(k)) continue;
    seen.add(k); deduped.push(r);
  }

  const person = {
    kind, id: who, name: who,
    office: str(opts.office) || (wiki ? str(wiki.description) : '') || undefined,
    party: str(opts.party) || undefined,
    bio_url: wiki ? wiki.url : undefined,
  };
  Object.keys(person).forEach((k) => person[k] === undefined && delete person[k]);

  return {
    slug: slugify(who), person, auto: true, verified: false,
    verifyNote: `Auto-compiled by the MELEK accountability bot from ${builtFrom.join(' + ') || 'public sources'}. Each item links its source; candidate items await human confirmation. Facts and connections only — no verdicts.`,
    builtFrom, builtAt: str(opts.builtAt) || null,
    records: deduped, disputes: [], reply: '',
  };
}

/** Write a dossier to <dir>/<slug>.json. Refuses to clobber a HAND-CURATED (non-auto) file. */
export async function writeDossier(dossier, { dir = DEFAULT_DIR, fs } = {}) {
  if (!dossier || !dossier.slug) return { ok: false, reason: 'no slug' };
  const writeFn = fs?.writeFile || writeFile;
  const readFn = fs?.readFile || readFile;
  const mkdirFn = fs?.mkdir || mkdir;
  const path = join(dir, `${dossier.slug}.json`);
  try {
    const existing = JSON.parse(await readFn(path, 'utf8'));
    if (existing && existing.auto === false) return { ok: false, reason: 'curated — left untouched', path };
  } catch { /* not present — fine */ }
  try {
    await mkdirFn(dir, { recursive: true });
    await writeFn(path, JSON.stringify(dossier, null, 2) + '\n', 'utf8');
    return { ok: true, path, events: dossier.records.length };
  } catch (e) { return { ok: false, reason: e.message, path }; }
}

/**
 * Process up to `limit` subjects off a roster that aren't already done. Tracks done-slugs in a state
 * file so it advances each run. roster: [{ name, kind, chamber, party, office }]. Never throws.
 */
export async function runQueue({ roster = [], limit = 5, dir = DEFAULT_DIR, statePath, builtAt, deps, fs, delayMs = 0 } = {}) {
  const readFn = fs?.readFile || readFile;
  const writeFn = fs?.writeFile || writeFile;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let state = { done: [], built: 0 };
  if (statePath) { try { state = { ...state, ...JSON.parse(await readFn(statePath, 'utf8')) }; } catch { /* fresh */ } }
  const done = new Set(state.done || []);
  const todo = roster.filter((r) => r && r.name && !done.has(slugify(r.name))).slice(0, Math.max(1, limit));
  const built = [];
  for (let i = 0; i < todo.length; i++) {
    const r = todo[i];
    if (delayMs && i > 0) await sleep(delayMs); // be a good API citizen (GDELT: 1 req / 5s)
    const d = await buildDossierFor(r.name, { kind: r.kind, chamber: r.chamber, party: r.party, office: r.office, builtAt, deps });
    const slug = slugify(r.name);
    if (d) {
      const w = await writeDossier(d, { dir, fs });
      built.push({ name: r.name, slug, ok: w.ok, events: w.events || 0, reason: w.reason });
    } else {
      built.push({ name: r.name, slug, ok: false, reason: 'nothing sourced' });
    }
    done.add(slug);
  }
  state.done = [...done];
  state.built = (state.built || 0) + built.filter((b) => b.ok).length;
  if (statePath) { try { await writeFn(statePath, JSON.stringify(state, null, 2), 'utf8'); } catch { /* best-effort */ } }
  return { built, totalDone: done.size, rosterSize: roster.length, remaining: roster.length - done.size };
}

// ── curated rosters (governors / state AGs / federal judges) ─────────────────────────────────────
// A stale/misspelled name simply fails its Wikipedia lookup and is skipped — never a wrong page.
let _rosterCache = null;
async function loadRosterFile({ fs } = {}) {
  if (_rosterCache) return _rosterCache;
  const readFn = fs?.readFile || readFile;
  try { _rosterCache = JSON.parse(await readFn(join(HERE, 'accountability-roster.json'), 'utf8')); }
  catch { _rosterCache = { governors: [], stateAGs: [], judges: [] }; }
  return _rosterCache;
}
const withKind = (arr, kind = 'person') => (Array.isArray(arr) ? arr : []).map((e) => ({ kind, ...e }));

export async function seedGovernors(opts = {}) { return withKind((await loadRosterFile(opts)).governors); }
export async function seedStateAGs(opts = {}) { return withKind((await loadRosterFile(opts)).stateAGs); }
export async function seedFederalJudges(opts = {}) { return withKind((await loadRosterFile(opts)).judges); }

/**
 * The full roster: Congress (live dataset) + governors + state AGs + federal judges, ROUND-ROBIN
 * interleaved so the bot covers all four categories in parallel over time (not 537 reps first).
 * De-duped by slug.
 */
export async function seedAll(opts = {}) {
  const groups = await Promise.all([seedGovernors(opts), seedStateAGs(opts), seedFederalJudges(opts), seedCongress(opts)]);
  const seen = new Set(); const out = [];
  const maxLen = Math.max(0, ...groups.map((g) => g.length));
  for (let i = 0; i < maxLen; i++) {
    for (const g of groups) {
      const e = g[i]; if (!e) continue;
      const s = slugify(e.name);
      if (s && !seen.has(s)) { seen.add(s); out.push(e); }
    }
  }
  return out;
}

/** Seed a roster from the open congress-legislators dataset (current members). Soft-fails to []. */
export async function seedCongress({ fetchFn } = {}) {
  const f = fetchFn || ((...a) => fetch(...a));
  try {
    const r = await f('https://unitedstates.github.io/congress-legislators/legislators-current.json', { headers: { 'user-agent': 'MELEK-Witness/1.0' } });
    if (!r || !r.ok) return [];
    const list = await r.json();
    return (Array.isArray(list) ? list : []).map((m) => {
      const name = m.name && (m.name.official_full || `${m.name.first || ''} ${m.name.last || ''}`.trim());
      const term = Array.isArray(m.terms) && m.terms.length ? m.terms[m.terms.length - 1] : {};
      return name ? { name, kind: 'person', chamber: term.type === 'sen' ? 'senate' : 'house', party: term.party || '', office: term.type === 'sen' ? 'U.S. Senator' : 'U.S. Representative' } : null;
    }).filter(Boolean);
  } catch { return []; }
}

const isMain = (() => { try { return import.meta.url === `file://${process.argv[1]}`; } catch { return false; } })();
if (isMain) {
  const cmd = process.argv[2] || 'build';
  const arg = process.argv[3];
  if (cmd === 'build' && arg) {
    const d = await buildDossierFor(arg, { kind: process.argv[4] === 'org' ? 'org' : 'person', chamber: process.argv[5] });
    process.stdout.write(d ? JSON.stringify(d, null, 2) + '\n' : 'nothing sourced\n');
  } else if (cmd === 'seed-congress') {
    process.stdout.write(JSON.stringify(await seedCongress(), null, 2) + '\n');
  } else if (cmd === 'seed') {
    const cat = arg || 'all';
    const fn = { governors: seedGovernors, ags: seedStateAGs, judges: seedFederalJudges, congress: seedCongress, all: seedAll }[cat] || seedAll;
    const r = await fn();
    process.stdout.write(`${cat}: ${r.length} subjects\n` + r.slice(0, 8).map((e) => `  - ${e.name} (${e.office || e.chamber || ''})`).join('\n') + '\n');
  } else if (cmd === 'run') {
    const li = process.argv.indexOf('--limit');
    const limit = li > 0 ? +process.argv[li + 1] : 5;
    const roster = await seedAll();
    const stamp = new Date().toISOString().slice(0, 10);
    const delayMs = +(process.env.DOSSIER_BOT_DELAY_MS || 6000);
    const out = await runQueue({ roster, limit, statePath: join(DEFAULT_DIR, '_state.json'), builtAt: stamp, delayMs });
    process.stdout.write(JSON.stringify(out, null, 2) + '\n');
  } else {
    process.stdout.write('usage: dossier-bot.mjs build "Name" [org|person] [senate|house] | seed-congress | run --limit N\n');
  }
}
