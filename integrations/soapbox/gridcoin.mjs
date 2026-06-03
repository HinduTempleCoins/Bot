// gridcoin.mjs — distributed-research feed for SoapBox (queue #112). Aggregates PUBLISHED stats from
// the volunteer-computing world: BOINC projects (World Community Grid, Rosetta@home, Folding@home) and
// the GridCoin (GRC) network that rewards BOINC contribution with a coin. We don't run any compute here
// — we read each project's own published stats endpoint, normalize it, and surface a directory + a
// "recent published results" feed so a SoapBox reader can see what useful work the crowd is doing.
//
// PRANA connection: GridCoin is the LIVE PRECEDENT for PRANA's useful-work GPU layer. GRC turns
// volunteer scientific computation (protein folding, disease modeling, climate) into on-chain reward —
// reward-for-useful-compute, already running for a decade. PRANA generalizes that: PRANA runs the
// compute; this module only aggregates the public scoreboard. When PRANA's useful-work layer exists,
// it slots in here as just another "project" with the same stats shape — the directory below is the
// template. (Aggregate stats here; run compute on PRANA.)
//
// All readers SOFT-FAIL: a dead endpoint yields null/[] (or a directory-only summary), never a throw —
// the SoapBox page degrades to the curated directory instead of erroring. ESM, keyless, cached.

import { cached, TTL } from './cache.mjs';

const UA = 'Mozilla/5.0 (compatible; MELEK-Bot/1.0)';
let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

// ---- curated directory ---------------------------------------------------------------------------
// Each project: id (stable key), name, kind (boinc|coin), research focus, the public home URL, and a
// `stats` endpoint we can read keyless. `statsKind` tells projectStats() how to parse the response:
//   boincstats : BOINC <project_statistics> XML-ish / JSON team-total feed (total_credit + n hosts)
//   fah        : Folding@home's keyless JSON stats API (credit_score + active CPUs/GPUs)
//   grc        : GridCoin network info (handled by gridcoinStats(), listed here for completeness)
export const PROJECTS = [
  {
    id: 'wcg', name: 'World Community Grid', kind: 'boinc', statsKind: 'boincstats',
    focus: 'Humanitarian health & climate — cancer, tuberculosis, COVID, microbiome, clean energy',
    url: 'https://www.worldcommunitygrid.org/',
    stats: 'https://www.worldcommunitygrid.org/boinc/stats/team.json',
  },
  {
    id: 'rosetta', name: 'Rosetta@home', kind: 'boinc', statsKind: 'boincstats',
    focus: 'Protein structure prediction & design — disease, vaccines, novel proteins',
    url: 'https://boinc.bakerlab.org/rosetta/',
    stats: 'https://boinc.bakerlab.org/rosetta/stats/team.gz',
  },
  {
    id: 'folding', name: 'Folding@home', kind: 'fah', statsKind: 'fah',
    focus: 'Protein folding & molecular dynamics — Alzheimer’s, cancer, COVID',
    url: 'https://foldingathome.org/',
    stats: 'https://api2.foldingathome.org/project',
  },
  {
    id: 'gridcoin', name: 'GridCoin (GRC)', kind: 'coin', statsKind: 'grc',
    focus: 'Cryptocurrency that REWARDS BOINC contribution — useful-work proof, the PRANA precedent',
    url: 'https://gridcoin.us/',
    stats: 'https://www.grcpool.com/api/network', // public pool/network snapshot (keyless)
  },
];

/** Look up a curated project by id (case-insensitive). Returns the entry or null. */
export function findProject(id) {
  if (!id) return null;
  const key = String(id).toLowerCase();
  return PROJECTS.find((p) => p.id === key) || null;
}

// ---- normalizers (pure, tolerate junk) -----------------------------------------------------------
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };

/** Normalize a BOINCstats-style team/project total feed → { totalCredit, hosts, users, raw }. */
export function normalizeBoinc(body, project) {
  const b = body || {};
  // accept a few common shapes: flat, {team:{...}}, {project_statistics:{...}}
  const t = b.team || b.project_statistics || b.stats || b;
  return {
    id: project?.id, name: project?.name, kind: 'boinc',
    totalCredit: num(t.total_credit ?? t.totalCredit ?? t.credit),
    avgCredit: num(t.expavg_credit ?? t.avgCredit ?? t.recent_average_credit),
    hosts: num(t.nhosts ?? t.hosts ?? t.host_count),
    users: num(t.nusers ?? t.users ?? t.member_count),
    source: project?.name || 'BOINC',
  };
}

/** Normalize Folding@home's stats JSON → { totalCredit, activeCpus, activeGpus, raw }. */
export function normalizeFah(body, project) {
  const b = body || {};
  return {
    id: project?.id, name: project?.name, kind: 'fah',
    totalCredit: num(b.credit ?? b.credit_score ?? b.score),
    activeCpus: num(b.active_cpus ?? b.cpus),
    activeGpus: num(b.active_gpus ?? b.gpus),
    teams: num(b.teams),
    source: project?.name || 'Folding@home',
  };
}

/** Normalize a GridCoin network/pool snapshot → difficulty, magnitude, supply, project count. */
export function normalizeGridcoin(body) {
  const b = body || {};
  return {
    kind: 'coin', symbol: 'GRC',
    difficulty: num(b.difficulty ?? b.diff),
    netWeight: num(b.netstakeweight ?? b.net_weight ?? b.netWeight),
    moneySupply: num(b.moneysupply ?? b.supply ?? b.money_supply),
    totalMagnitude: num(b.total_magnitude ?? b.totalMagnitude ?? b.magnitude),
    blocks: num(b.blocks ?? b.height),
    activeProjects: num(b.projects ?? b.active_projects ?? b.whitelisted_projects),
    source: 'GridCoin',
  };
}

// ---- readers (soft-fail) -------------------------------------------------------------------------
async function getJson(url) {
  try {
    const r = await _fetch(url, { headers: { 'user-agent': UA } });
    if (!r || !r.ok) return null;
    return await r.json();
  } catch { return null; }
}

/**
 * Published stats for one project (by id or directory entry). Reads that project's own stats endpoint,
 * normalizes per its statsKind. Soft-fails to null on any error / unknown id. Cached 5 min.
 */
export async function projectStats(project) {
  const p = typeof project === 'string' ? findProject(project) : project;
  if (!p || !p.stats) return null;
  return cached(`gridcoin:proj:${p.id}`, TTL.ohlcv, async () => {
    if (p.statsKind === 'grc') return gridcoinStats();
    const body = await getJson(p.stats);
    if (body == null) return null;
    if (p.statsKind === 'fah') return normalizeFah(body, p);
    return normalizeBoinc(body, p);
  });
}

/** GridCoin (GRC) network snapshot: difficulty, magnitude, supply, whitelisted-project count. Cached 5 min. */
export async function gridcoinStats() {
  return cached('gridcoin:network', TTL.ohlcv, async () => {
    const entry = findProject('gridcoin');
    const body = await getJson(entry?.stats || 'https://www.grcpool.com/api/network');
    if (body == null) return null;
    return normalizeGridcoin(body);
  });
}

/**
 * Recent published results / links across the directory. Pulls each project's live stats (best-effort)
 * and pairs it with the project's public results/news URL so a reader can click through to the actual
 * science. Projects that fail their stats read still appear (directory-only row). Cached 5 min.
 */
export async function researchFeed() {
  return cached('gridcoin:feed', TTL.ohlcv, async () => {
    const rows = await Promise.all(PROJECTS.map(async (p) => {
      const stats = await projectStats(p).catch(() => null);
      return {
        id: p.id, name: p.name, kind: p.kind, focus: p.focus,
        url: p.url, stats: stats || null, hasLiveStats: stats != null,
      };
    }));
    return rows;
  });
}

/** Homepage chip: project count, how many returned live stats, and the GRC network line. */
export async function gridcoinSummary() {
  const feed = await researchFeed().catch(() => []);
  const grc = await gridcoinStats().catch(() => null);
  const boinc = feed.filter((r) => r.kind === 'boinc' || r.kind === 'fah');
  return {
    projects: PROJECTS.length,
    boincProjects: boinc.length,
    liveStats: feed.filter((r) => r.hasLiveStats).length,
    gridcoin: grc,
    note: 'Reward-for-useful-compute (GRC) is the live precedent for PRANA’s useful-work GPU layer.',
  };
}

// ---- CLI -----------------------------------------------------------------------------------------
if (process.argv[1] && process.argv[1].endsWith('gridcoin.mjs')) {
  const feed = await researchFeed();
  console.log('\nSoapBox — Distributed Research (BOINC + GridCoin)\n');
  for (const r of feed) {
    console.log(`  ${r.name.padEnd(24)} ${r.hasLiveStats ? 'live' : 'directory'}  — ${r.focus}`);
    if (r.stats) console.log(`      ${JSON.stringify(r.stats)}`);
  }
  console.log('\n' + JSON.stringify(await gridcoinSummary(), null, 2));
}
