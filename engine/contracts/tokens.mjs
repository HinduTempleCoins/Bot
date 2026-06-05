/**
 * tokens.mjs — the Melek-Engine tokens contract.
 *
 * Mirrors Hive-Engine's tokens contract (create / issue / transfer / stake /
 * unstake / delegate) with the security-study hardening applied:
 *
 *   - issuer auth comes ONLY from the L1 op's signer (never a self-declared
 *     "from" in the payload).                          [§6 A item 1]
 *   - issue is restricted to the token's issuer.        [§6 F item 14]
 *   - optional IMMUTABLE supply cap, enforced forever.  [§6 F item 14]
 *   - an append-only on-chain issuance log per token.   [§6 F item 14]
 *   - all balance math is BigInt base units, no floats. [§6 B item 6]
 *   - precision 0..8, can only be increased; symbol <=10 uppercase.
 *
 * IMPORTANT — VM isolation note (§6 B item 4 / §5): Hive-Engine's biggest
 * lesson was the vm2 -> isolated_vm migration, because HE executes ARBITRARY
 * USER-UPLOADED JS contracts. Melek-Engine ships ONLY these built-in,
 * first-party contracts and does NOT allow users to deploy contract code. With
 * no untrusted code path, the sandbox-escape class of bug is avoided by
 * construction. If/when user contracts are ever added, they MUST run in
 * isolated_vm — never vm2. See SECURITY.md in this directory.
 *
 * Every action returns { ok: true } or { ok: false, error } — engine logs both.
 * Mutations only happen on ok:true. Contracts never throw for user error; they
 * return ok:false. They throw only on internal invariant violations.
 */

import {
  toBaseUnits,
  fromBaseUnits,
  isValidPrecision,
  maxSupplyBaseUnits,
  MAX_PRECISION,
} from '../lib/decimal.mjs';
import { config, genesis } from '../config.mjs';

const SYMBOL_RE = /^[A-Z]{1,10}$/;

function err(error) {
  return { ok: false, error };
}
function ok(data = {}) {
  return { ok: true, ...data };
}

/** Look up a token row. */
function getToken(state, symbol) {
  return state.findOne('tokens', { symbol });
}

/** Look up (or implicitly zero) a balance row. */
function getBalance(state, account, symbol) {
  return state.findOne('balances', { account, symbol });
}

function setBalance(state, account, symbol, baseUnits) {
  let row = getBalance(state, account, symbol);
  if (!row) {
    row = { account, symbol, balance: '0', stake: '0', pendingUnstake: '0' };
    state.insert('balances', row);
  }
  row.balance = baseUnits.toString();
  return row;
}

function bal(row) {
  return row ? BigInt(row.balance) : 0n;
}

/**
 * The tokens contract action table. Each handler receives
 *   (state, ctx, payload)
 * where ctx = { sender, blockNum, blockId, txId, authLevel }.
 */
export const tokens = {
  /**
   * create — register a new token. Burns the creation fee in the fee token
   * (APIS) unless the sender is the genesis issuer doing bootstrap.
   * payload: { symbol, name, precision, maxSupply, url?, supplyCapImmutable? }
   */
  create(state, ctx, p) {
    const { sender } = ctx;
    const symbol = String(p.symbol || '');
    if (!SYMBOL_RE.test(symbol)) return err(`invalid symbol "${p.symbol}" (1-10 uppercase A-Z)`);
    if (getToken(state, symbol)) return err(`token ${symbol} already exists`);

    const precision = Number(p.precision);
    if (!isValidPrecision(precision)) return err(`precision must be integer 0..${MAX_PRECISION}`);

    let maxSupplyBase;
    try {
      maxSupplyBase = toBaseUnits(String(p.maxSupply), precision);
    } catch (e) {
      return err(`bad maxSupply: ${e.message}`);
    }
    if (maxSupplyBase <= 0n) return err('maxSupply must be > 0');
    if (maxSupplyBase > maxSupplyBaseUnits(precision)) {
      return err('maxSupply exceeds Number.MAX_SAFE_INTEGER ceiling');
    }

    const name = String(p.name || symbol).slice(0, 50);
    const url = typeof p.url === 'string' ? p.url.slice(0, 255) : '';
    const supplyCapImmutable = p.supplyCapImmutable === true;

    // Charge the creation fee (burn APIS) unless bootstrapping genesis tokens.
    const isGenesisBootstrap = ctx.genesis === true;
    if (!isGenesisBootstrap) {
      const feeRes = burnFee(state, sender, config.tokenCreationFee);
      if (!feeRes.ok) return feeRes;
    }

    state.insert('tokens', {
      symbol,
      name,
      issuer: sender,
      precision,
      maxSupply: maxSupplyBase.toString(),
      supply: '0',
      circulatingSupply: '0',
      supplyCapImmutable,
      url,
      createdBlock: ctx.blockNum,
    });
    return ok({ created: symbol });
  },

  /**
   * issue — mint new tokens to an account. Issuer-only. Respects maxSupply
   * (always) and, if supplyCapImmutable, can never exceed it.
   * payload: { symbol, to, quantity }
   */
  issue(state, ctx, p) {
    const { sender } = ctx;
    const symbol = String(p.symbol || '').toUpperCase();
    const token = getToken(state, symbol);
    if (!token) return err(`no such token ${symbol}`);
    if (token.issuer !== sender) return err(`only issuer (${token.issuer}) can issue ${symbol}`);

    const to = String(p.to || '');
    if (!to) return err('missing recipient');

    let amount;
    try {
      amount = toBaseUnits(String(p.quantity), token.precision);
    } catch (e) {
      return err(`bad quantity: ${e.message}`);
    }
    if (amount <= 0n) return err('quantity must be > 0');

    const newSupply = BigInt(token.supply) + amount;
    const maxSupply = BigInt(token.maxSupply);
    if (newSupply > maxSupply) {
      return err(`issue would exceed maxSupply (cap${token.supplyCapImmutable ? ' is immutable' : ''})`);
    }

    token.supply = newSupply.toString();
    token.circulatingSupply = newSupply.toString();
    const row = getBalance(state, to, symbol);
    setBalance(state, to, symbol, bal(row) + amount);

    // append-only issuance log (auditability — themarkymark fix)
    state.insert('issuanceLog', {
      symbol,
      to,
      quantity: fromBaseUnits(amount, token.precision),
      issuer: sender,
      block: ctx.blockNum,
      txId: ctx.txId,
    });
    return ok({ issued: fromBaseUnits(amount, token.precision), symbol, to });
  },

  /**
   * transfer — move tokens between accounts.
   * payload: { symbol, to, quantity }
   */
  transfer(state, ctx, p) {
    const { sender } = ctx;
    const symbol = String(p.symbol || '').toUpperCase();
    const token = getToken(state, symbol);
    if (!token) return err(`no such token ${symbol}`);

    const to = String(p.to || '');
    if (!to) return err('missing recipient');
    if (to === sender) return err('cannot transfer to self');

    let amount;
    try {
      amount = toBaseUnits(String(p.quantity), token.precision);
    } catch (e) {
      return err(`bad quantity: ${e.message}`);
    }
    if (amount <= 0n) return err('quantity must be > 0');

    const fromRow = getBalance(state, sender, symbol);
    if (bal(fromRow) < amount) return err('insufficient balance');

    setBalance(state, sender, symbol, bal(fromRow) - amount);
    const toRow = getBalance(state, to, symbol);
    setBalance(state, to, symbol, bal(toRow) + amount);
    return ok({ transferred: fromBaseUnits(amount, token.precision), symbol, from: sender, to });
  },

  /**
   * stake — lock tokens into the sender's stake bucket (governance/mining
   * weight). Simplified vs HE (no cooldown timer on testnet) but the bucket
   * split is the seam HE uses for WORKERBEE mining + witness voting.
   * payload: { symbol, quantity }   (stakes to self)
   */
  stake(state, ctx, p) {
    const { sender } = ctx;
    const symbol = String(p.symbol || '').toUpperCase();
    const token = getToken(state, symbol);
    if (!token) return err(`no such token ${symbol}`);
    let amount;
    try {
      amount = toBaseUnits(String(p.quantity), token.precision);
    } catch (e) {
      return err(`bad quantity: ${e.message}`);
    }
    if (amount <= 0n) return err('quantity must be > 0');
    const row = getBalance(state, sender, symbol);
    if (bal(row) < amount) return err('insufficient liquid balance to stake');
    row.balance = (bal(row) - amount).toString();
    row.stake = (BigInt(row.stake) + amount).toString();
    return ok({ staked: fromBaseUnits(amount, token.precision), symbol });
  },

  /**
   * unstake — move tokens from stake back to liquid (testnet: immediate; HE
   * uses a 1..365 day cooldown which a mainnet build would add).
   * payload: { symbol, quantity }
   */
  unstake(state, ctx, p) {
    const { sender } = ctx;
    const symbol = String(p.symbol || '').toUpperCase();
    const token = getToken(state, symbol);
    if (!token) return err(`no such token ${symbol}`);
    const row = getBalance(state, sender, symbol);
    if (!row) return err('nothing staked');
    let amount;
    try {
      amount = toBaseUnits(String(p.quantity), token.precision);
    } catch (e) {
      return err(`bad quantity: ${e.message}`);
    }
    if (amount <= 0n) return err('quantity must be > 0');
    if (BigInt(row.stake) < amount) return err('insufficient staked balance');
    row.stake = (BigInt(row.stake) - amount).toString();
    row.balance = (bal(row) + amount).toString();
    return ok({ unstaked: fromBaseUnits(amount, token.precision), symbol });
  },
};

/**
 * burnFee — deduct `feeWhole` of the fee token from `account` (sends to the
 * null account, i.e. removes from circulation). Used for token creation +
 * resource fees. Returns ok/err.
 */
export function burnFee(state, account, feeWhole) {
  const feeSymbol = genesis.feeToken;
  const token = getToken(state, feeSymbol);
  if (!token) return err(`fee token ${feeSymbol} not initialised`);
  const fee = toBaseUnits(String(feeWhole), token.precision);
  if (fee === 0n) return ok();
  const row = getBalance(state, account, feeSymbol);
  if (bal(row) < fee) {
    return err(`insufficient ${feeSymbol} for fee (need ${feeWhole})`);
  }
  setBalance(state, account, feeSymbol, bal(row) - fee);
  // reduce circulating supply (burn)
  token.circulatingSupply = (BigInt(token.circulatingSupply) - fee).toString();
  state.insert('burnLog', { symbol: feeSymbol, account, quantity: feeWhole, block: state.meta.lastBlock });
  return ok();
}
