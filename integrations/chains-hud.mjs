// chains-hud.mjs — the CHAINS board for the soapy.blog admin HUD (task #206).
// "What chains we have what on": per-chain holdings (READ-ONLY, public addresses
// only), node/chain status, and what of ours is deployed where.
//
// This is a VIEW. It NEVER holds a key, NEVER signs, NEVER broadcasts. It reads
// public balances + chain status off keyless endpoints and lays them out as an
// admin board. Every address in WATCHED is a PUBLIC account/address; key material
// lives nowhere near this file (and the tests assert that).
//
// Design mirrors integrations/prana-wallet.mjs + integrations/chains/multichain.mjs:
//   - ESM, injectable sources via __setSources({...}) so tests run fully OFFLINE.
//   - DEFENSIVE dynamic imports for the real readers (balances/he-client/
//     multichain) — a missing/renamed export degrades to a soft-fail, never throws.
//   - SOFT-FAIL PER CHAIN: one chain throwing/timing-out marks that chain
//     status:'unknown', ok:false — it never sinks the rest of the board.
//
//   import { chainsBoard, headline, renderBoard, WATCHED } from './chains-hud.mjs'
//   await chainsBoard()
//   node integrations/chains-hud.mjs

// ---------------------------------------------------------------------------
// WATCHED — the operator's footprint. Accounts/addresses by chain, sourced from
// env NAMES first (so the public repo carries no real address it doesn't have to)
// then sensible defaults. PUBLIC IDENTIFIERS ONLY — never a private key.
//   env override examples:
//     MELEK_HUD_HATHOR        -> hathor account on MELEK
//     MELEK_HUD_HIVE_ANGEL    -> angelicalist on HIVE
//     MELEK_HUD_HIVE_KALI     -> kalivankush on HIVE
//     MELEK_HUD_SOAP_ADDR     -> SOAP / BitShares account
//     MELEK_HUD_PRANA_ADDR    -> PRANA / EVM public address (0x...)
// `deployed` = what of OURS runs on that chain (the bot/witness/site footprint).
// `configured:false` chains render a calm "configure me" state, never an error.
const ENV = (k, d) => {
  const v = process.env[k];
  return v != null && String(v).trim() !== '' ? String(v).trim() : d;
};

export const WATCHED = [
  {
    key: 'melek',
    label: 'MELEK',
    kind: 'graphene',
    accounts: [{ account: ENV('MELEK_HUD_HATHOR', 'hathor'), asset: 'MELEK' }],
    deployed: ['hathor — founding AI witness (block production + price feed)', 'condenser / steemd query layer'],
    configured: true,
  },
  {
    key: 'hive',
    label: 'HIVE',
    kind: 'graphene',
    accounts: [
      { account: ENV('MELEK_HUD_HIVE_ANGEL', 'angelicalist'), asset: 'HIVE', heTokens: true },
      { account: ENV('MELEK_HUD_HIVE_KALI', 'kalivankush'), asset: 'HIVE', heTokens: true },
    ],
    deployed: ['HIVE-Engine token metrics + market readers', 'trade-bot history (read-only forensics)'],
    configured: true,
  },
  {
    key: 'soap',
    label: 'SOAP',
    kind: 'bitshares',
    accounts: ENV('MELEK_HUD_SOAP_ADDR')
      ? [{ account: ENV('MELEK_HUD_SOAP_ADDR'), asset: 'SOAP' }]
      : [],
    deployed: ['SoapBox DEX (BitShares-family) — planned'],
    configured: !!ENV('MELEK_HUD_SOAP_ADDR'),
  },
  {
    key: 'prana',
    label: 'PRANA',
    kind: 'evm',
    accounts: ENV('MELEK_HUD_PRANA_ADDR')
      ? [{ account: ENV('MELEK_HUD_PRANA_ADDR'), asset: 'PRANA' }]
      : [],
    deployed: ['PRANA useful-work chain (EVM) — pre-launch'],
    configured: !!ENV('MELEK_HUD_PRANA_ADDR'),
  },
];

// ---------------------------------------------------------------------------
// Injectable sources. Tests call __setSources({...}) to run offline; production
// leaves these null and the defensive loaders below supply the real readers.
//   balanceReader:   async (chainKey, account) => { balance:Number } | { error } | { needsKey }
//   heTokensReader:  async (account) => [ { symbol, balance } ]   (HIVE-Engine)
//   chainStatusReader: async (chainKey) => { up:boolean, height?, note? } | { error }
let _sources = {
  balanceReader: null,
  heTokensReader: null,
  chainStatusReader: null,
};
/** Inject sources for offline tests. Pass {} or nothing to clear back to defaults. */
export function __setSources(obj) {
  _sources = {
    balanceReader: obj?.balanceReader || null,
    heTokensReader: obj?.heTokensReader || null,
    chainStatusReader: obj?.chainStatusReader || null,
  };
}

// Map our HUD chain key -> the chain name balances.mjs/multichain.mjs understands.
// Graphene chains (melek/hive) and pre-launch chains (soap/prana) have no keyless
// native-balance RPC in those modules; they soft-fall to needsKey/configure-me.
const BALANCE_CHAIN = { prana: 'prana' /* EVM via balances.mjs once RPC wired */ };
const STATUS_CHAIN = { prana: 'prana', soap: 'soap' };

// --- defensive dynamic loaders ---------------------------------------------
async function loadBalanceReader() {
  if (_sources.balanceReader) return _sources.balanceReader;
  try {
    const mod = await import('./chains/balances.mjs');
    if (typeof mod.chainBalance === 'function') {
      return async (chainKey, account) => mod.chainBalance(BALANCE_CHAIN[chainKey] || chainKey, account);
    }
  } catch { /* soft-fail */ }
  return null;
}

async function loadHeTokensReader() {
  if (_sources.heTokensReader) return _sources.heTokensReader;
  try {
    const mod = await import('./he-client.mjs');
    if (typeof mod.find === 'function') {
      return async (account) => {
        const rows = await mod.find('tokens', 'balances', { account });
        return (Array.isArray(rows) ? rows : []).map((r) => ({
          symbol: r.symbol,
          balance: Number(r.balance),
        }));
      };
    }
  } catch { /* soft-fail */ }
  return null;
}

async function loadChainStatusReader() {
  if (_sources.chainStatusReader) return _sources.chainStatusReader;
  try {
    const mod = await import('./chains/multichain.mjs');
    if (typeof mod.chainStatus === 'function' && mod.CHAINS) {
      return async (chainKey) => {
        const name = STATUS_CHAIN[chainKey] || chainKey;
        if (!mod.CHAINS[name]) return { up: false, note: 'no keyless status reader for this chain' };
        const s = await mod.chainStatus(name);
        if (!s || s.error) return { error: s?.error || 'status read failed' };
        return { up: s.height != null, height: s.height };
      };
    }
  } catch { /* soft-fail */ }
  return null;
}

// Read every account on one chain into normalized holdings rows. Soft-fails the
// whole chain (returns { status, holdings, ok:false }) on a thrown reader.
async function readChain(spec, { balanceReader, heTokensReader, chainStatusReader }) {
  const base = {
    key: spec.key,
    label: spec.label,
    status: 'unknown',
    holdings: [],
    deployed: Array.isArray(spec.deployed) ? spec.deployed.slice() : [],
    ok: false,
  };

  // Not-yet-configured chains: calm "configure me" state, never an error.
  if (spec.configured === false || !Array.isArray(spec.accounts) || !spec.accounts.length) {
    return { ...base, status: 'unknown', ok: true, note: 'configure me — no public address set' };
  }

  try {
    // --- status (its own soft-fail; status failure ≠ chain failure) ---
    let status = 'unknown';
    try {
      if (chainStatusReader) {
        const st = await chainStatusReader(spec.key);
        if (st && !st.error) status = st.up ? 'up' : 'down';
        else if (st && st.error) status = 'unknown';
      }
    } catch { status = 'unknown'; }

    // --- holdings, per account ---
    // A THROWN balance reader is treated as a whole-chain failure (propagates to
    // the chain-level catch → status:'unknown', ok:false). A returned {error}/
    // {needsKey} row is a graceful per-account note and keeps the chain ok.
    const holdings = [];
    for (const acc of spec.accounts) {
      // native balance
      if (balanceReader) {
        const row = await balanceReader(spec.key, acc.account); // may throw → chain soft-fail
        if (row && Number.isFinite(Number(row.balance))) {
          holdings.push({ account: acc.account, asset: acc.asset || spec.label, amount: Number(row.balance) });
        } else {
          holdings.push({ account: acc.account, asset: acc.asset || spec.label, amount: null, note: row?.error || row?.needsKey || 'no balance' });
        }
      } else {
        holdings.push({ account: acc.account, asset: acc.asset || spec.label, amount: null, note: 'no balance reader' });
      }

      // HIVE-Engine tokens (own soft-fail; a flaky HE node ≠ chain down)
      if (acc.heTokens && heTokensReader) {
        try {
          const toks = await heTokensReader(acc.account);
          for (const t of (Array.isArray(toks) ? toks : [])) {
            const amt = Number(t.balance);
            if (t.symbol && Number.isFinite(amt) && amt > 0) {
              holdings.push({ account: acc.account, asset: t.symbol, amount: amt });
            }
          }
        } catch { /* HE soft-fail — keep native holdings */ }
      }
    }

    return { ...base, status, holdings, ok: true };
  } catch (e) {
    // Whole-chain soft-fail: unknown + ok:false, board stays up.
    return { ...base, status: 'unknown', ok: false, note: e?.message || 'chain read failed' };
  }
}

/**
 * Assemble the CHAINS board across all WATCHED chains.
 * @param {{ watched?: Array }} opts  — override the watch list (tests).
 * @returns {Promise<{chains:Array, totals:{byAsset:Object}, asOf:string}>}
 * Each chain is read INDEPENDENTLY and soft-fails on its own. NEVER throws.
 */
export async function chainsBoard({ watched } = {}) {
  const asOf = new Date().toISOString();
  const list = Array.isArray(watched) ? watched : WATCHED;

  let balanceReader = null, heTokensReader = null, chainStatusReader = null;
  try { balanceReader = await loadBalanceReader(); } catch { balanceReader = null; }
  try { heTokensReader = await loadHeTokensReader(); } catch { heTokensReader = null; }
  try { chainStatusReader = await loadChainStatusReader(); } catch { chainStatusReader = null; }

  const sources = { balanceReader, heTokensReader, chainStatusReader };
  const chains = await Promise.all(list.map((spec) => readChain(spec, sources)));

  // totals.byAsset — aggregate amounts across all chains by asset symbol.
  const byAsset = {};
  for (const c of chains) {
    for (const h of c.holdings) {
      const amt = Number(h.amount);
      if (!h.asset || !Number.isFinite(amt)) continue;
      byAsset[h.asset] = +((byAsset[h.asset] || 0) + amt).toFixed(8);
    }
  }

  return { chains, totals: { byAsset }, asOf };
}

/** Plain-English one-liner for the board. Never throws. */
export function headline(board) {
  const b = board || {};
  const chains = Array.isArray(b.chains) ? b.chains : [];
  if (!chains.length) return 'CHAINS: nothing watched yet.';
  const reachable = chains.filter((c) => c.status === 'up').length;
  const byAsset = (b.totals && b.totals.byAsset) || {};
  let biggest = null;
  for (const [asset, amt] of Object.entries(byAsset)) {
    const n = Number(amt) || 0;
    if (!biggest || n > biggest.amount) biggest = { asset, amount: n };
  }
  const fmt = (n) => Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 6 });
  const tail = biggest
    ? `; biggest holding ${fmt(biggest.amount)} ${biggest.asset}`
    : '; no holdings read yet';
  return `${chains.length} chains watched, ${reachable} reachable${tail}.`;
}

// HTML escape — defends every interpolated string (account names, notes, assets).
export function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

const DOT = { up: '#2ecc71', down: '#e74c3c', unknown: '#f1c40f' };
const fmtAmt = (n) => (n == null || !Number.isFinite(Number(n)))
  ? '—'
  : Number(n).toLocaleString('en-US', { maximumFractionDigits: 8 });

/** Render the board to escaped HTML — per-chain cards, headline first, read-only line. */
export function renderBoard(board) {
  const b = board || {};
  const chains = Array.isArray(b.chains) ? b.chains : [];

  const cards = chains.map((c) => {
    const color = DOT[c.status] || DOT.unknown;
    const rows = (Array.isArray(c.holdings) ? c.holdings : []).map((h) => {
      const amt = h.amount == null ? `<span class="muted">${escapeHtml(h.note || '—')}</span>` : escapeHtml(fmtAmt(h.amount));
      return `<tr><td>${escapeHtml(h.account)}</td><td>${escapeHtml(h.asset)}</td><td class="num">${amt}</td></tr>`;
    }).join('');
    const table = rows
      ? `<table class="holdings"><thead><tr><th>account</th><th>asset</th><th class="num">amount</th></tr></thead><tbody>${rows}</tbody></table>`
      : `<p class="muted">${escapeHtml(c.note || 'no holdings')}</p>`;
    const deployed = (Array.isArray(c.deployed) ? c.deployed : []).map(
      (d) => `<li>${escapeHtml(d)}</li>`
    ).join('') || '<li class="muted">nothing deployed here</li>';
    return `<section class="chain-card" data-chain="${escapeHtml(c.key)}">
  <h3><span class="dot" style="background:${color}" title="${escapeHtml(c.status)}"></span> ${escapeHtml(c.label)} <small class="muted">(${escapeHtml(c.status)})</small></h3>
  ${table}
  <div class="deployed"><h4>deployed here</h4><ul>${deployed}</ul></div>
</section>`;
  }).join('\n');

  return `<div class="chains-hud">
  <p class="headline">${escapeHtml(headline(b))}</p>
  <p class="readonly-note">read-only — no keys on this page. public addresses only.</p>
  ${cards}
</div>`;
}

// CLI (guarded) — prints the board headline + a compact text view. Read-only.
if (process.argv[1] && process.argv[1].endsWith('chains-hud.mjs')) {
  const board = await chainsBoard();
  console.log(headline(board));
  console.log('read-only — no keys. public addresses only.\n' + '─'.repeat(60));
  for (const c of board.chains) {
    console.log(`${c.label.padEnd(8)} [${c.status}]`);
    for (const h of c.holdings) {
      const v = h.amount == null ? `(${h.note || '—'})` : fmtAmt(h.amount);
      console.log(`   ${String(h.account).padEnd(16)} ${String(h.asset).padEnd(8)} ${v}`);
    }
    if (c.deployed?.length) console.log(`   ↳ ${c.deployed.join('; ')}`);
  }
  console.log('─'.repeat(60));
  console.log('totals by asset:', JSON.stringify(board.totals.byAsset));
}
