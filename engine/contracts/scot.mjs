/**
 * scot.mjs — the SCOT BOT MINT, as an APIS-gated UPGRADE on an existing token (the Hive-Engine flow).
 *
 * The engine already HAS the SCOT mint primitive — `rewards.mjs` mints tribe tokens to authors + curators on
 * upvotes. The operator's model (2026-06-22): you PAY APIS to create a token (tokens.create), then PAY APIS
 * AGAIN to add a Scot Bot to it (and/or to make it a Seed — see seeds.enable). Each is a separate, combinable,
 * fee-burning option, exactly like Hive-Engine's Nitrous/Scotbot add-ons.
 *
 *   scot.enable(symbol, …)     — add a Scot Bot to an EXISTING token (issuer-only; burns config.scotFee APIS
 *                                on first enable; wires/updates the SCOT reward rule).
 *   scot.createTribe(symbol, …)— convenience bundle: tokens.create (creation fee) + scot.enable (scot fee)
 *                                + optional founder issue, in one op.
 *   scot.mint(symbol, to, qty) — issue more of a tribe token (issuer-only; refuses non-tribes).
 *
 * Returns { ok:true, … } / { ok:false, error }; never throws on user error.
 */

import { tokens, burnFee } from './tokens.mjs';
import { rewards } from './rewards.mjs';
import { config } from '../config.mjs';
import { toBaseUnits, isValidPrecision } from '../lib/decimal.mjs';

const SYMBOL_RE = /^[A-Z]{1,10}$/;
const CURVES = new Set(['linear', 'quadratic', 'sqrt']); // mirrors rewards.mjs
function err(error) { return { ok: false, error }; }
function ok(data = {}) { return { ok: true, ...data }; }
const getToken = (state, symbol) => state.findOne('tokens', { symbol });

/** Validate the SCOT reward params against a token precision. Returns { error } or { params }. */
function validateReward(p, precision) {
  let emissionBase;
  try { emissionBase = toBaseUnits(String(p.emissionPerWindow), precision); }
  catch (e) { return { error: `bad emissionPerWindow: ${e.message}` }; }
  if (emissionBase <= 0n) return { error: 'emissionPerWindow must be > 0' };
  const windowBlocks = Number(p.windowBlocks);
  if (!Number.isInteger(windowBlocks) || windowBlocks < 1) return { error: 'windowBlocks must be a positive integer' };
  const authorBps = p.authorBps === undefined ? 5000 : Number(p.authorBps);
  if (!Number.isInteger(authorBps) || authorBps < 0 || authorBps > 10000) return { error: 'authorBps must be an integer 0..10000' };
  const curve = p.curve === undefined ? 'linear' : String(p.curve);
  if (!CURVES.has(curve)) return { error: `curve must be one of ${[...CURVES].join('/')}` };
  return { params: { windowBlocks, authorBps, curve } };
}

export const scot = {
  /**
   * enable — add a Scot Bot to an EXISTING token (the APIS-gated upgrade). Issuer-only. Burns config.scotFee
   * APIS the first time (re-configuring an already-SCOT token is free, like rewards.setReward).
   * payload: { symbol, emissionPerWindow, windowBlocks, authorBps?, curve?, tag? }
   */
  enable(state, ctx, p) {
    const { sender } = ctx;
    const symbol = String(p.symbol || '').toUpperCase();
    if (!SYMBOL_RE.test(symbol)) return err(`invalid symbol "${p.symbol}"`);
    const token = getToken(state, symbol);
    if (!token) return err(`no such token ${symbol} — create it first (tokens.create)`);
    if (token.issuer !== sender) return err(`only issuer (${token.issuer}) can add a Scot Bot to ${symbol}`);
    const v = validateReward(p, token.precision);
    if (v.error) return err(v.error);

    const already = state.findOne('rewardRules', { symbol });
    if (!already) { const fee = burnFee(state, sender, config.scotFee); if (!fee.ok) return fee; }
    const rr = rewards.setReward(state, ctx, { symbol, emissionPerWindow: p.emissionPerWindow, ...v.params, tag: p.tag });
    if (!rr.ok) return rr;
    return ok({ scotEnabled: symbol, rule: rr.rewardRule, charged: already ? '0' : config.scotFee });
  },

  /**
   * createTribe — convenience bundle: create the token (creation fee) + enable the Scot Bot (scot fee) +
   * optional founder issue, in one op. Reward params pre-validated before create so a bad rule leaves no
   * orphan token. payload: { symbol, name?, precision, maxSupply, tag?, emissionPerWindow, windowBlocks, authorBps?, curve?, initialIssue?, url? }
   */
  createTribe(state, ctx, p) {
    const symbol = String(p.symbol || '').toUpperCase();
    if (!SYMBOL_RE.test(symbol)) return err(`invalid symbol "${p.symbol}" (1-10 uppercase A-Z)`);
    if (getToken(state, symbol)) return err(`token ${symbol} already exists`);
    const precision = Number(p.precision);
    if (!isValidPrecision(precision)) return err('precision must be an integer 0..8');
    const v = validateReward(p, precision); // pre-validate against the to-be-created precision
    if (v.error) return err(v.error);

    const cr = tokens.create(state, ctx, { symbol, name: p.name || symbol, precision, maxSupply: p.maxSupply, url: p.url });
    if (!cr.ok) return cr;
    const en = this.enable(state, ctx, p); // charges scotFee + wires the rule
    if (!en.ok) { state.remove('tokens', { symbol }); return err(`scot enable failed: ${en.error}`); }

    let initialIssue = null;
    if (p.initialIssue != null && String(p.initialIssue) !== '0') {
      const is = tokens.issue(state, ctx, { symbol, to: ctx.sender, quantity: p.initialIssue });
      if (!is.ok) return is;
      initialIssue = is.issued;
    }
    return ok({ tribe: symbol, rule: en.rule, initialIssue });
  },

  /**
   * mint — issue more of a tribe token (issuer-only; passthrough to tokens.issue; refuses a non-tribe token).
   * payload: { symbol, to, quantity }
   */
  mint(state, ctx, p) {
    const symbol = String(p.symbol || '').toUpperCase();
    if (!state.findOne('rewardRules', { symbol })) return err(`${symbol || p.symbol} is not a SCOT tribe (no reward rule)`);
    const r = tokens.issue(state, ctx, { symbol, to: p.to, quantity: p.quantity });
    return r.ok ? ok({ minted: r.issued, symbol, to: r.to }) : r;
  },
};
