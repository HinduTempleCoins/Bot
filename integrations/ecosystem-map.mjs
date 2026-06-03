// ecosystem-map.mjs — the ESTATE MAP for the soapy.blog admin HUD (task #211).
//
// The operator's direct ask: "I need to know what all we have in this Repo, on the Admin
// Hud, including what is Happening on all Blockchains with our stuff." Not just holdings
// (that's chains-hud.mjs) — the WHOLE picture on ONE page:
//   • WHAT WE'VE BUILT and WHERE  — software per chain, the bots, the tokens we mint,
//     the dApps + sites we run.
//   • WHAT'S LIVE vs BUILT-but-hidden in the repo (reuses feature-registry.mjs).
//   • WHAT'S HAPPENING ON-CHAIN for our accounts (recent ops, soft-fail).
//
// This is a VIEW. It NEVER holds a key, NEVER signs, NEVER broadcasts. The ESTATE is a
// curated, hand-maintained registry of OUR footprint (public names only). On-chain
// activity is read through an INJECTED/defensive account-history reader and soft-fails
// to [] when offline. Mirrors chains-hud.mjs conventions exactly:
//   - ESM, injectable sources via __setSources({...}) so tests run fully OFFLINE.
//   - DEFENSIVE dynamic imports for the real readers (feature-registry / activity) —
//     a missing/renamed export degrades to a soft-fail, never throws.
//   - SOFT-FAIL PER SECTION: repo-count failing never sinks on-chain; on-chain failing
//     never sinks the estate. The page always renders.
//
//   import { ESTATE, ecosystemMap, headline, renderMap, activityFor } from './ecosystem-map.mjs'
//   await ecosystemMap()
//   node integrations/ecosystem-map.mjs

// ---------------------------------------------------------------------------
// ESTATE — the curated registry of WHAT WE'VE BUILT AND WHERE. Public identifiers
// only; NO key material ever appears here (the tests assert that). This is the heart
// of the page and is kept accurate to this repo by hand.
//
// Account names route through env first (so the public repo carries no real name it
// doesn't have to), then sensible defaults — same pattern as chains-hud.mjs.
const ENV = (k, d) => {
  const v = process.env[k];
  return v != null && String(v).trim() !== '' ? String(v).trim() : d;
};

export const ESTATE = {
  // --- our chains: per chain, the accounts + which of OUR software touches it -----
  chains: [
    {
      key: 'melek',
      label: 'MELEK',
      kind: 'graphene (BLURT/Graphene fork)',
      status: 'pre-testnet',
      accounts: [{ account: ENV('MELEK_HUD_HATHOR', 'hathor'), role: 'founding AI witness' }],
      software: [
        'witness/hathor.js — block production',
        'witness/feed-publisher — informational price feed',
        'witness/monitor — missed-block / signing alerts',
        'chain-explorer.mjs — steemd-style explorer (MELEK_RPC_URL ready)',
      ],
      tokens: ['MELEK'],
      note: 'native chain; hathor witness slot protected for year 1 (chain-side).',
    },
    {
      key: 'hive',
      label: 'HIVE',
      kind: 'graphene',
      status: 'live',
      accounts: [
        { account: ENV('MELEK_HUD_HIVE_ANGEL', 'angelicalist'), role: 'trade-bot operator' },
        { account: ENV('MELEK_HUD_HIVE_KALI', 'kalivankush'), role: 'trade-bot operator' },
      ],
      software: [
        'angelicalist execute / dry-run — trade-bot runner',
        'profit-tracker — per-trade cost/revenue log',
        'he-client / he-token / he-market — HIVE-Engine readers',
        'tradebot-forensics.mjs — read-only trade history',
      ],
      tokens: ['VKBT', 'CURE'],
      note: 'live HIVE-Engine token activity; testing of Bot broadcast happens on MELEK, not here.',
    },
    {
      key: 'bitshares',
      label: 'BitShares',
      kind: 'graphene (BitShares-family)',
      status: 'planned',
      accounts: [],
      software: ['SoapBox DEX integration — planned', 'RWA tokenization scaffold (UIA compliance flags)'],
      tokens: ['SOAP'],
      note: 'SOAP + planned real-world-asset issuance.',
    },
    {
      key: 'prana',
      label: 'PRANA',
      kind: 'evm (useful-work chain)',
      status: 'planned',
      accounts: [],
      software: [
        'chains/* adapters — EVM read/balance/connect',
        'EVM account-abstraction grants (ERC-4337/7702 session keys)',
        'prana-wallet — read-only portfolio',
      ],
      tokens: ['PRANA'],
      note: 'pre-launch EVM chain; AA grant + wallet layers built.',
    },
    {
      key: 'blurt',
      label: 'BLURT',
      kind: 'graphene',
      status: 'lineage',
      accounts: [],
      software: ['lineage / reference only — MELEK forks the Graphene line BLURT sits on'],
      tokens: [],
      note: 'heritage chain; not an active deployment target.',
    },
  ],

  // --- our bots: each {name, role, status, surfaces} ---------------------------
  bots: [
    { name: 'Hathor', role: 'founding AI witness persona', status: 'built', surfaces: ['MELEK chain', 'Discord', 'Telegram'] },
    { name: 'CheetahAdvanced', role: 'credit-first librarian (factual source matches)', status: 'built', surfaces: ['repo module'] },
    { name: 'Ashurbanipal', role: 'wiki writer + fact-checker', status: 'built', surfaces: ['MediaWiki', 'Discord', 'Telegram'] },
    { name: 'Trade bots', role: 'HIVE-Engine arbitrage (read-only forensics here)', status: 'built', surfaces: ['HIVE'] },
    { name: 'Watcher', role: 'out-of-band sensitive-op alerter (no keys)', status: 'built', surfaces: ['file', 'Telegram', 'email'] },
    { name: 'Telegram bot', role: 'operator + community front desk', status: 'live', surfaces: ['Telegram'] },
    { name: 'Discord bot', role: 'community surface + steemd queries (!sb)', status: 'live', surfaces: ['Discord'] },
  ],

  // --- tokens we build: each {symbol, chain, status, purpose} -------------------
  tokens: [
    { symbol: 'VKBT', chain: 'HIVE-Engine', status: 'live', purpose: 'Van Kush brand/utility token' },
    { symbol: 'CURE', chain: 'HIVE-Engine', status: 'live', purpose: 'utility token' },
    { symbol: 'MELEK', chain: 'MELEK', status: 'pre-launch', purpose: 'native chain token' },
    { symbol: 'SOAP', chain: 'BitShares', status: 'planned', purpose: 'SoapBox / DEX + RWA' },
    { symbol: 'PRANA', chain: 'PRANA (EVM)', status: 'planned', purpose: 'useful-work chain native token' },
  ],

  // --- dApps + sites we run ----------------------------------------------------
  sites: [
    { name: 'data.soapbox.community', kind: 'CMC-style data aggregator', status: 'live', url: 'https://data.soapbox.community' },
    { name: 'soapy.blog (admin HUD)', kind: 'operator admin portal', status: 'built', url: 'https://soapy.blog' },
    { name: 'Library / Wiki', kind: 'open corpus + Ashurbanipal wiki', status: 'built' },
    { name: 'Search ribbon', kind: 'vertical-tab search storefront (Hathor AI mode)', status: 'built' },
    { name: 'Games suite', kind: 'collector / gacha / arcade / fort hub', status: 'built' },
    { name: 'Forums', kind: 'MyBB community (forums.soapbox.community)', status: 'planned' },
  ],
};

// ---------------------------------------------------------------------------
// Injectable sources. Tests call __setSources({...}) to run offline; production
// leaves these null and the defensive loaders below supply the real readers.
//   registryReader: async () => { total, byStatus:{LIVE,BUILT,SCAFFOLD}, byCategory, hidden }
//   activityReader: async (account, chainKey) => [ { time, type, summary } ]
let _sources = { registryReader: null, activityReader: null };
/** Inject sources for offline tests. Pass {} or nothing to clear back to defaults. */
export function __setSources(obj) {
  _sources = {
    registryReader: obj?.registryReader || null,
    activityReader: obj?.activityReader || null,
  };
}

// --- defensive dynamic loaders ---------------------------------------------
// Repo counts via feature-registry.mjs::summary — soft-fail to null.
async function loadRegistryReader() {
  if (_sources.registryReader) return _sources.registryReader;
  try {
    const mod = await import('./feature-registry.mjs');
    if (typeof mod.summary === 'function') return async () => mod.summary();
  } catch { /* soft-fail */ }
  return null;
}

// On-chain activity via a condenser/account-history reader. chain-explorer.mjs
// exposes transfers(name, limit) over condenser_api.get_account_history — soft-fail to [].
async function loadActivityReader() {
  if (_sources.activityReader) return _sources.activityReader;
  try {
    const mod = await import('./chain-explorer.mjs');
    if (typeof mod.transfers === 'function') {
      return async (account /*, chainKey */) => {
        const rows = await mod.transfers(account, 10);
        return (Array.isArray(rows) ? rows : []).map((r) => ({
          time: r.time,
          type: 'transfer',
          summary: `${r.from} → ${r.to} ${r.amount}`,
        }));
      };
    }
  } catch { /* soft-fail */ }
  return null;
}

/**
 * Recent on-chain ops for one account on one chain. Always returns an array;
 * soft-fails to [] when offline / no reader / reader throws. NEVER throws.
 */
export async function activityFor(account, chain, { activityReader } = {}) {
  if (!account) return [];
  let reader = activityReader || null;
  if (!reader) { try { reader = await loadActivityReader(); } catch { reader = null; } }
  if (!reader) return [];
  try {
    const rows = await reader(account, chain);
    return Array.isArray(rows) ? rows : [];
  } catch { return []; }
}

/**
 * Assemble the whole ecosystem map: ESTATE snapshot + repo counts + on-chain
 * activity per account + asOf. Each section soft-fails INDEPENDENTLY. NEVER throws.
 * @returns {Promise<{estate, repo, onchain, asOf}>}
 */
export async function ecosystemMap({ estate } = {}) {
  const asOf = new Date().toISOString();
  const est = estate || ESTATE;

  // --- repo counts (own soft-fail) ---
  let repo = null;
  try {
    const registryReader = await loadRegistryReader();
    if (registryReader) {
      const s = await registryReader();
      const live = s?.byStatus?.LIVE ?? 0;
      const total = s?.total ?? 0;
      repo = {
        total,
        live,
        hidden: s?.hidden ?? Math.max(0, total - live),
        byCategory: s?.byCategory || {},
      };
    }
  } catch { repo = null; }

  // --- on-chain activity, per configured account (own soft-fail each) ---
  let activityReader = null;
  try { activityReader = await loadActivityReader(); } catch { activityReader = null; }
  const onchain = [];
  for (const chain of (Array.isArray(est.chains) ? est.chains : [])) {
    for (const acc of (Array.isArray(chain.accounts) ? chain.accounts : [])) {
      const ops = await activityFor(acc.account, chain.key, { activityReader });
      onchain.push({ chain: chain.label, account: acc.account, ops });
    }
  }

  return { estate: est, repo, onchain, asOf };
}

// ---------------------------------------------------------------------------
/** Plain-English one-liner for the whole estate. Never throws. */
export function headline(map) {
  const m = map || {};
  const est = m.estate || ESTATE;
  const bots = Array.isArray(est.bots) ? est.bots : [];
  const tokens = Array.isArray(est.tokens) ? est.tokens : [];
  const liveTokens = tokens.filter((t) => t.status === 'live').length;
  const melek = (Array.isArray(est.chains) ? est.chains : []).find((c) => c.key === 'melek');

  const parts = [];
  if (m.repo && Number.isFinite(m.repo.total)) {
    parts.push(`~${m.repo.total} modules built (${m.repo.live} live on the site)`);
  }
  if (liveTokens) parts.push(`${liveTokens} tokens live on HIVE`);
  if (bots.length) parts.push(`${bots.length} bots`);
  if (melek) parts.push(`MELEK chain ${melek.status}`);
  return parts.length ? parts.join('; ') + '.' : 'Ecosystem map: nothing registered yet.';
}

// HTML escape — defends every interpolated string (bot names, notes, summaries).
export function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

const STATUS_DOT = { live: '#2ecc71', built: '#3498db', planned: '#f1c40f', 'pre-testnet': '#f1c40f', 'pre-launch': '#f1c40f', lineage: '#95a5a6' };
const dot = (status) => `<span class="dot" style="background:${STATUS_DOT[status] || '#95a5a6'}" title="${escapeHtml(status)}"></span>`;
const li = (s) => `<li>${escapeHtml(s)}</li>`;

/** Render the whole map to escaped HTML — headline + 5 sections. Never throws. */
export function renderMap(map) {
  const m = map || {};
  const est = m.estate || ESTATE;
  const chains = Array.isArray(est.chains) ? est.chains : [];
  const bots = Array.isArray(est.bots) ? est.bots : [];
  const tokens = Array.isArray(est.tokens) ? est.tokens : [];
  const sites = Array.isArray(est.sites) ? est.sites : [];
  const onchain = Array.isArray(m.onchain) ? m.onchain : [];

  // activity lookup: "Chain|account" -> ops[]
  const actMap = new Map();
  for (const o of onchain) actMap.set(`${o.chain}|${o.account}`, Array.isArray(o.ops) ? o.ops : []);

  // 1) Our Chains — per-chain card (software / bots-here / tokens / activity)
  const chainCards = chains.map((c) => {
    const accts = (Array.isArray(c.accounts) ? c.accounts : []);
    const acctLines = accts.map((a) => {
      const ops = actMap.get(`${c.label}|${a.account}`) || [];
      const recent = ops.length
        ? `<ul class="activity">${ops.slice(0, 5).map((op) => li(`${op.time || ''} ${op.summary || op.type || ''}`.trim())).join('')}</ul>`
        : '<p class="muted">no recent on-chain activity read</p>';
      return `<div class="acct"><strong>${escapeHtml(a.account)}</strong> <small class="muted">${escapeHtml(a.role || '')}</small>${recent}</div>`;
    }).join('') || '<p class="muted">no accounts configured</p>';
    const software = (Array.isArray(c.software) ? c.software : []).map(li).join('') || '<li class="muted">none</li>';
    const tks = (Array.isArray(c.tokens) ? c.tokens : []).map(li).join('') || '<li class="muted">none</li>';
    return `<section class="chain-card" data-chain="${escapeHtml(c.key)}">
  <h3>${dot(c.status)} ${escapeHtml(c.label)} <small class="muted">(${escapeHtml(c.kind)} · ${escapeHtml(c.status)})</small></h3>
  <div class="software"><h4>our software here</h4><ul>${software}</ul></div>
  <div class="tokens"><h4>tokens</h4><ul>${tks}</ul></div>
  <div class="accounts"><h4>accounts &amp; activity</h4>${acctLines}</div>
  ${c.note ? `<p class="muted note">${escapeHtml(c.note)}</p>` : ''}
</section>`;
  }).join('\n');

  // 2) Our Bots
  const botRows = bots.map((b) =>
    `<tr><td>${dot(b.status)} ${escapeHtml(b.name)}</td><td>${escapeHtml(b.role)}</td><td>${escapeHtml(b.status)}</td><td>${escapeHtml((Array.isArray(b.surfaces) ? b.surfaces : []).join(', '))}</td></tr>`
  ).join('') || '<tr><td colspan="4" class="muted">no bots registered</td></tr>';

  // 3) Our Tokens
  const tokenRows = tokens.map((t) =>
    `<tr><td>${dot(t.status)} ${escapeHtml(t.symbol)}</td><td>${escapeHtml(t.chain)}</td><td>${escapeHtml(t.status)}</td><td>${escapeHtml(t.purpose)}</td></tr>`
  ).join('') || '<tr><td colspan="4" class="muted">no tokens registered</td></tr>';

  // 4) Our Sites & dApps
  const siteRows = sites.map((s) => {
    const name = s.url ? `<a href="${escapeHtml(s.url)}">${escapeHtml(s.name)}</a>` : escapeHtml(s.name);
    return `<tr><td>${dot(s.status)} ${name}</td><td>${escapeHtml(s.kind)}</td><td>${escapeHtml(s.status)}</td></tr>`;
  }).join('') || '<tr><td colspan="3" class="muted">no sites registered</td></tr>';

  // 5) The Repo
  const repo = m.repo;
  const cats = repo && repo.byCategory
    ? Object.entries(repo.byCategory).sort((a, b) => (b[1]?.total || 0) - (a[1]?.total || 0))
        .map(([cat, c]) => `<li>${escapeHtml(cat)}: ${escapeHtml(String(c.total))} (${escapeHtml(String(c.live || 0))} live)</li>`).join('')
    : '';
  const repoBody = repo
    ? `<p>${escapeHtml(String(repo.total))} modules · ${escapeHtml(String(repo.live))} live · ${escapeHtml(String(repo.hidden))} built-but-hidden. <a href="/features">see the full catalog →</a></p>${cats ? `<ul>${cats}</ul>` : ''}`
    : '<p class="muted">repo counts unavailable (feature-registry soft-failed). <a href="/features">see the full catalog →</a></p>';

  return `<div class="ecosystem-map">
  <p class="headline">${escapeHtml(headline(m))}</p>
  <p class="readonly-note">read-only — no keys on this page. public names only.</p>

  <section class="our-chains"><h2>Our Chains</h2>
${chainCards}
  </section>

  <section class="our-bots"><h2>Our Bots</h2>
    <table><thead><tr><th>bot</th><th>role</th><th>status</th><th>surfaces</th></tr></thead><tbody>${botRows}</tbody></table>
  </section>

  <section class="our-tokens"><h2>Our Tokens</h2>
    <table><thead><tr><th>symbol</th><th>chain</th><th>status</th><th>purpose</th></tr></thead><tbody>${tokenRows}</tbody></table>
  </section>

  <section class="our-sites"><h2>Our Sites &amp; dApps</h2>
    <table><thead><tr><th>name</th><th>kind</th><th>status</th></tr></thead><tbody>${siteRows}</tbody></table>
  </section>

  <section class="the-repo"><h2>The Repo</h2>
    ${repoBody}
  </section>
</div>`;
}

// CLI (guarded) — prints headline + a compact text view. Read-only.
if (process.argv[1] && process.argv[1].endsWith('ecosystem-map.mjs')) {
  const map = await ecosystemMap();
  console.log(headline(map));
  console.log('read-only — no keys. public names only.\n' + '─'.repeat(64));
  for (const c of map.estate.chains) {
    console.log(`${c.label.padEnd(10)} [${c.status}]  ${c.kind}`);
    for (const s of (c.software || [])) console.log(`   sw: ${s}`);
    for (const a of (c.accounts || [])) {
      const ops = (map.onchain.find((o) => o.chain === c.label && o.account === a.account) || {}).ops || [];
      console.log(`   acct: ${a.account} (${a.role}) — ${ops.length} recent op(s)`);
    }
  }
  console.log('─'.repeat(64));
  console.log(`bots: ${map.estate.bots.map((b) => b.name).join(', ')}`);
  console.log(`tokens: ${map.estate.tokens.map((t) => `${t.symbol}(${t.status})`).join(', ')}`);
  console.log(`sites: ${map.estate.sites.map((s) => `${s.name}(${s.status})`).join(', ')}`);
  if (map.repo) console.log(`repo: ${map.repo.total} modules, ${map.repo.live} live, ${map.repo.hidden} hidden`);
}
