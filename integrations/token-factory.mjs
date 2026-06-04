// token-factory.mjs — AUTOMATED TOKEN-MINTING tooling that builds AROUND the PRANA chain
// (the ecosystem's EVM/Ethereum-clone, Proof-of-Work) WITHOUT touching any chain code and WITHOUT
// launching anything. This is off-chain INTENT-ONLY tooling in the Bot repo: it models a token,
// produces a deploy INTENT, and runs an automated-mint POLICY engine. It points at PRANA when a node
// exists; for now it is dry-run/intent only.
//
// HARD SAFETY RULES (mirrors src/chain/evm-aa-grants.mjs + integrations/angelicalist/dry-run.mjs):
//   • ZERO-WIF. This file NEVER reads, holds, logs, constructs, or asks for a private key. It builds
//     plain INTENT objects + policy decisions. An actual signer would be INJECTED later (the `sign`
//     dep on mintIntent); even then we only CALL the injected signer — we never make a key.
//   • NEVER broadcasts. mintIntent defaults to { dryRun:true, broadcast:null }. deployIntent never
//     touches the network — it only records whether PRANA_RPC_URL is configured (dormant-aware).
//   • Dormant-aware. The PRANA chain id / rpc come from env NAME only (PRANA_CHAIN_ID / PRANA_RPC_URL),
//     resolved per-call so an offline test or a post-launch env-set lights it up with no code change.
//     Unset → rpcConfigured:false, a placeholder chain id, and everything still works on paper.
//   • Pure deterministic math for the schedule (pass nowTs IN — never calls Date.now()).
//   • Soft-fail policy paths return a structured decision; the constructive builders throw a typed
//     error on bad input (like createSessionKey / defineToken-style validation).
//
//   node integrations/token-factory.mjs                       # demo: define → deploy intent → schedule
//   import { defineToken, deployIntent, makeMintSchedule, nextMint, mintIntent } from './token-factory.mjs'
//
// Test (offline, no network): node --test integrations/token-factory.test.mjs

// Reuse the dormant PRANA env wiring + CAIP addressing already in the repo — single source of truth
// for the chain id / rpc / eip155 address form. No new chain knowledge is introduced here.
import { pranaChainId, pranaRpc, PRANA_RPC_ENV } from './chains/multichain.mjs';
import { forPrana } from '../src/chain/caip.mjs';

// ---- error type ------------------------------------------------------------

export class TokenSpecError extends Error {
  constructor(message) {
    super(message);
    this.name = 'TokenSpecError';
  }
}

// ---- helpers ---------------------------------------------------------------

// ERC-20-ish symbol: 2–11 upper/lower alphanumerics (no spaces, no leading digit-only quirks beyond
// what ABI allows). We keep it conservative so a bad symbol is rejected early, on paper.
const SYMBOL_RE = /^[A-Za-z][A-Za-z0-9]{1,10}$/;
const NAME_RE = /^[\x20-\x7E]{1,64}$/; // printable ASCII name, 1–64 chars

function isFiniteNonNegative(v) {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0;
}
function isPositiveInt(v) {
  return typeof v === 'number' && Number.isInteger(v) && v > 0;
}
// Supply is allowed to be a number OR a decimal string (token supplies can exceed 2^53). We validate
// the string shape and compare via BigInt so we never silently lose precision on caps.
function toBigSupply(v, label) {
  if (typeof v === 'number') {
    if (!Number.isFinite(v) || v < 0 || !Number.isInteger(v)) {
      throw new TokenSpecError(`${label} must be a non-negative integer (got ${v})`);
    }
    return BigInt(v);
  }
  if (typeof v === 'string' && /^\d+$/.test(v)) {
    return BigInt(v);
  }
  throw new TokenSpecError(`${label} must be a non-negative integer or a decimal-digit string (got ${typeof v})`);
}

// ---- 1. token spec model ---------------------------------------------------

/**
 * defineToken — validate + freeze an immutable token specification. PURE, no I/O, no keys.
 * Rejects bad symbols/decimals/negative supply, and (when a cap is set) cap < initialSupply.
 *
 * @param {object} args
 * @param {string} args.name           human-readable name (printable ASCII, 1–64)
 * @param {string} args.symbol         ticker, 2–11 alnum starting with a letter
 * @param {number} [args.decimals=18]  0–36 integer
 * @param {number|string} args.initialSupply  non-negative integer (base units), number or digit-string
 * @param {boolean} [args.mintable=false]  whether more can be minted after deploy
 * @param {number|string|null} [args.cap=null]  hard max supply (>= initialSupply); null = uncapped
 * @param {string|null} [args.owner=null]  0x… owner address (validated as a string only; no crypto)
 * @returns {Readonly<object>} frozen spec { kind:'token-spec', name, symbol, decimals, initialSupply, mintable, cap, owner }
 */
export function defineToken({
  name,
  symbol,
  decimals = 18,
  initialSupply,
  mintable = false,
  cap = null,
  owner = null,
} = {}) {
  if (typeof name !== 'string' || !NAME_RE.test(name)) {
    throw new TokenSpecError('defineToken: name must be printable ASCII, 1–64 chars');
  }
  if (typeof symbol !== 'string' || !SYMBOL_RE.test(symbol)) {
    throw new TokenSpecError(`defineToken: symbol must be 2–11 alphanumerics starting with a letter (got "${symbol}")`);
  }
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) {
    throw new TokenSpecError(`defineToken: decimals must be an integer 0–36 (got ${decimals})`);
  }
  if (initialSupply === undefined || initialSupply === null) {
    throw new TokenSpecError('defineToken: initialSupply is required');
  }
  const initial = toBigSupply(initialSupply, 'defineToken: initialSupply');
  if (typeof mintable !== 'boolean') {
    throw new TokenSpecError('defineToken: mintable must be a boolean');
  }

  let capBig = null;
  if (cap !== null && cap !== undefined) {
    capBig = toBigSupply(cap, 'defineToken: cap');
    if (capBig < initial) {
      throw new TokenSpecError(`defineToken: cap (${capBig}) must be >= initialSupply (${initial})`);
    }
    if (!mintable) {
      // A cap on a fixed-supply token is meaningless; reject so the spec stays coherent.
      throw new TokenSpecError('defineToken: cap is only meaningful when mintable:true');
    }
  }

  if (owner !== null && owner !== undefined) {
    if (typeof owner !== 'string' || owner.length === 0) {
      throw new TokenSpecError('defineToken: owner, if given, must be a non-empty address string');
    }
  }

  return Object.freeze({
    kind: 'token-spec',
    name,
    symbol,
    decimals,
    // keep supplies as strings on the frozen spec so the object is JSON-safe and lossless
    initialSupply: initial.toString(),
    mintable,
    cap: capBig === null ? null : capBig.toString(),
    owner: owner == null ? null : owner,
  });
}

function assertSpec(spec, who) {
  if (!spec || spec.kind !== 'token-spec') {
    throw new TokenSpecError(`${who}: expected a token spec from defineToken`);
  }
}

// ---- 2. deploy INTENT ------------------------------------------------------

/**
 * deployIntent — produce a structured DEPLOY INTENT. NEVER broadcasts, NEVER touches the network.
 * The chain id comes from env PRANA_CHAIN_ID (placeholder until genesis is fixed); `rpcConfigured`
 * reflects whether PRANA_RPC_URL is set, so the intent is dormant-aware: it can be built on a clean
 * checkout and only becomes "executable elsewhere" once a node + signer exist.
 *
 * @param {object} spec  a frozen spec from defineToken
 * @param {object} [opts]
 * @param {string} [opts.chain='prana']  logical chain label (only 'prana' is wired here)
 * @param {string} [opts.deployer]       optional 0x… deployer/owner address for the CAIP account id
 * @returns {object} { action:'deploy', chain, chainId, deployer?, spec, rpcConfigured, dryRun:true, broadcast:null }
 */
export function deployIntent(spec, { chain = 'prana', deployer } = {}) {
  assertSpec(spec, 'deployIntent');
  if (chain !== 'prana') {
    throw new TokenSpecError(`deployIntent: only 'prana' is supported (got "${chain}")`);
  }
  const chainId = pranaChainId(); // env PRANA_CHAIN_ID or placeholder — resolved per-call
  const rpcConfigured = pranaRpc().length > 0; // env PRANA_RPC_URL set? (dormant-aware)
  const intent = {
    action: 'deploy',
    chain,
    chainId,
    spec,
    rpcConfigured,
    // dormant note so a reader of the intent knows why nothing happened on a clean checkout
    note: rpcConfigured
      ? `PRANA_RPC_URL is set — a node + injected signer (elsewhere) could realize this intent`
      : `PRANA dormant: set env ${PRANA_RPC_ENV} when the node is live; this is intent-only`,
    dryRun: true,
    broadcast: null, // ALWAYS null — deployIntent never broadcasts
  };
  if (deployer !== undefined && deployer !== null) {
    // CAIP-10 account id for the deployer on PRANA (eip155:<chainId>:<addr>) — pure addressing, no key.
    intent.deployer = deployer;
    intent.deployerCaip = forPrana(deployer, { chainId });
  }
  return Object.freeze(intent);
}

// ---- 3. automated mint POLICY engine ---------------------------------------

/**
 * makeMintSchedule — build + freeze an immutable automated-mint schedule descriptor. PURE.
 * No timers, no side effects — it just bundles the policy parameters that nextMint() evaluates.
 *
 * @param {object} args
 * @param {object} args.token              a frozen spec from defineToken (must be mintable)
 * @param {number|string} args.perPeriodAmount  base units minted each period (> 0)
 * @param {number} args.periodSeconds      minimum seconds between mints (> 0 integer)
 * @param {number|string|null} [args.cap]  hard max total supply; defaults to the token's own cap
 * @param {number} [args.startTs=0]        unix seconds before which no mint occurs
 * @returns {Readonly<object>} frozen schedule
 */
export function makeMintSchedule({ token, perPeriodAmount, periodSeconds, cap, startTs = 0 } = {}) {
  assertSpec(token, 'makeMintSchedule');
  if (token.mintable !== true) {
    throw new TokenSpecError('makeMintSchedule: token is not mintable — cannot schedule mints');
  }
  const per = toBigSupply(perPeriodAmount, 'makeMintSchedule: perPeriodAmount');
  if (per <= 0n) {
    throw new TokenSpecError('makeMintSchedule: perPeriodAmount must be > 0');
  }
  if (!isPositiveInt(periodSeconds)) {
    throw new TokenSpecError('makeMintSchedule: periodSeconds must be a positive integer');
  }
  if (!isFiniteNonNegative(startTs) || !Number.isInteger(startTs)) {
    throw new TokenSpecError('makeMintSchedule: startTs must be a non-negative integer (unix seconds)');
  }

  // Resolve the effective cap: explicit arg wins, else the token's own cap, else null (uncapped).
  let effCap = null;
  if (cap !== undefined && cap !== null) {
    effCap = toBigSupply(cap, 'makeMintSchedule: cap');
  } else if (token.cap !== null) {
    effCap = BigInt(token.cap);
  }
  if (effCap !== null) {
    const initial = BigInt(token.initialSupply);
    if (effCap < initial) {
      throw new TokenSpecError(`makeMintSchedule: cap (${effCap}) must be >= token initialSupply (${initial})`);
    }
  }

  return Object.freeze({
    kind: 'mint-schedule',
    symbol: token.symbol,
    perPeriodAmount: per.toString(),
    periodSeconds,
    startTs,
    cap: effCap === null ? null : effCap.toString(),
    initialSupply: token.initialSupply,
  });
}

/**
 * nextMint — PURE DETERMINISTIC decision: should an automated mint fire at `nowTs`, and for how much?
 * Respects (a) the period gate (no mint before startTs, and no mint until periodSeconds have elapsed
 * since the last mint) and (b) the cap (never exceed it; stop entirely when reached, and trim the
 * final mint to land exactly on the cap). Pass `nowTs` and `mintedSoFar` IN — this never reads a clock.
 *
 * @param {object} schedule              from makeMintSchedule
 * @param {number} nowTs                 current unix seconds (caller supplies the clock)
 * @param {object|number} [state]        { mintedSoFar, lastMintTs } — or a bare number = mintedSoFar
 *   - mintedSoFar : base units minted by this schedule so far (NOT counting initialSupply), default 0
 *   - lastMintTs  : unix seconds of the last mint (default = startTs, so first mint may fire at startTs)
 * @returns {{ shouldMint:boolean, amount:string, reason:string }}
 */
export function nextMint(schedule, nowTs, state = 0) {
  if (!schedule || schedule.kind !== 'mint-schedule') {
    return { shouldMint: false, amount: '0', reason: 'invalid-schedule' };
  }
  if (typeof nowTs !== 'number' || !Number.isFinite(nowTs)) {
    return { shouldMint: false, amount: '0', reason: 'invalid-nowTs' };
  }

  const { mintedSoFar = 0, lastMintTs } = typeof state === 'object' && state !== null ? state : { mintedSoFar: state };

  let minted;
  try {
    minted = toBigSupply(mintedSoFar, 'nextMint: mintedSoFar');
  } catch {
    return { shouldMint: false, amount: '0', reason: 'invalid-mintedSoFar' };
  }
  const per = BigInt(schedule.perPeriodAmount);
  const cap = schedule.cap === null ? null : BigInt(schedule.cap);
  const initial = BigInt(schedule.initialSupply);

  // 1. start gate
  if (nowTs < schedule.startTs) {
    return { shouldMint: false, amount: '0', reason: 'before-start' };
  }

  // 2. period gate — the first mint is allowed at/after startTs; subsequent mints need a full period.
  const since = typeof lastMintTs === 'number' ? lastMintTs : schedule.startTs;
  // If we've never minted (mintedSoFar==0 and no explicit lastMintTs), the start gate above is enough.
  const everMinted = minted > 0n || typeof lastMintTs === 'number';
  if (everMinted && nowTs - since < schedule.periodSeconds) {
    return { shouldMint: false, amount: '0', reason: 'period-not-elapsed' };
  }

  // 3. cap gate — total = initialSupply + everything minted by this schedule.
  if (cap !== null) {
    const total = initial + minted;
    if (total >= cap) {
      return { shouldMint: false, amount: '0', reason: 'cap-reached' };
    }
    const room = cap - total;
    if (room < per) {
      // trim the final mint so total lands exactly on the cap, never over.
      return { shouldMint: true, amount: room.toString(), reason: 'final-partial-mint-to-cap' };
    }
  }

  return { shouldMint: true, amount: per.toString(), reason: 'period-elapsed' };
}

// ---- 4. mint INTENT (+ 5. guardrails) --------------------------------------

// A no-op spy signer pattern (mirrors makeSpyBroadcaster in angelicalist/dry-run.mjs) so tests can
// prove the injected signer is NEVER called in dry-run, and IS the only thing called when provided.
export function makeSpySigner() {
  const calls = [];
  const fn = async (...args) => { calls.push(args); return { simulated: true, blocked: 'token-factory: real signer lives elsewhere' }; };
  fn.calls = calls;
  return fn;
}

/**
 * mintIntent — build a MINT INTENT for `amount` to `recipient`. DRY-RUN by default: returns
 * { dryRun:true, broadcast:null } and performs no broadcast. ONLY if an injected `sign` function is
 * provided is it called (and even then we ONLY call the injected signer — we never construct a key).
 *
 * GUARDRAILS (5):
 *   • token.mintable === false  → HARD REJECT (status:'rejected', reason:'not-mintable')
 *   • amount that would push initialSupply + alreadyMinted + amount OVER token.cap → HARD REJECT
 *   • amount must be a positive integer/digit-string; recipient must be a non-empty string
 *
 * @param {object} token      a frozen spec from defineToken
 * @param {number|string} amount   base units to mint (> 0)
 * @param {string} recipient  0x… recipient address (string-validated only; no crypto)
 * @param {object} [opts]
 * @param {function} [opts.sign]      INJECTED signer; if absent → dry-run, no broadcast
 * @param {number|string} [opts.mintedSoFar=0]  base units already minted (for the cap guardrail)
 * @returns {Promise<object>} a mint intent / decision (never throws on policy — returns a status)
 */
export async function mintIntent(token, amount, recipient, { sign, mintedSoFar = 0 } = {}) {
  // shape checks first (these are programmer errors → typed throw, like the other builders)
  assertSpec(token, 'mintIntent');
  if (typeof recipient !== 'string' || recipient.length === 0) {
    throw new TokenSpecError('mintIntent: recipient must be a non-empty address string');
  }
  let amt;
  try {
    amt = toBigSupply(amount, 'mintIntent: amount');
  } catch (e) {
    throw new TokenSpecError(e.message);
  }
  if (amt <= 0n) {
    throw new TokenSpecError('mintIntent: amount must be > 0');
  }

  const base = {
    action: 'mint',
    symbol: token.symbol,
    amount: amt.toString(),
    recipient,
  };

  // GUARDRAIL 5a: non-mintable tokens can never mint. Soft-reject (a policy outcome, not a crash).
  if (token.mintable !== true) {
    return Object.freeze({ ...base, status: 'rejected', reason: 'not-mintable', dryRun: true, broadcast: null });
  }

  // GUARDRAIL 5b: never exceed the cap.
  if (token.cap !== null) {
    let already;
    try {
      already = toBigSupply(mintedSoFar, 'mintIntent: mintedSoFar');
    } catch {
      return Object.freeze({ ...base, status: 'rejected', reason: 'invalid-mintedSoFar', dryRun: true, broadcast: null });
    }
    const total = BigInt(token.initialSupply) + already + amt;
    if (total > BigInt(token.cap)) {
      return Object.freeze({
        ...base,
        status: 'rejected',
        reason: 'cap-exceeded',
        detail: `mint would bring total to ${total}, over cap ${token.cap}`,
        dryRun: true,
        broadcast: null,
      });
    }
  }

  // Default path: DRY-RUN, no broadcast, no signer touched.
  if (typeof sign !== 'function') {
    return Object.freeze({ ...base, status: 'ok', dryRun: true, broadcast: null });
  }

  // A signer was injected. We ONLY call it — we never build or read a key. The injected function is
  // the sole key boundary (it lives in MELEK-Signer / elsewhere). We hand it the intent, not a key.
  const broadcast = await sign({ ...base });
  return Object.freeze({ ...base, status: 'signed', dryRun: false, broadcast });
}

// ---- CLI (guarded) ---------------------------------------------------------

function runCli() {
  const spec = defineToken({
    name: 'Prana Demo Token',
    symbol: 'PRDEMO',
    decimals: 18,
    initialSupply: '1000000000000000000000', // 1000 tokens @ 18 decimals
    mintable: true,
    cap: '2000000000000000000000', // 2000 tokens
    owner: '0x0000000000000000000000000000000000000000',
  });
  const intent = deployIntent(spec, { deployer: '0x0000000000000000000000000000000000000000' });
  const schedule = makeMintSchedule({
    token: spec,
    perPeriodAmount: '400000000000000000000', // 400 tokens / period
    periodSeconds: 86400,
    startTs: 0,
  });

  const lines = [];
  lines.push('token-factory — INTENT-ONLY token-minting tooling around PRANA (no keys, no broadcast).');
  lines.push('');
  lines.push('1) defineToken →');
  lines.push('   ' + JSON.stringify(spec));
  lines.push('');
  lines.push(`2) deployIntent → action=${intent.action} chain=${intent.chain} chainId=${intent.chainId} rpcConfigured=${intent.rpcConfigured}`);
  lines.push('   ' + intent.note);
  lines.push('   broadcast: ' + JSON.stringify(intent.broadcast) + '   (always null)');
  lines.push('');
  lines.push('3) automated-mint schedule (deterministic, cap-aware) — first three periods:');
  let minted = 0n;
  let last = null;
  for (let i = 0; i < 4; i++) {
    const now = i * 86400;
    const d = nextMint(schedule, now, { mintedSoFar: minted.toString(), lastMintTs: last });
    lines.push(`   t=${now}s  shouldMint=${d.shouldMint}  amount=${d.amount}  (${d.reason})`);
    if (d.shouldMint) { minted += BigInt(d.amount); last = now; }
  }
  lines.push('');
  lines.push('4) mintIntent (default dry-run, no signer) →');
  lines.push('   pending… (async)');
  console.log(lines.join('\n'));

  mintIntent(spec, '100000000000000000000', '0x0000000000000000000000000000000000000000').then((m) => {
    console.log('   ' + JSON.stringify(m));
    console.log('\nzero-WIF: no private key is read, held, or constructed; broadcast is null in every dry-run path.');
  });
}

if (process.argv[1] && process.argv[1].endsWith('token-factory.mjs')) {
  runCli();
}
