/**
 * scot.mjs — the SCOT BOT MINT. A one-op facade that stands up a SCOT tribe token (the Scotbot / Nitrous
 * model) in a single action, the way seeds.mjs is a one-op facade for the seed mint.
 *
 * The engine already HAS the SCOT mint primitive — `rewards.mjs` mints tribe tokens to authors + curators on
 * upvotes (cap-respecting, on a fixed schedule). What was missing is the front door: today you must call
 * `tokens.create` and THEN `rewards.setReward` separately. `scot.createTribe` does both atomically (and an
 * optional founder pre-issue), so launching a SCOT token is one mint op.
 *
 * Permissionless-but-paid, like Hive-Engine Nitrous: anyone may launch a tribe; tokens.create burns the APIS
 * creation fee, and the issuer (ctx.sender) owns the token + its reward rule. Issuer auth flows through the
 * underlying contracts (sender must be the token issuer), which holds because createTribe creates it.
 *
 * Returns { ok:true, … } / { ok:false, error }; never throws on user error.
 */

import { tokens } from './tokens.mjs';
import { rewards } from './rewards.mjs';
import { toBaseUnits, isValidPrecision } from '../lib/decimal.mjs';

const SYMBOL_RE = /^[A-Z]{1,10}$/;
const CURVES = new Set(['linear', 'quadratic', 'sqrt']); // mirrors rewards.mjs
function err(error) { return { ok: false, error }; }
function ok(data = {}) { return { ok: true, ...data }; }

export const scot = {
  /**
   * createTribe — mint a SCOT tribe token: create the token + wire its reward rule (+ optional founder issue).
   * payload: { symbol, name?, precision, maxSupply, tag?, emissionPerWindow, windowBlocks, authorBps?, curve?, initialIssue?, url? }
   */
  createTribe(state, ctx, p) {
    const symbol = String(p.symbol || '').toUpperCase();
    if (!SYMBOL_RE.test(symbol)) return err(`invalid symbol "${p.symbol}" (1-10 uppercase A-Z)`);
    if (state.findOne('tokens', { symbol })) return err(`token ${symbol} already exists`);

    const precision = Number(p.precision);
    if (!isValidPrecision(precision)) return err('precision must be an integer 0..8');

    // Pre-validate the reward params BEFORE creating the token, so the happy path is atomic (no half-mint
    // with a burned fee). These mirror rewards.normaliseRule.
    let emissionBase;
    try { emissionBase = toBaseUnits(String(p.emissionPerWindow), precision); }
    catch (e) { return err(`bad emissionPerWindow: ${e.message}`); }
    if (emissionBase <= 0n) return err('emissionPerWindow must be > 0');
    const windowBlocks = Number(p.windowBlocks);
    if (!Number.isInteger(windowBlocks) || windowBlocks < 1) return err('windowBlocks must be a positive integer');
    const authorBps = p.authorBps === undefined ? 5000 : Number(p.authorBps);
    if (!Number.isInteger(authorBps) || authorBps < 0 || authorBps > 10000) return err('authorBps must be an integer 0..10000');
    const curve = p.curve === undefined ? 'linear' : String(p.curve);
    if (!CURVES.has(curve)) return err(`curve must be one of ${[...CURVES].join('/')}`);

    // 1) create the token (burns the APIS creation fee; issuer = sender)
    const cr = tokens.create(state, ctx, { symbol, name: p.name || symbol, precision, maxSupply: p.maxSupply, url: p.url });
    if (!cr.ok) return cr;

    // 2) wire the SCOT reward rule. Pre-validated above, so this should pass; on the off chance it doesn't,
    //    roll back the token so we don't leave a tribe-less token (the fee stays burned — a real cost).
    const rr = rewards.setReward(state, ctx, { symbol, emissionPerWindow: p.emissionPerWindow, windowBlocks, authorBps, curve, tag: p.tag });
    if (!rr.ok) { state.remove('tokens', { symbol }); return err(`reward rule rejected: ${rr.error}`); }

    // 3) optional founder pre-issue
    let initialIssue = null;
    if (p.initialIssue != null && String(p.initialIssue) !== '0') {
      const is = tokens.issue(state, ctx, { symbol, to: ctx.sender, quantity: p.initialIssue });
      if (!is.ok) return is;
      initialIssue = is.issued;
    }
    return ok({ tribe: symbol, rule: rr.rewardRule, initialIssue });
  },

  /**
   * mint — issue more of a tribe token (issuer-only; passthrough to tokens.issue). Refuses a non-tribe token
   * so `scot.mint` always means "mint a SCOT token".
   * payload: { symbol, to, quantity }
   */
  mint(state, ctx, p) {
    const symbol = String(p.symbol || '').toUpperCase();
    if (!state.findOne('rewardRules', { symbol })) return err(`${symbol || p.symbol} is not a SCOT tribe (no reward rule)`);
    const r = tokens.issue(state, ctx, { symbol, to: p.to, quantity: p.quantity });
    return r.ok ? ok({ minted: r.issued, symbol, to: r.to }) : r;
  },
};
