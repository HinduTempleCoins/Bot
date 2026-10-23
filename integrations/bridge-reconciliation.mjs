// bridge-reconciliation.mjs — the wrapped-supply solvency watchdog (minted ≤ custodied).
//
// THE INVARIANT. Every wrapped token on PRANA must be backed 1:1 by real assets locked in its
// custody account on the origin chain. If `totalSupply(wrapper) > custodied`, wrapper holders
// cannot all redeem — the exact defect this watchdog exists to catch: 5,001 wMELEK minted against
// 1.000 MELEK in L1 custody (admin-seeded, NOT deposit-backed).
//
// WHAT IT DOES (read-only): for each configured wrapper it reads
//   - minted   = wrapper.totalSupply() on PRANA (eth_call), at the wrapper's decimals, and
//   - custodied = the balance of the custody account on the ORIGIN chain
//                 (native MELEK via Graphene condenser_api.get_accounts, or a HIVE-Engine token
//                 balance via the HE contracts API),
// normalizes both to the wrapper's base units, and reports `backed = minted <= custodied` per token,
// plus the shortfall. Any read it cannot make comes back `indeterminate` — never a false "backed".
//
// BOUNDARIES (house style + BRIEF.md §7):
//   - Injectable fetch (`__setFetch`); tests run fully offline.
//   - Soft-fail-never-throw: every function returns a safe shape; a bad read is `ok:false`/
//     `indeterminate`, not an exception.
//   - This module SIGNS nothing and BROADCASTS nothing. It can BUILD an unsigned `pause()` call
//     descriptor, and `maybePause()` will only ever invoke an injected pauser when the caller has
//     EXPLICITLY opted in (`autoPause:true`) AND a shortfall exists. It is NOT auto-invoked.
//
//   import { reconcile, reconcileToken, loadConfig, buildPauseCall, maybePause,
//            __setFetch } from './bridge-reconciliation.mjs'
//   node integrations/bridge-reconciliation.mjs        # run once against configured RPCs, print JSON

// ---- injectable fetch (parity with the rest of integrations/) --------------
let _fetch = (...a) => globalThis.fetch(...a);
/** Test hook — inject fetch; pass nothing to restore the global. */
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

const UA = 'MELEK-Bot/1.0 (+https://github.com/HinduTempleCoins/Bot)';
const TOTAL_SUPPLY_SELECTOR = '0x18160ddd'; // keccak256("totalSupply()")[0:4]

// The canonical wrappers on PRANA mainnet and where their backing is custodied. Addresses are
// PUBLIC on-chain identifiers (not secrets). The custody ACCOUNTS are operator-config; defaults
// are the audited ones. Override any of it via env (see loadConfig).
export const DEFAULT_TOKENS = [
  {
    symbol: 'wMELEK',
    wrapper: '0xf6d9BE2859191b45820Df3A3B3b321b1b2589AB9',
    wrapperDecimals: 18,
    custody: { chain: 'melek', account: 'wmelek-bridge', symbol: 'MELEK', decimals: 3 },
  },
  {
    symbol: 'wVKBT',
    wrapper: '0xD915E757662c4234137aff167Bf93d588145f75e',
    wrapperDecimals: 8,
    custody: { chain: 'hive-engine', account: 'melek-bridge', symbol: 'VKBT', decimals: 8 },
  },
  {
    symbol: 'wCURE',
    wrapper: '0x03d613BDaAd82ecd6cf36B0fEf88Fb6AF9d977Ff',
    wrapperDecimals: 8,
    custody: { chain: 'hive-engine', account: 'melek-bridge', symbol: 'CURE', decimals: 8 },
  },
];

export const PRANA_RPC_ENV = 'PRANA_RPC_URL';
export const MELEK_RPC_ENV = 'MELEK_RPC_URL';
export const HIVE_ENGINE_RPC_ENV = 'HIVE_ENGINE_RPC_URL';
export const BRIDGE_ADDRESS_ENV = 'GRAPHENE_BRIDGE_ADDRESS';
export const MELEK_CUSTODY_ENV = 'MELEK_BRIDGE_CUSTODY';
export const HE_CUSTODY_ENV = 'HIVE_ENGINE_BRIDGE_CUSTODY';

/**
 * Read config from env. Never throws. Token list defaults to DEFAULT_TOKENS; the custody accounts
 * for the MELEK and HIVE-Engine legs can be overridden with env so this points at the REAL funded
 * custody once it exists (not the 1-MELEK stub).
 * @returns {{pranaRpc,melekRpc,hiveEngineRpc,bridgeAddress,tokens,timeoutMs,autoPause}}
 */
export function loadConfig(env = process.env) {
  const get = (n) => (env[n] != null ? String(env[n]).trim() : '');
  const tokens = DEFAULT_TOKENS.map((t) => {
    const c = { ...t.custody };
    if (c.chain === 'melek' && get(MELEK_CUSTODY_ENV)) c.account = get(MELEK_CUSTODY_ENV);
    if (c.chain === 'hive-engine' && get(HE_CUSTODY_ENV)) c.account = get(HE_CUSTODY_ENV);
    return { ...t, custody: c };
  });
  return {
    pranaRpc: get(PRANA_RPC_ENV),
    melekRpc: get(MELEK_RPC_ENV),
    hiveEngineRpc: get(HIVE_ENGINE_RPC_ENV) || 'https://api.hive-engine.com/rpc/contracts',
    bridgeAddress: get(BRIDGE_ADDRESS_ENV) || '0xf8245a4c9A8af47760C45D8393A74Ea8EEF1E505',
    tokens,
    timeoutMs: +(env.CHAIN_TIMEOUT_MS || 12000),
    // Auto-pause is OFF unless explicitly enabled. Even then maybePause needs an injected pauser.
    autoPause: /^(1|true|yes)$/i.test(get('BRIDGE_RECON_AUTOPAUSE')),
  };
}

// ---- low-level reads (all behind the injectable fetch) ---------------------

async function jsonRpc(url, method, params, timeoutMs = 12000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await _fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'user-agent': UA },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      signal: ctrl.signal,
    });
    const j = await r.json();
    if (j && j.error) throw new Error((j.error && j.error.message) || 'rpc-error');
    return j ? j.result : undefined;
  } finally {
    clearTimeout(t);
  }
}

/** Base-10 BigInt from a decimal-string balance ("23300.00000000") at `decimals`. null on junk. */
export function toBaseUnits(human, decimals) {
  if (human == null) return null;
  const s = String(human).trim().replace(/[, ]/g, '');
  const m = s.match(/^(\d+)(?:\.(\d+))?/); // tolerate a trailing " MELEK" symbol
  if (!m) return null;
  const intPart = m[1];
  const frac = (m[2] || '').padEnd(decimals, '0').slice(0, decimals);
  try { return BigInt(intPart + frac); } catch { return null; }
}

/**
 * Read a wrapper's totalSupply() via eth_call. Returns a BigInt of base units, or null on any error.
 */
export async function readWrapperSupply(pranaRpc, wrapper, timeoutMs = 12000) {
  if (!pranaRpc || !wrapper) return null;
  try {
    const hex = await jsonRpc(pranaRpc, 'eth_call',
      [{ to: wrapper, data: TOTAL_SUPPLY_SELECTOR }, 'latest'], timeoutMs);
    if (typeof hex !== 'string' || !/^0x[0-9a-fA-F]*$/.test(hex) || hex === '0x') return null;
    return BigInt(hex);
  } catch { return null; }
}

/**
 * Read a native MELEK (Graphene) account balance via condenser_api.get_accounts.
 * Returns { human, base } (base = BigInt at `decimals`), or null on any error.
 */
export async function readMelekBalance(melekRpc, account, decimals = 3, timeoutMs = 12000) {
  if (!melekRpc || !account) return null;
  try {
    const res = await jsonRpc(melekRpc, 'condenser_api.get_accounts', [[account]], timeoutMs);
    const acc = Array.isArray(res) ? res[0] : null;
    if (!acc || acc.balance == null) return null;
    const human = String(acc.balance).trim();       // "1.000 MELEK"
    const base = toBaseUnits(human, decimals);
    return base == null ? null : { human, base };
  } catch { return null; }
}

/**
 * Read a HIVE-Engine token balance via the contracts API (findOne on the `tokens` contract's
 * `balances` table). Returns { human, base }, or null on any error.
 */
export async function readHiveEngineBalance(heRpc, account, symbol, decimals = 8, timeoutMs = 12000) {
  if (!heRpc || !account || !symbol) return null;
  try {
    const res = await jsonRpc(heRpc, 'findOne',
      [{ contract: 'tokens', table: 'balances', query: { account, symbol } }], timeoutMs);
    // HE returns null when the account holds none of the token — that is a real 0, not an error.
    const human = res && res.balance != null ? String(res.balance) : '0';
    const base = toBaseUnits(human, decimals);
    return base == null ? null : { human, base };
  } catch { return null; }
}

// ---- per-token reconciliation ---------------------------------------------

/** Scale a base-unit BigInt from one decimal precision to another (widening or narrowing). */
export function rescale(base, fromDecimals, toDecimals) {
  if (base == null) return null;
  if (toDecimals >= fromDecimals) return base * (10n ** BigInt(toDecimals - fromDecimals));
  return base / (10n ** BigInt(fromDecimals - toDecimals)); // floor; narrowing loses dust
}

/**
 * Reconcile ONE token: read minted (wrapper totalSupply) and custodied (origin-chain balance),
 * normalize both to the wrapper's base units, and report backing. Never throws.
 * @returns {{symbol, ok, backed:boolean|null, minted, custodied, shortfall, status, reason?}}
 *   `backed:null`/`status:'indeterminate'` when a required read failed — never a false "backed".
 */
export async function reconcileToken(token, cfg) {
  const out = {
    symbol: token.symbol, wrapper: token.wrapper, ok: false, backed: null,
    minted: null, custodied: null, shortfall: null, status: 'indeterminate',
  };
  const minted = await readWrapperSupply(cfg.pranaRpc, token.wrapper, cfg.timeoutMs);
  if (minted == null) { out.reason = 'wrapper-supply-unreadable'; return out; }

  let custBase = null, custHuman = null;
  const c = token.custody || {};
  if (c.chain === 'melek') {
    const r = await readMelekBalance(cfg.melekRpc, c.account, c.decimals, cfg.timeoutMs);
    if (r) { custBase = r.base; custHuman = r.human; }
  } else if (c.chain === 'hive-engine') {
    const r = await readHiveEngineBalance(cfg.hiveEngineRpc, c.account, c.symbol, c.decimals, cfg.timeoutMs);
    if (r) { custBase = r.base; custHuman = r.human; }
  }

  // Normalize custody to the wrapper's base-unit precision so the comparison is apples-to-apples.
  const custodiedNorm = custBase == null ? null : rescale(custBase, c.decimals || 0, token.wrapperDecimals);

  out.minted = minted.toString();
  if (custodiedNorm == null) {
    out.reason = 'custody-balance-unreadable';
    return out; // indeterminate — we refuse to claim backed on a failed custody read
  }
  out.custodied = custodiedNorm.toString();
  out.custodyHuman = custHuman;
  const shortfall = minted - custodiedNorm;
  out.shortfall = shortfall.toString();
  out.ok = true;
  out.backed = shortfall <= 0n;
  out.status = out.backed ? 'backed' : 'SHORTFALL';
  return out;
}

/**
 * Reconcile ALL configured tokens. Returns a report with a top-level `alarm` if ANY token shows a
 * shortfall, and `indeterminate` for any token whose reads failed. Never throws.
 * @returns {{ts, ok, alarm:boolean, anyIndeterminate:boolean, tokens:object[]}}
 */
export async function reconcile(cfg = loadConfig()) {
  const tokens = [];
  for (const t of cfg.tokens || []) tokens.push(await reconcileToken(t, cfg));
  const alarm = tokens.some((t) => t.ok && t.backed === false);
  const anyIndeterminate = tokens.some((t) => !t.ok);
  return {
    ts: new Date().toISOString(),
    ok: tokens.every((t) => t.ok),
    alarm,
    anyIndeterminate,
    tokens,
  };
}

// ---- guarded pause path (NOT auto-invoked) --------------------------------

/**
 * The unsigned pause() call descriptor for the bridge. The caller's own signer (a PAUSER_ROLE key)
 * encodes + sends this; this module builds it only. Mirrors bridge-relayer's attestationCall shape.
 */
export function buildPauseCall(cfg = loadConfig()) {
  return {
    contract: 'GrapheneDepositBridge',
    contractAddressEnv: BRIDGE_ADDRESS_ENV,
    address: cfg.bridgeAddress,
    method: 'pause',
    args: [],
    unsigned: true,
  };
}

/**
 * Decide whether to pause given a reconcile() report. GUARDED: it will invoke `pause` ONLY when
 * (a) the report shows an alarm, (b) the caller passed `autoPause:true` (env BRIDGE_RECON_AUTOPAUSE),
 * AND (c) a `pause` function was injected. In every other case it returns the decision WITHOUT
 * acting. Default posture is observe-and-alarm; halting the bridge is an operator decision.
 * @param {object} report  from reconcile()
 * @param {{autoPause?:boolean, pause?:(call)=>any, cfg?:object}} opts
 * @returns {Promise<{paused:boolean, wouldPause:boolean, reason:string, call?:object, result?:any}>}
 */
export async function maybePause(report, opts = {}) {
  const wouldPause = !!(report && report.alarm);
  const call = buildPauseCall(opts.cfg || loadConfig());
  if (!wouldPause) return { paused: false, wouldPause, reason: 'no-shortfall' };
  if (!opts.autoPause) return { paused: false, wouldPause, reason: 'auto-pause-disabled (operator must pause manually)', call };
  if (typeof opts.pause !== 'function') return { paused: false, wouldPause, reason: 'no-pauser-injected', call };
  try {
    const result = await opts.pause(call);
    return { paused: true, wouldPause, reason: 'shortfall+autopause+pauser', call, result };
  } catch (e) {
    return { paused: false, wouldPause, reason: `pause-failed: ${String(e && e.message || e)}`, call };
  }
}

/** Human one-line summary per token, for the daemon log / CLI. */
export function summarize(report) {
  if (!report || !Array.isArray(report.tokens)) return 'reconcile: no report';
  const lines = report.tokens.map((t) => {
    if (!t.ok) return `  ${t.symbol}: INDETERMINATE (${t.reason || 'read-failed'})`;
    const flag = t.backed ? 'backed' : `*** SHORTFALL ${t.shortfall} ***`;
    return `  ${t.symbol}: minted=${t.minted} custodied=${t.custodied} -> ${flag}`;
  });
  const head = report.alarm ? 'RECON ALARM (unbacked wrapper detected)'
    : report.anyIndeterminate ? 'reconcile: some tokens indeterminate'
      : 'reconcile: all wrappers backed';
  return [head, ...lines].join('\n');
}

// ---- CLI ------------------------------------------------------------------

if (process.argv[1] && process.argv[1].endsWith('bridge-reconciliation.mjs')) {
  const cfg = loadConfig();
  reconcile(cfg).then((report) => {
    process.stdout.write(summarize(report) + '\n');
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    // Exit non-zero on an alarm so a systemd/cron wrapper can page. We do NOT pause here.
    process.exit(report.alarm ? 2 : 0);
  }).catch((e) => {
    process.stderr.write(`[reconcile] fatal: ${e.message}\n`);
    process.exit(1);
  });
}
