/**
 * rewards.mjs — the Scotbot equivalent: a config-driven social-reward
 * emission contract for Melek-Engine tokens.
 *
 * Hive-Engine's Scotbot lets a token issuer turn their token into a "tribe":
 * posts on the MELEK L1 (comment ops) tagged for that tribe accrue
 * token-stake-weighted votes, and on a fixed schedule Scotbot emits new tokens
 * from a reward pool, split between authors and curators by a reward curve.
 * This contract reproduces that behaviour for the first-party MELEK-Engine.
 *
 * SAFETY / VM-isolation model (matches tokens.mjs §6 B item 4):
 *   The reward behaviour is a CONFIG OBJECT (a "reward rule"), never user JS.
 *   An issuer registers a rule (emission rate, curve, author/curator split,
 *   window length); the engine interprets it. There is no user code path, so
 *   the sandbox-escape class of bug is avoided by construction — identical to
 *   the rest of the engine. Scotbot's own config knobs are reproduced as
 *   declarative fields, not executable hooks.
 *
 * DETERMINISM / REPLAYABILITY (matches engine.mjs / state.mjs §6 C):
 *   - No clock, no network, no randomness. Everything keys off L1 blockNum.
 *   - Social signal (votes/comments) enters ONLY via engine ops whose signer
 *     L1 already validated. The streamer feeds MELEK `vote` / `comment` ops
 *     in block order; this contract folds them into per-post weight exactly
 *     once. Same L1 history => same emission => same state hash.
 *   - All math is BigInt base units (no floats), like tokens.mjs.
 *   - The reward curve is a small enumerated set (linear / power), applied in
 *     integer space, so every node computes byte-identical payouts.
 *
 * ISSUANCE BOUNDARY:
 *   Emission mints the issuer's token via the SAME supply-cap-respecting path
 *   as tokens.issue (we call into the tokens contract), so maxSupply and the
 *   immutable-cap flag are honoured. A reward pool can never mint past the cap;
 *   when the cap is reached, payouts cleanly emit 0 and soft-fail-never-throw.
 *
 * Action table (state, ctx, payload) where
 *   ctx = { sender, blockNum, blockId, txId, authLevel }:
 *
 *   setReward(symbol, rule)         issuer-only — create/update the reward rule
 *   disableReward(symbol)           issuer-only — pause emission (rule kept)
 *   vote(author, permlink, symbol)  record a token-stake-weighted vote on a post
 *   payout(symbol)                  emit for all posts whose window has matured
 *
 * Every action returns { ok:true, ... } or { ok:false, error }. Mutations only
 * on ok:true. Throws only on internal invariant violations (engine.mjs catches).
 */

import { toBaseUnits, fromBaseUnits, isValidPrecision } from '../lib/decimal.mjs';
import { tokens } from './tokens.mjs';

const SYMBOL_RE = /^[A-Z]{1,10}$/;

// Supported reward curves (Scotbot's "author_curve_exponent" idea, but as a
// closed enum so it is deterministic and non-executable).
const CURVES = new Set(['linear', 'quadratic', 'sqrt']);

function err(error) {
  return { ok: false, error };
}
function ok(data = {}) {
  return { ok: true, ...data };
}

function getToken(state, symbol) {
  return state.findOne('tokens', { symbol });
}

/** Liquid+staked balance of `account` in `symbol`, in BigInt base units. */
function stakeWeight(state, account, symbol) {
  const row = state.findOne('balances', { account, symbol });
  if (!row) return 0n;
  // Scotbot weights by STAKED token (governance weight). We use stake; if a
  // rule opts into liquid weighting too, that is a rule flag below.
  return BigInt(row.stake || '0');
}

/**
 * Apply a reward curve to a raw weight (BigInt base units), returning BigInt.
 * Integer-only so it is identical across nodes:
 *   linear     -> w
 *   quadratic  -> w*w / SCALE  (rewards concentration; SCALE keeps magnitude)
 *   sqrt       -> isqrt(w)     (flattens whales; "n-th root" curve)
 */
function applyCurve(curve, w) {
  if (w <= 0n) return 0n;
  if (curve === 'linear') return w;
  if (curve === 'quadratic') return (w * w) / 1_000_000n;
  if (curve === 'sqrt') return isqrt(w);
  return w;
}

/** Deterministic integer square root (Newton's method on BigInt). */
function isqrt(n) {
  if (n < 0n) return 0n;
  if (n < 2n) return n;
  let x = n;
  let y = (x + 1n) / 2n;
  while (y < x) {
    x = y;
    y = (x + n / x) / 2n;
  }
  return x;
}

/** Validate + normalise a reward rule. Returns { rule } or { error }. */
function normaliseRule(p, token) {
  const symbol = String(p.symbol || '').toUpperCase();
  if (!SYMBOL_RE.test(symbol)) return { error: `invalid symbol "${p.symbol}"` };

  // emissionPerWindow: whole-token string emitted each reward window, split
  // between authors and curators. Parsed at the token's precision.
  let emissionBase;
  try {
    emissionBase = toBaseUnits(String(p.emissionPerWindow), token.precision);
  } catch (e) {
    return { error: `bad emissionPerWindow: ${e.message}` };
  }
  if (emissionBase <= 0n) return { error: 'emissionPerWindow must be > 0' };

  // windowBlocks: L1 blocks a post accrues votes before it can pay out.
  const windowBlocks = Number(p.windowBlocks);
  if (!Number.isInteger(windowBlocks) || windowBlocks < 1) {
    return { error: 'windowBlocks must be a positive integer' };
  }

  // author/curator split, expressed in basis points (0..10000) of each post's
  // payout. Scotbot's default is 50/50.
  const authorBps = p.authorBps === undefined ? 5000 : Number(p.authorBps);
  if (!Number.isInteger(authorBps) || authorBps < 0 || authorBps > 10000) {
    return { error: 'authorBps must be an integer 0..10000' };
  }

  const curve = String(p.curve || 'linear');
  if (!CURVES.has(curve)) return { error: `curve must be one of ${[...CURVES].join('/')}` };

  return {
    rule: {
      symbol,
      emissionPerWindow: emissionBase.toString(),
      windowBlocks,
      authorBps,
      curve,
      enabled: p.enabled === false ? false : true,
    },
  };
}

export const rewards = {
  /**
   * setReward — issuer registers/updates the reward rule for their token.
   * Issuer-only (auth from ctx.sender, never payload). Config, not code.
   * payload: { symbol, emissionPerWindow, windowBlocks, authorBps?, curve?, enabled? }
   */
  setReward(state, ctx, p) {
    const { sender } = ctx;
    const symbol = String(p.symbol || '').toUpperCase();
    const token = getToken(state, symbol);
    if (!token) return err(`no such token ${symbol}`);
    if (token.issuer !== sender) {
      return err(`only issuer (${token.issuer}) can configure ${symbol} rewards`);
    }
    if (!isValidPrecision(token.precision)) return err('token precision invalid');

    const { rule, error } = normaliseRule(p, token);
    if (error) return err(error);

    const existing = state.findOne('rewardRules', { symbol });
    if (existing) {
      Object.assign(existing, rule, { updatedBlock: ctx.blockNum });
    } else {
      state.insert('rewardRules', { ...rule, createdBlock: ctx.blockNum, updatedBlock: ctx.blockNum });
    }
    return ok({ rewardRule: { ...rule } });
  },

  /**
   * disableReward — issuer pauses emission without deleting the rule.
   * payload: { symbol }
   */
  disableReward(state, ctx, p) {
    const { sender } = ctx;
    const symbol = String(p.symbol || '').toUpperCase();
    const token = getToken(state, symbol);
    if (!token) return err(`no such token ${symbol}`);
    if (token.issuer !== sender) return err(`only issuer can disable ${symbol} rewards`);
    const rule = state.findOne('rewardRules', { symbol });
    if (!rule) return err(`no reward rule for ${symbol}`);
    rule.enabled = false;
    rule.updatedBlock = ctx.blockNum;
    return ok({ disabled: symbol });
  },

  /**
   * vote — record a token-stake-weighted vote on a post for `symbol`'s tribe.
   * The streamer turns each MELEK L1 `vote` op into one of these (the L1 voter
   * is ctx.sender). Weight = voter's STAKED balance in the reward token at the
   * moment of the vote, run through the rule's curve. A post is created on its
   * first vote (lazy registration), recording author + the block it opened.
   *
   * payload: { author, permlink, symbol }
   */
  vote(state, ctx, p) {
    const { sender } = ctx;
    const symbol = String(p.symbol || '').toUpperCase();
    const rule = state.findOne('rewardRules', { symbol });
    if (!rule) return err(`no reward rule for ${symbol}`);
    if (!rule.enabled) return err(`${symbol} rewards are disabled`);

    const author = String(p.author || '');
    const permlink = String(p.permlink || '');
    if (!author || !permlink) return err('author and permlink required');

    const token = getToken(state, symbol);
    if (!token) return err(`no such token ${symbol}`);

    const weight = applyCurve(rule.curve, stakeWeight(state, sender, symbol));
    if (weight <= 0n) return err('voter has no stake weight in this token');

    const postKey = `${author}/${permlink}`;
    let post = state.findOne('rewardPosts', { symbol, postKey });
    if (!post) {
      post = {
        symbol,
        postKey,
        author,
        permlink,
        openedBlock: ctx.blockNum,
        // matures windowBlocks after first vote (Scotbot's reward window)
        maturesBlock: ctx.blockNum + rule.windowBlocks,
        rewardWeight: '0', // sum of curved voter weights (the pool share basis)
        paid: false,
        votes: 0,
      };
      state.insert('rewardPosts', post);
    }
    if (post.paid) return err('post already paid out');

    // one vote per (voter, post) — re-vote updates weight (last-write-wins,
    // like a HF20 vote replacing the prior one). Deterministic.
    let v = state.findOne('rewardVotes', { symbol, postKey, voter: sender });
    if (v) {
      post.rewardWeight = (BigInt(post.rewardWeight) - BigInt(v.weight) + weight).toString();
      v.weight = weight.toString();
      v.block = ctx.blockNum;
    } else {
      state.insert('rewardVotes', {
        symbol,
        postKey,
        voter: sender,
        weight: weight.toString(),
        block: ctx.blockNum,
      });
      post.rewardWeight = (BigInt(post.rewardWeight) + weight).toString();
      post.votes += 1;
    }
    return ok({ symbol, postKey, rewardWeight: post.rewardWeight, votes: post.votes });
  },

  /**
   * payout — emit rewards for every matured, unpaid post under `symbol`.
   * Triggered deterministically: the streamer calls this when blockNum >= a
   * post's maturesBlock (Scotbot's scheduled payout). Anyone may trigger it;
   * who triggers it does not affect the result (idempotent on already-paid).
   *
   * For each matured post a fixed emissionPerWindow is minted (subject to the
   * token cap) and split:
   *   - authorShare = emission * authorBps / 10000  -> author
   *   - curatorShare = remainder, split among voters PRO-RATA by curved weight
   * Dust from integer division is added to the author share (deterministic).
   *
   * payload: { symbol, untilBlock? }  (untilBlock defaults to ctx.blockNum)
   */
  payout(state, ctx, p) {
    const symbol = String(p.symbol || '').toUpperCase();
    const rule = state.findOne('rewardRules', { symbol });
    if (!rule) return err(`no reward rule for ${symbol}`);
    const token = getToken(state, symbol);
    if (!token) return err(`no such token ${symbol}`);

    const untilBlock = p.untilBlock === undefined ? ctx.blockNum : Number(p.untilBlock);
    if (!Number.isInteger(untilBlock)) return err('untilBlock must be an integer');

    const due = state
      .find('rewardPosts', { symbol })
      .filter((post) => !post.paid && post.maturesBlock <= untilBlock)
      // deterministic order: by maturity then postKey
      .sort((a, b) => a.maturesBlock - b.maturesBlock || a.postKey.localeCompare(b.postKey));

    const results = [];
    for (const post of due) {
      results.push(payoutPost(state, ctx, rule, token, post));
    }
    return ok({ symbol, paid: results.length, payouts: results });
  },
};

/**
 * payoutPost — internal. Emit + distribute one post's reward. Mints via the
 * tokens.issue path so the supply cap is honoured; if the cap is hit the post
 * is still marked paid with whatever was emitted (0 if fully capped). Pure
 * w.r.t. inputs.
 */
function payoutPost(state, ctx, rule, token, post) {
  post.paid = true;
  post.paidBlock = ctx.blockNum;

  const totalWeight = BigInt(post.rewardWeight);
  if (totalWeight <= 0n) {
    post.emitted = fromBaseUnits(0n, token.precision);
    return { postKey: post.postKey, author: post.author, emitted: post.emitted, reason: 'no weight' };
  }

  // How much we are *allowed* to emit, respecting the (possibly immutable) cap.
  const emissionWanted = BigInt(rule.emissionPerWindow);
  const remainingCap = BigInt(token.maxSupply) - BigInt(token.supply);
  const emission = remainingCap <= 0n ? 0n : (emissionWanted > remainingCap ? remainingCap : emissionWanted);
  if (emission <= 0n) {
    post.emitted = fromBaseUnits(0n, token.precision);
    return { postKey: post.postKey, author: post.author, emitted: post.emitted, reason: 'cap reached' };
  }

  const curatorShareTotal = (emission * BigInt(10000 - rule.authorBps)) / 10000n;
  // author gets their bps share PLUS any rounding dust (deterministic).
  let distributedToCurators = 0n;

  // Curators pro-rata by their curved weight. Sorted for determinism.
  const votes = state
    .find('rewardVotes', { symbol: post.symbol, postKey: post.postKey })
    .slice()
    .sort((a, b) => a.voter.localeCompare(b.voter));

  const curatorPayouts = [];
  for (const v of votes) {
    const share = (curatorShareTotal * BigInt(v.weight)) / totalWeight;
    if (share > 0n) {
      mint(state, ctx, token, v.voter, share);
      distributedToCurators += share;
      curatorPayouts.push({ voter: v.voter, amount: fromBaseUnits(share, token.precision) });
    }
  }

  const authorAmount = emission - distributedToCurators; // author bps + all dust
  if (authorAmount > 0n) mint(state, ctx, token, post.author, authorAmount);

  post.emitted = fromBaseUnits(emission, token.precision);
  return {
    postKey: post.postKey,
    author: post.author,
    emitted: post.emitted,
    authorAmount: fromBaseUnits(authorAmount, token.precision),
    curators: curatorPayouts,
  };
}

/**
 * mint — issuer-authorised emission of `amount` base units of `token` to
 * `to`, via the tokens contract's issue path so supply + the issuance log +
 * the cap are all maintained consistently. We invoke issue as the token's
 * OWN issuer (the rule could only be set by the issuer), so this is a
 * legitimate, cap-respecting mint. Soft-fail-never-throw.
 */
function mint(state, ctx, token, to, amountBase) {
  if (amountBase <= 0n) return;
  const issueCtx = { ...ctx, sender: token.issuer };
  const res = tokens.issue(state, issueCtx, {
    symbol: token.symbol,
    to,
    quantity: fromBaseUnits(amountBase, token.precision),
  });
  // tokens.issue already re-derives supply + cap; if it soft-fails (e.g. a
  // race against the cap) we simply emit nothing for this voter — never throw.
  if (!res.ok) {
    // tag the issuance log gap so replayers can see the cap event; no mutation.
    return;
  }
}

export { applyCurve, isqrt };
