/**
 * op-builder.mjs — pure, testable builders for the token-tools surface.
 *
 * This is the single source of truth for the SHAPE of every token operation the
 * token-tools page lets a user assemble. It only BUILDS + VALIDATES the op; it
 * NEVER signs and NEVER broadcasts. Broadcast is done elsewhere:
 *   - engine side-token ops  → signed CLIENT-SIDE in the browser (dhive) or by
 *     the host signer; the engine node only watches L1 and never holds a key.
 *   - native SMT ops         → signed off-repo by the operator / MELEK-Signer.
 * No WIF / seed / active key is ever read, logged, or returned here. (BRIEF.md
 * §7; "Zero WIF in Bot repo".)
 *
 * Two op families:
 *   (b) MELEK-Engine side-tokens — a Graphene `custom_json` op whose `json` is
 *       the engine contract envelope { contractName, contractAction,
 *       contractPayload }. id = the engine sidechain id.
 *   (a) Native SMT — the STANDARD Steem-fork ops `smt_create` / `smt_setup`.
 *       We build the operation payload only; the NAI is drawn from the live NAI
 *       pool (read by integrations/smt-info.mjs). No custom chain op is added.
 *
 * Every builder returns one of:
 *   { ok: true,  op, kind, action, summary, ... }
 *   { ok: false, error }
 * Builders NEVER throw for user error (soft-fail); they throw only on a caller
 * bug (passing a non-object). esc() is the page's job, not the builder's.
 */

import {
  isValidPrecision,
  toBaseUnits,
  maxSupplyBaseUnits,
  MAX_PRECISION,
} from './decimal.mjs';
import { config, genesis } from '../config.mjs';

const SYMBOL_RE = /^[A-Z]{1,10}$/;
// A Graphene account name: 3..16 chars, dotted segments of [a-z][a-z0-9-]*.
const ACCOUNT_RE = /^[a-z][a-z0-9-]{2,15}(\.[a-z][a-z0-9-]+)*$/;
// A NAI string as the chain emits it, e.g. "@@422838704".
const NAI_RE = /^@@\d{9,12}$/;

function err(error) {
  return { ok: false, error };
}

/** Validate a Graphene account name (soft). */
export function isValidAccount(a) {
  return typeof a === 'string' && a.length >= 3 && a.length <= 32 && ACCOUNT_RE.test(a);
}

/** Validate an engine token symbol (1-10 uppercase A-Z). */
export function isValidSymbol(s) {
  return typeof s === 'string' && SYMBOL_RE.test(s);
}

/** Validate a chain NAI string ("@@…"). */
export function isValidNai(n) {
  return typeof n === 'string' && NAI_RE.test(n);
}

/** The engine sidechain id every engine custom_json carries. */
export function sidechainId() {
  return config.sidechainId;
}

/**
 * Wrap an engine contract envelope into a Graphene custom_json operation.
 * @param {string} account  the signer (required_auths) — the L1 username
 * @param {object} envelope { contractName, contractAction, contractPayload }
 * @returns {['custom_json', object]}
 */
function customJsonOp(account, envelope) {
  return [
    'custom_json',
    {
      required_auths: [account],
      required_posting_auths: [],
      id: config.sidechainId,
      json: JSON.stringify(envelope),
    },
  ];
}

/**
 * Wrap an envelope as a POSTING-auth custom_json. Used for the actions the engine's auth split
 * lets posting authority run (`workerbee.claim`, `workerbee.tick`). Signing these with posting
 * rather than active is the point: a daemon that only ever claims and cranks never needs a key
 * that can move funds.
 * @param {string} account  the signer (required_posting_auths)
 * @param {object} envelope { contractName, contractAction, contractPayload }
 * @returns {['custom_json', object]}
 */
function customJsonPostingOp(account, envelope) {
  return [
    'custom_json',
    {
      required_auths: [],
      required_posting_auths: [account],
      id: config.sidechainId,
      json: JSON.stringify(envelope),
    },
  ];
}

/**
 * Quantity must be a positive decimal string. We don't know the token's
 * precision here (the contract enforces it on execution), so we only check the
 * surface form: digits with at most one dot, > 0, <= 8 decimal places.
 * @returns {string|null} an error message, or null when valid.
 */
function validateQuantity(q) {
  const s = String(q == null ? '' : q).trim();
  if (!/^\d+(\.\d+)?$/.test(s)) return `malformed quantity "${q}"`;
  const frac = s.split('.')[1] || '';
  if (frac.length > MAX_PRECISION) return `quantity "${q}" exceeds max precision ${MAX_PRECISION}`;
  if (Number(s) <= 0) return 'quantity must be > 0';
  return null;
}

/**
 * buildEngineOp — build + validate one engine side-token op.
 * @param {string} action  'create' | 'issue' | 'transfer' | 'stake' | 'unstake'
 * @param {object} p       action params (see below)
 * @param {string} account the signing L1 account (required_auths)
 * @returns {{ok:true, kind, action, op, envelope, summary}|{ok:false,error}}
 *
 * params:
 *   create:   { symbol, name?, precision, maxSupply, url?, supplyCapImmutable? }
 *   issue:    { symbol, to, quantity }
 *   transfer: { symbol, to, quantity }
 *   stake:    { symbol, quantity }
 *   unstake:  { symbol, quantity }
 */
export function buildEngineOp(action, p, account) {
  if (typeof p !== 'object' || p === null) throw new TypeError('params must be an object');
  if (!isValidAccount(account)) return err(`invalid account "${account}"`);

  const symbol = String(p.symbol || '').toUpperCase();
  if (!isValidSymbol(symbol)) return err(`invalid symbol "${p.symbol}" (1-10 uppercase A-Z)`);

  let payload;
  let summary;

  switch (action) {
    case 'create': {
      const precision = Number(p.precision);
      if (!isValidPrecision(precision)) {
        return err(`precision must be an integer 0..${MAX_PRECISION}`);
      }
      let base;
      try {
        base = toBaseUnits(String(p.maxSupply), precision);
      } catch (e) {
        return err(`bad maxSupply: ${e.message}`);
      }
      if (base <= 0n) return err('maxSupply must be > 0');
      if (base > maxSupplyBaseUnits(precision)) {
        return err('maxSupply exceeds the Number.MAX_SAFE_INTEGER ceiling');
      }
      payload = {
        symbol,
        name: String(p.name || symbol).slice(0, 50),
        precision,
        maxSupply: String(p.maxSupply),
      };
      if (typeof p.url === 'string' && p.url) payload.url = p.url.slice(0, 255);
      if (p.supplyCapImmutable === true) payload.supplyCapImmutable = true;
      summary =
        `create ${symbol} (precision ${precision}, max ${p.maxSupply}` +
        `${payload.supplyCapImmutable ? ', immutable cap' : ''}) — burns ` +
        `${config.tokenCreationFee} ${genesis.feeToken}`;
      break;
    }
    case 'issue':
    case 'transfer': {
      const to = String(p.to || '');
      if (!isValidAccount(to)) return err(`invalid recipient "${p.to}"`);
      if (action === 'transfer' && to === account) return err('cannot transfer to self');
      const qErr = validateQuantity(p.quantity);
      if (qErr) return err(qErr);
      payload = { symbol, to, quantity: String(p.quantity) };
      summary = `${action} ${p.quantity} ${symbol} to @${to}`;
      break;
    }
    case 'stake':
    case 'unstake': {
      const qErr = validateQuantity(p.quantity);
      if (qErr) return err(qErr);
      payload = { symbol, quantity: String(p.quantity) };
      summary = `${action} ${p.quantity} ${symbol}`;
      break;
    }
    default:
      return err(`unknown engine action "${action}"`);
  }

  const envelope = { contractName: 'tokens', contractAction: action, contractPayload: payload };
  return {
    ok: true,
    kind: 'engine',
    action,
    op: customJsonOp(account, envelope),
    envelope,
    summary,
  };
}

/**
 * buildForeverLockOp — build the workerbee.foreverLock op: PERMANENTLY lock `amount` of the stake token
 * (wMELEK) to mint soulbound APIS-Hash. There is NO unstake — this is the only way to earn APIS-Hash, the
 * KULA DeFi permanent-staking mint. Builds + validates only; the user signs in their own wallet.
 * @param {string} account the signing L1 account (required_auths)
 * @param {object} p { amount }  whole-token amount of the stake token to forever-lock
 */
export function buildForeverLockOp(account, p) {
  if (typeof p !== 'object' || p === null) throw new TypeError('params must be an object');
  if (!isValidAccount(account)) return err(`invalid account "${account}"`);
  const qErr = validateQuantity(p.amount);
  if (qErr) return err(qErr);
  const stake = (config.workerbee && config.workerbee.stakeToken) || 'WMELEK';
  const envelope = { contractName: 'workerbee', contractAction: 'foreverLock', contractPayload: { amount: String(p.amount) } };
  return {
    ok: true, kind: 'engine', action: 'foreverLock', op: customJsonOp(account, envelope), envelope,
    summary: `PERMANENTLY lock ${p.amount} ${stake} → APIS-Hash (soulbound, no unstake)`,
  };
}

/**
 * buildWorkerbeeClaimOp — harvest the sender's OWN accrued APIS.
 *
 * The WorkerBee pool is a MasterChef-style accumulator: `advance()` accrues `accRewardPerShare`
 * every block, but APIS is only minted when a holder claims. So an account with APIS-Hash earns
 * continuously and shows a rising `pending` while its APIS balance stays 0 — the emission is real
 * and owed, it simply has not been drawn yet. This op draws it.
 *
 * POSTING auth: claim can only mint the sender's own already-accrued APIS, so it never needs a key
 * that can move funds.
 *
 * @param {string} account the claiming L1 account
 */
export function buildWorkerbeeClaimOp(account) {
  if (!isValidAccount(account)) return err(`invalid account "${account}"`);
  const envelope = { contractName: 'workerbee', contractAction: 'claim', contractPayload: {} };
  return {
    ok: true, kind: 'engine', action: 'claim', authLevel: 'posting',
    op: customJsonPostingOp(account, envelope), envelope,
    summary: `claim accrued ${genesis.feeToken} for @${account}`,
  };
}

/**
 * buildWorkerbeeTickOp — turn the emission crank. Idempotent and caller-independent: the emission
 * for a block range is fixed, so who turns it cannot change the result. Anyone may call it.
 * @param {string} account the L1 account turning the crank
 */
export function buildWorkerbeeTickOp(account) {
  if (!isValidAccount(account)) return err(`invalid account "${account}"`);
  const envelope = { contractName: 'workerbee', contractAction: 'tick', contractPayload: {} };
  return {
    ok: true, kind: 'engine', action: 'tick', authLevel: 'posting',
    op: customJsonPostingOp(account, envelope), envelope,
    summary: `advance the ${genesis.feeToken} emission crank`,
  };
}

/**
 * buildSmtCreateOp — build the STANDARD Steem-fork `smt_create` operation.
 * Native SMTs are the chain-level token primitive; creation is a standard op
 * (not a custom op), signed OFF-REPO. We only assemble the payload + draw a NAI
 * from the live pool.
 *
 * @param {object} p { controlAccount, precision, nai, smtCreationFee?, extensions? }
 *   - controlAccount: the SMT's control account (signs subsequent setup/issue)
 *   - precision:      0..8 token decimals
 *   - nai:            a "@@…" asset-id taken from the live NAI pool (smt-info.mjs)
 *   - smtCreationFee: optional asset string e.g. "1000.000 TESTS" (chain fee)
 * @returns {{ok:true, kind:'smt', action:'smt_create', op, summary}|{ok:false,error}}
 */
export function buildSmtCreateOp(p) {
  if (typeof p !== 'object' || p === null) throw new TypeError('params must be an object');
  const controlAccount = String(p.controlAccount || '');
  if (!isValidAccount(controlAccount)) return err(`invalid controlAccount "${p.controlAccount}"`);

  const precision = Number(p.precision);
  if (!isValidPrecision(precision)) return err(`precision must be an integer 0..${MAX_PRECISION}`);

  const nai = String(p.nai || '');
  if (!NAI_RE.test(nai)) {
    return err(`invalid NAI "${p.nai}" — draw one from the live NAI pool (smt-info.mjs)`);
  }

  // The symbol object the chain expects: { nai, decimals }.
  const symbol = { nai, decimals: precision };

  // smt_creation_fee is an asset; default to a placeholder the host fills from
  // chain config (witness-set fee). We never invent a real fee amount.
  const op = [
    'smt_create',
    {
      control_account: controlAccount,
      symbol,
      smt_creation_fee:
        typeof p.smtCreationFee === 'string' && p.smtCreationFee
          ? p.smtCreationFee
          : '0.000 TESTS', // host overrides with the live chain fee
      precision,
      extensions: Array.isArray(p.extensions) ? p.extensions : [],
    },
  ];

  return {
    ok: true,
    kind: 'smt',
    action: 'smt_create',
    op,
    summary: `smt_create ${nai} (precision ${precision}, control @${controlAccount}) — signed off-repo`,
  };
}

/**
 * buildSmtSetupOp — build the STANDARD `smt_setup` operation that finalises an
 * SMT's supply/genesis parameters after smt_create. Payload only; signed
 * off-repo by the control account.
 *
 * @param {object} p { controlAccount, nai, maxSupply, precision?, extensions? }
 * @returns {{ok:true, kind:'smt', action:'smt_setup', op, summary}|{ok:false,error}}
 */
export function buildSmtSetupOp(p) {
  if (typeof p !== 'object' || p === null) throw new TypeError('params must be an object');
  const controlAccount = String(p.controlAccount || '');
  if (!isValidAccount(controlAccount)) return err(`invalid controlAccount "${p.controlAccount}"`);

  const nai = String(p.nai || '');
  if (!NAI_RE.test(nai)) return err(`invalid NAI "${p.nai}"`);

  const precision = p.precision == null ? null : Number(p.precision);
  if (precision != null && !isValidPrecision(precision)) {
    return err(`precision must be an integer 0..${MAX_PRECISION}`);
  }

  // max_supply on the chain is an integer count of base units. We validate it's
  // a positive integer string; the host applies precision when broadcasting.
  const maxSupply = String(p.maxSupply == null ? '' : p.maxSupply).trim();
  if (!/^\d+$/.test(maxSupply) || BigInt(maxSupply) <= 0n) {
    return err(`maxSupply must be a positive integer (base units) — got "${p.maxSupply}"`);
  }

  const op = [
    'smt_setup',
    {
      control_account: controlAccount,
      symbol: precision != null ? { nai, decimals: precision } : { nai },
      max_supply: maxSupply,
      extensions: Array.isArray(p.extensions) ? p.extensions : [],
    },
  ];

  return {
    ok: true,
    kind: 'smt',
    action: 'smt_setup',
    op,
    summary: `smt_setup ${nai} (max_supply ${maxSupply} base units) — signed off-repo`,
  };
}

// ---------------------------------------------------------------------------
// Token-MANAGEMENT builders (burn / SCOT-rewards / bridge-out) — ADDITIONS.
//
// Same posture as every builder above: BUILD + VALIDATE only. They NEVER sign,
// NEVER broadcast, and NO WIF / seed / active key is ever read, accepted,
// logged, or returned. Each returns a client-signable Graphene `custom_json`
// op whose `required_auths` is the issuer's own account (ACTIVE auth) — the
// condenser or MELEK-Signer signs it; the caller of these functions holds no
// key. (BRIEF.md §7; "Zero WIF in Bot repo".)
//
// COMPLIANCE — load-bearing, [[token-securities-compliance-posture]]:
//   A burn or a buyback assembled here is a TOKEN-MANAGEMENT / DEFLATION
//   mechanic — the issuer spends its own supply/revenue to reduce circulating
//   supply or deepen liquidity. It is NOT price support, NOT a promise about
//   token value, and NOT a claim of future appreciation. No summary these
//   emit may imply that. Educational/utility framing only.
// ---------------------------------------------------------------------------

// A PRANA / EVM recipient address: 0x followed by exactly 40 hex chars.
const PRANA_ADDR_RE = /^0x[0-9a-fA-F]{40}$/;
// SCOT reward curves — mirrors contracts/scot.mjs + rewards.mjs.
const SCOT_CURVES = new Set(['linear', 'quadratic', 'sqrt']);

/** Validate a 0x…40hex PRANA/EVM recipient address (soft). */
export function isValidPranaAddress(a) {
  return typeof a === 'string' && PRANA_ADDR_RE.test(a);
}

/**
 * burnOp — build the tokens.burn op: DESTROY `quantity` of `symbol` the signer
 * holds, reducing circulating supply. This is the on-engine deflation lever and
 * the honest, real-today core of a buyback (buy the token off-book, then burn
 * it). It is a supply mechanic — never a price-floor or appreciation promise.
 * @param {string} account the signing L1 account (required_auths / active auth)
 * @param {object} p { symbol, quantity }
 */
export function burnOp(account, p) {
  if (typeof p !== 'object' || p === null) throw new TypeError('params must be an object');
  if (!isValidAccount(account)) return err(`invalid account "${account}"`);
  const symbol = String(p.symbol || '').toUpperCase();
  if (!isValidSymbol(symbol)) return err(`invalid symbol "${p.symbol}" (1-10 uppercase A-Z)`);
  const qErr = validateQuantity(p.quantity);
  if (qErr) return err(qErr);
  const envelope = {
    contractName: 'tokens',
    contractAction: 'burn',
    contractPayload: { symbol, quantity: String(p.quantity) },
  };
  return {
    ok: true,
    kind: 'engine',
    action: 'burn',
    op: customJsonOp(account, envelope),
    envelope,
    summary: `burn ${p.quantity} ${symbol} — reduces circulating supply (deflation; a token-management mechanic, not a claim about token value)`,
  };
}

/**
 * scotEnableOp — build the scot.enable op: add or re-tune a Scot Bot reward rule
 * on an EXISTING token (author/curator emission). Issuer-only on execution;
 * burns config.scotFee on FIRST enable. Default author split is 6500 bps (the
 * operator's honest-utility 65/35, [[token-philosophy-real-utility-not-
 * speculation]]) — not an APY, not a yield promise.
 * @param {string} account the signing L1 account (required_auths / active auth)
 * @param {object} p { symbol, config: { emissionPerWindow, windowBlocks, authorBps?, curve?, tag? } }
 */
export function scotEnableOp(account, p) {
  if (typeof p !== 'object' || p === null) throw new TypeError('params must be an object');
  if (!isValidAccount(account)) return err(`invalid account "${account}"`);
  const symbol = String(p.symbol || '').toUpperCase();
  if (!isValidSymbol(symbol)) return err(`invalid symbol "${p.symbol}" (1-10 uppercase A-Z)`);
  const cfg = (typeof p.config === 'object' && p.config) || {};
  const qErr = validateQuantity(cfg.emissionPerWindow);
  if (qErr) return err(`emissionPerWindow: ${qErr}`);
  const windowBlocks = Number(cfg.windowBlocks);
  if (!Number.isInteger(windowBlocks) || windowBlocks < 1) return err('windowBlocks must be a positive integer');
  const authorBps = cfg.authorBps === undefined ? 6500 : Number(cfg.authorBps);
  if (!Number.isInteger(authorBps) || authorBps < 0 || authorBps > 10000) {
    return err('authorBps must be an integer 0..10000');
  }
  const curve = cfg.curve === undefined ? 'linear' : String(cfg.curve);
  if (!SCOT_CURVES.has(curve)) return err(`curve must be one of ${[...SCOT_CURVES].join('/')}`);
  const payload = { symbol, emissionPerWindow: String(cfg.emissionPerWindow), windowBlocks, authorBps, curve };
  if (cfg.tag !== undefined && cfg.tag !== '') payload.tag = String(cfg.tag).slice(0, 64);
  const envelope = { contractName: 'scot', contractAction: 'enable', contractPayload: payload };
  return {
    ok: true,
    kind: 'engine',
    action: 'scot.enable',
    op: customJsonOp(account, envelope),
    envelope,
    summary:
      `enable/tune SCOT rewards on ${symbol} (emission ${cfg.emissionPerWindow} per ${windowBlocks} blocks, ` +
      `author ${authorBps / 100}% / curator ${(10000 - authorBps) / 100}%, ${curve} curve) — ` +
      `burns ${config.scotFee} ${genesis.feeToken} on first enable`,
  };
}

/**
 * bridgeOutOp — build the generic-token bridge-OUT op: a tokens.transfer to the
 * configured bridge custody account carrying the 0x PRANA recipient in the memo.
 * The off-chain engine-bridge-watcher reads it and mints w`SYMBOL` on PRANA
 * (§2.2 step 1). This is Route-B step 1 of a cross-chain buyback; it is GATED —
 * it errors until config.bridge.custody is set (PRANA + generic bridge live).
 * @param {string} account the signing L1 account (required_auths / active auth)
 * @param {object} p { symbol, quantity, toPrana }  toPrana = 0x…40hex
 */
export function bridgeOutOp(account, p) {
  if (typeof p !== 'object' || p === null) throw new TypeError('params must be an object');
  if (!isValidAccount(account)) return err(`invalid account "${account}"`);
  const symbol = String(p.symbol || '').toUpperCase();
  if (!isValidSymbol(symbol)) return err(`invalid symbol "${p.symbol}" (1-10 uppercase A-Z)`);
  const qErr = validateQuantity(p.quantity);
  if (qErr) return err(qErr);
  const toPrana = String(p.toPrana || '');
  if (!isValidPranaAddress(toPrana)) return err(`invalid PRANA recipient "${p.toPrana}" (expect 0x + 40 hex)`);
  const custody = (config.bridge && config.bridge.custody) || '';
  if (!custody) {
    return err('bridge custody not configured (config.bridge.custody) — bridging is gated until PRANA is live');
  }
  const envelope = {
    contractName: 'tokens',
    contractAction: 'transfer',
    contractPayload: { symbol, to: custody, quantity: String(p.quantity), memo: toPrana },
  };
  return {
    ok: true,
    kind: 'engine',
    action: 'bridgeOut',
    op: customJsonOp(account, envelope),
    envelope,
    summary: `bridge ${p.quantity} ${symbol} to PRANA (transfer to @${custody}, memo ${toPrana}) — the off-chain watcher mints w${symbol} on PRANA`,
  };
}
