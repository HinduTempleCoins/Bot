/**
 * workerbee.mjs — the WorkerBee issuance lottery for MELEK-Engine.
 *
 * Hive-Engine's BeeSwarm / WORKERBEE: you BUY WORKERBEE (a tradable token),
 * stake it, and a stake-weighted per-tick lottery mints BEE to you; expected BEE
 * ∝ yourStake / totalStake × emission. The emission is a FIXED schedule — more
 * staked WORKERBEE only splits the same pie smaller (it is NOT inflationary).
 *
 * MELEK's re-mapping (operator, final 2026-06-16):
 *   - You do NOT buy mining power; you EARN it by FOREVER-LOCKING the stake token
 *     (wMELEK / wrapped-MELEK). The lock is PERMANENT — no unstake, ever.
 *   - The lock mints APIS-Hash: a SOULBOUND, NON-TRANSFERABLE mining-power
 *     balance, 1:1 with the forever-locked amount (the staked-WORKERBEE
 *     equivalent, but earned + untradable instead of bought + tradable).
 *   - APIS-Hash mines APIS on WORKERBEE mechanics: a FIXED scheduled emission
 *     (default 1000 APIS/day, halving every 365 days) split by APIS-Hash share.
 *
 * The canonical PURE math (apisRate / apisAccrued / expectedMine / lotteryDraw /
 * apisHash / foreverLock) lives in kulaswap/apis-workerbee.mjs. This contract is
 * the engine-side, BigInt, deterministic-REPLAY realisation that those helpers
 * are the float mirror of — same emission curve, same shares, no floats here.
 *
 * SAFETY / VM-isolation (matches tokens.mjs / rewards.mjs §6 B item 4):
 *   No user JS. WorkerBee behaviour is fixed contract logic driven by config
 *   knobs (stakeToken, emissionPerDay, halvingDays, blocksPerDay). No untrusted
 *   code path; the sandbox-escape class of bug is avoided by construction.
 *
 * DETERMINISM / REPLAYABILITY (matches engine.mjs / state.mjs §6 C):
 *   - No clock, no network, NO Math.random. Everything keys off L1 blockNum.
 *   - Emission for a block range is a pure function of the range + the genesis
 *     anchor block (halving epochs), NEVER of totalApisHash — so the scheduled
 *     pie is fixed; stake only changes shares. Same L1 history => same state.
 *   - accRewardPerShare accumulator (MasterChef / Scotbot style) in BigInt base
 *     units, scaled by ACC_SCALE so integer division keeps precision. Identical
 *     payouts on every node.
 *
 * ISSUANCE BOUNDARY:
 *   APIS is minted through the SAME supply-cap-respecting tokens.issue path as
 *   rewards.mjs (issuer = the APIS token's own issuer = genesis.issuer = hathor),
 *   so maxSupply + the issuance log + the cap are honoured. No new minter role,
 *   no bridge. If the cap is hit, claim cleanly pays what it can and never throws.
 *
 * Action table (state, ctx, payload) where
 *   ctx = { sender, blockNum, blockId, txId, authLevel }:
 *
 *   foreverLock(amount)   sender forever-locks `amount` of the stake token;
 *                         mints soulbound APIS-Hash 1:1. NO unstake.
 *   tick()                deterministic emission step: advance the accumulator by
 *   runLottery()          the elapsed-block emission (alias of tick). One per block.
 *   claim()               harvest the sender's accrued APIS (via tokens.issue).
 *   transfer(...)         ALWAYS rejected — APIS-Hash is soulbound.
 *
 * Views (pure reads): apisHashOf, totalApisHash, apisHashPending, emissionInfo.
 *
 * Every action returns { ok:true, ... } or { ok:false, error }. Mutations only on
 * ok:true. Throws only on internal invariant violations (engine.mjs catches).
 */

import { toBaseUnits, fromBaseUnits } from '../lib/decimal.mjs';
import { config, genesis } from '../config.mjs';
import { tokens } from './tokens.mjs';

// accRewardPerShare scaling: emission-per-share is tiny in integer space, so we
// scale by 1e18 before dividing and unscale on payout. Pure BigInt; no floats.
const ACC_SCALE = 10n ** 18n;
const SOULBOUND_SYMBOL = 'APIS-HASH';

function err(error) {
  return { ok: false, error };
}
function ok(data = {}) {
  return { ok: true, ...data };
}

function getToken(state, symbol) {
  return state.findOne('tokens', { symbol });
}

/** The contract-global accumulator row (singleton). Lazily created. */
function pool(state) {
  let p = state.findOne('workerbeePool', { id: 'pool' });
  if (!p) {
    p = {
      id: 'pool',
      totalApisHash: '0', // sum of all soulbound APIS-Hash, base units of the stake token
      accRewardPerShare: '0', // scaled by ACC_SCALE; APIS base units per APIS-Hash base unit
      anchorSet: false, // whether the emission anchor has been pinned (block 0 is a valid anchor)
      lastTickBlock: 0, // last L1 block the emission was advanced to
      anchorBlock: 0, // genesis anchor: the block emission scheduling starts from
      mintedTotal: '0', // total APIS base units emitted (audit)
    };
    state.insert('workerbeePool', p);
  }
  return p;
}

/** A locker's position: their soulbound APIS-Hash + reward debt. */
function position(state, account) {
  return state.findOne('workerbeeMiners', { account });
}

// ── Emission schedule (the FIXED pie) ──────────────────────────────────────
// emissionPerDay / blocksPerDay = base APIS per block, in APIS base units.
// Emission for block index k (k = block - anchorBlock, 0-based) halves every
// halvingBlocks: emissionPerBlock(k) = basePerBlock >> floor(k / halvingBlocks).
// This is the integer mirror of apis-workerbee.mjs apisAccrued's piecewise
// halving. It depends ONLY on the block index — never on stake — so the pie is
// fixed and "more lockers != more total APIS".

/** Base emission per block in APIS base units (BigInt), before any halving. */
function basePerBlock(apisPrecision) {
  const wb = config.workerbee;
  const perDayBase = toBaseUnits(String(wb.emissionPerDay), apisPrecision);
  const bpd = BigInt(Math.max(1, Math.floor(wb.blocksPerDay)));
  return perDayBase / bpd; // integer APIS base units/block (dust below 1/bpd drops, deterministically)
}

/** halvingBlocks (BigInt); 0n disables halving. */
function halvingBlocks() {
  const wb = config.workerbee;
  const hd = Math.max(0, Math.floor(wb.halvingDays || 0));
  const bpd = Math.max(1, Math.floor(wb.blocksPerDay));
  return BigInt(hd * bpd);
}

/**
 * emissionForRange — total APIS base units scheduled across blocks
 * [fromK, toK) (0-based block indices relative to the anchor), summed across
 * halving epochs. Pure: depends only on the indices + the schedule constants.
 */
export function emissionForRange(fromK, toK, apisPrecision = 3) {
  let lo = BigInt(fromK);
  const hi = BigInt(toK);
  if (hi <= lo) return 0n;
  const base = basePerBlock(apisPrecision);
  if (base <= 0n) return 0n;
  const hb = halvingBlocks();
  if (hb <= 0n) return base * (hi - lo); // no halving: flat schedule

  let total = 0n;
  while (lo < hi) {
    const epoch = lo / hb; // which halving epoch block `lo` is in
    const epochEnd = (epoch + 1n) * hb; // first block of the next epoch
    const segEnd = epochEnd < hi ? epochEnd : hi;
    const span = segEnd - lo;
    // emission per block this epoch = base >> epoch (halve `epoch` times)
    const perBlock = epoch >= 256n ? 0n : base >> epoch; // after ~256 halvings = dust 0
    total += perBlock * span;
    lo = segEnd;
  }
  return total;
}

export const workerbee = {
  /**
   * foreverLock — sender PERMANENTLY locks `amount` of the configured stake
   * token (wMELEK), minting soulbound APIS-Hash 1:1. No unstake exists.
   * Pulls the liquid balance into the lock (it leaves circulation on the
   * miner's books but stays the engine's record of permanent collateral).
   * Idempotent/deterministic: locking again adds to the position (after
   * settling pending so prior accrual is not re-rated — MasterChef semantics).
   * payload: { amount }
   */
  foreverLock(state, ctx, p) {
    const { sender } = ctx;
    const stakeSymbol = config.workerbee.stakeToken.toUpperCase();
    const stakeTok = getToken(state, stakeSymbol);
    if (!stakeTok) return err(`stake token ${stakeSymbol} not registered`);

    let amount;
    try {
      amount = toBaseUnits(String(p.amount), stakeTok.precision);
    } catch (e) {
      return err(`bad amount: ${e.message}`);
    }
    if (amount <= 0n) return err('amount must be > 0');

    // Pull the liquid stake-token balance into the permanent lock.
    const balRow = state.findOne('balances', { account: sender, symbol: stakeSymbol });
    const liquid = balRow ? BigInt(balRow.balance) : 0n;
    if (liquid < amount) return err(`insufficient liquid ${stakeSymbol} to lock`);
    balRow.balance = (liquid - amount).toString();

    // Initialise / advance the accumulator to this block first so the new
    // APIS-Hash only earns from now on (no retroactive share).
    initAnchor(state, ctx);
    advance(state, ctx);
    const pl = pool(state);
    const acc = BigInt(pl.accRewardPerShare);

    let pos = position(state, sender);
    if (!pos) {
      pos = { account: sender, apisHash: '0', rewardDebt: '0', lockedTotal: '0' };
      state.insert('workerbeeMiners', pos);
    } else {
      // settle pending into the position's books before changing share
      const pending = (BigInt(pos.apisHash) * acc) / ACC_SCALE - BigInt(pos.rewardDebt);
      pos.accrued = (BigInt(pos.accrued || '0') + (pending > 0n ? pending : 0n)).toString();
    }

    // APIS-Hash is 1:1 with the locked stake token (soulbound mining power).
    pos.apisHash = (BigInt(pos.apisHash) + amount).toString();
    pos.lockedTotal = (BigInt(pos.lockedTotal) + amount).toString();
    pos.rewardDebt = ((BigInt(pos.apisHash) * acc) / ACC_SCALE).toString();

    pl.totalApisHash = (BigInt(pl.totalApisHash) + amount).toString();

    // permanent-lock audit record (forever; no matching unlock op exists)
    state.insert('workerbeeLocks', {
      account: sender,
      symbol: stakeSymbol,
      amount: fromBaseUnits(amount, stakeTok.precision),
      block: ctx.blockNum,
      txId: ctx.txId,
    });

    return ok({
      lockedForever: fromBaseUnits(amount, stakeTok.precision),
      symbol: stakeSymbol,
      apisHash: fromBaseUnits(BigInt(pos.apisHash), stakeTok.precision),
      totalApisHash: fromBaseUnits(BigInt(pl.totalApisHash), stakeTok.precision),
    });
  },

  /**
   * tick — advance the deterministic emission by the elapsed blocks. One
   * emission step per L1 block; anyone-can-turn crank, result independent of
   * caller (idempotent within a block). Distributes via accRewardPerShare.
   * payload: {} (block comes from ctx.blockNum)
   */
  tick(state, ctx) {
    initAnchor(state, ctx);
    const { minted, fromBlock, toBlock } = advance(state, ctx);
    const pl = pool(state);
    const apisTok = getToken(state, genesis.feeToken);
    const prec = apisTok ? apisTok.precision : 3;
    return ok({
      scheduledEmission: fromBaseUnits(minted, prec),
      fromBlock,
      toBlock,
      totalApisHash: fromBaseUnits(BigInt(pl.totalApisHash), stakePrecision(state)),
      accRewardPerShare: pl.accRewardPerShare,
    });
  },

  /** runLottery — alias of tick (the stake-weighted scheduled emission step). */
  runLottery(state, ctx) {
    return workerbee.tick(state, ctx);
  },

  /**
   * claim — harvest the sender's accrued APIS. Settles pending against the
   * current accumulator, mints APIS via the supply-cap-respecting tokens.issue
   * path, and resets reward debt. Soft-fails to 0 paid if nothing accrued.
   * payload: {}
   */
  claim(state, ctx) {
    const { sender } = ctx;
    initAnchor(state, ctx);
    advance(state, ctx);
    const pos = position(state, sender);
    if (!pos) return err('no APIS-Hash position');

    const pl = pool(state);
    const acc = BigInt(pl.accRewardPerShare);
    const pending = (BigInt(pos.apisHash) * acc) / ACC_SCALE - BigInt(pos.rewardDebt);
    const owed = BigInt(pos.accrued || '0') + (pending > 0n ? pending : 0n);
    // reset books regardless (debt re-based to current acc)
    pos.accrued = '0';
    pos.rewardDebt = ((BigInt(pos.apisHash) * acc) / ACC_SCALE).toString();

    const apisTok = getToken(state, genesis.feeToken);
    if (!apisTok) return err(`fee token ${genesis.feeToken} not initialised`);
    if (owed <= 0n) return ok({ claimed: fromBaseUnits(0n, apisTok.precision), symbol: genesis.feeToken });

    const paid = mintApis(state, ctx, apisTok, sender, owed);
    // carry forward anything the cap refused (deterministic; not lost)
    const unpaid = owed - paid;
    if (unpaid > 0n) pos.accrued = unpaid.toString();
    pl.mintedTotal = (BigInt(pl.mintedTotal) + paid).toString();

    return ok({
      claimed: fromBaseUnits(paid, apisTok.precision),
      symbol: genesis.feeToken,
      carried: fromBaseUnits(unpaid, apisTok.precision),
    });
  },

  /**
   * transfer — APIS-Hash is SOULBOUND. Always rejected. Present so any attempt
   * (including a misrouted op) returns a clear error, never silently moves
   * mining power.
   */
  transfer() {
    return err('APIS-Hash is soulbound (non-transferable) — it cannot be transferred');
  },

  // ── Views (pure reads) ──────────────────────────────────────────────────

  apisHashOf(state, ctx, p) {
    const account = String((p && p.account) || (ctx && ctx.sender) || '');
    const pos = position(state, account);
    const prec = stakePrecision(state);
    return ok({ account, apisHash: fromBaseUnits(pos ? BigInt(pos.apisHash) : 0n, prec) });
  },

  totalApisHash(state) {
    const pl = pool(state);
    return ok({ totalApisHash: fromBaseUnits(BigInt(pl.totalApisHash), stakePrecision(state)) });
  },

  /** apisHashPending — accrued-but-unclaimed APIS for `account` as of ctx.blockNum. Read-only. */
  apisHashPending(state, ctx, p) {
    const account = String((p && p.account) || (ctx && ctx.sender) || '');
    const pos = position(state, account);
    const apisTok = getToken(state, genesis.feeToken);
    const prec = apisTok ? apisTok.precision : 3;
    if (!pos) return ok({ account, pending: fromBaseUnits(0n, prec) });
    // project the accumulator forward to ctx.blockNum WITHOUT mutating state
    const pl = pool(state);
    const anchor = pl.anchorSet ? pl.anchorBlock : (ctx ? ctx.blockNum : 0);
    const lastTick = pl.anchorSet ? pl.lastTickBlock : anchor;
    const blockNum = ctx ? ctx.blockNum : lastTick;
    const total = BigInt(pl.totalApisHash);
    let acc = BigInt(pl.accRewardPerShare);
    if (total > 0n && blockNum > lastTick) {
      const minted = emissionForRange(lastTick - anchor, blockNum - anchor, prec);
      acc += (minted * ACC_SCALE) / total;
    }
    const pendingNow = (BigInt(pos.apisHash) * acc) / ACC_SCALE - BigInt(pos.rewardDebt);
    const owed = BigInt(pos.accrued || '0') + (pendingNow > 0n ? pendingNow : 0n);
    return ok({ account, pending: fromBaseUnits(owed, prec) });
  },

  /** emissionInfo — the FIXED schedule: per-day, per-block now, halving, anchor. */
  emissionInfo(state, ctx) {
    const wb = config.workerbee;
    const apisTok = getToken(state, genesis.feeToken);
    const prec = apisTok ? apisTok.precision : 3;
    const pl = pool(state);
    const anchor = pl.anchorSet ? pl.anchorBlock : (ctx ? ctx.blockNum : 0);
    const blockNum = ctx ? ctx.blockNum : (pl.anchorSet ? pl.lastTickBlock : anchor);
    const k = Math.max(0, blockNum - anchor);
    // current per-block emission = emission of the single block at index k
    const perBlockNow = emissionForRange(k, k + 1, prec);
    return ok({
      stakeToken: wb.stakeToken.toUpperCase(),
      emissionToken: genesis.feeToken,
      emissionPerDay: wb.emissionPerDay,
      halvingDays: wb.halvingDays,
      blocksPerDay: wb.blocksPerDay,
      anchorBlock: anchor,
      lastTickBlock: pl.lastTickBlock,
      currentHalvingEpoch: halvingBlocks() > 0n ? Math.floor(k / (wb.halvingDays * wb.blocksPerDay)) : 0,
      emissionPerBlockNow: fromBaseUnits(perBlockNow, prec),
      mintedTotal: fromBaseUnits(BigInt(pl.mintedTotal), prec),
      soulboundSymbol: SOULBOUND_SYMBOL,
    });
  },
};

// ── internals ───────────────────────────────────────────────────────────────

function stakePrecision(state) {
  const t = getToken(state, config.workerbee.stakeToken.toUpperCase());
  return t ? t.precision : 3;
}

/** Set the emission anchor on first touch (genesis block of the schedule). */
function initAnchor(state, ctx) {
  const pl = pool(state);
  if (!pl.anchorSet) {
    pl.anchorSet = true;
    pl.anchorBlock = ctx.blockNum;
    pl.lastTickBlock = ctx.blockNum;
  }
}

/**
 * advance — fold the scheduled emission for blocks (lastTickBlock, blockNum]
 * into accRewardPerShare. Pure w.r.t. block range; emission NEVER depends on
 * totalApisHash (the pie is fixed). If no APIS-Hash is locked yet the emission
 * for that gap is simply skipped (not minted to nobody), and lastTickBlock
 * still advances so it is never double-counted. Returns the minted base units.
 */
function advance(state, ctx) {
  const pl = pool(state);
  const blockNum = ctx.blockNum;
  const from = pl.lastTickBlock;
  if (blockNum <= from) return { minted: 0n, fromBlock: from, toBlock: from };

  const apisTok = getToken(state, genesis.feeToken);
  const prec = apisTok ? apisTok.precision : 3;
  const anchor = pl.anchorBlock;
  const total = BigInt(pl.totalApisHash);

  // Scheduled emission for the elapsed block range — fixed, stake-independent.
  const minted = emissionForRange(from - anchor, blockNum - anchor, prec);

  if (total > 0n && minted > 0n) {
    const inc = (minted * ACC_SCALE) / total;
    pl.accRewardPerShare = (BigInt(pl.accRewardPerShare) + inc).toString();
  }
  // advance the tick pointer regardless (emission during an empty hive is
  // simply not distributed; never retro-minted).
  pl.lastTickBlock = blockNum;
  return { minted: total > 0n ? minted : 0n, fromBlock: from, toBlock: blockNum };
}

/**
 * mintApis — emit `amount` base units of APIS to `to` via tokens.issue (issuer
 * = the APIS token's own issuer), honouring maxSupply + the issuance log. If the
 * cap would be exceeded it mints what remains; returns the base units actually
 * minted. Soft-fail-never-throw.
 */
function mintApis(state, ctx, apisTok, to, amountBase) {
  if (amountBase <= 0n) return 0n;
  const remainingCap = BigInt(apisTok.maxSupply) - BigInt(apisTok.supply);
  const toMint = amountBase > remainingCap ? remainingCap : amountBase;
  if (toMint <= 0n) return 0n;
  const issueCtx = { ...ctx, sender: apisTok.issuer };
  const res = tokens.issue(state, issueCtx, {
    symbol: apisTok.symbol,
    to,
    quantity: fromBaseUnits(toMint, apisTok.precision),
  });
  return res.ok ? toMint : 0n;
}

export { ACC_SCALE, SOULBOUND_SYMBOL };
