// scot-earnings.mjs — "see all the SCOT tokens you'll earn for each post."
//
// The keystone of tokens.alpha.melek.salon: given a post (its tags) and the MELEK-Engine tribe
// reward rules + the post's per-tribe vote weight, PROJECT the token amount the post earns in
// EVERY tribe it is tagged for, split author/curator. Mirrors engine/contracts/rewards.mjs
// (tag→tribe match, curve linear/quadratic/sqrt, author/curator split) but as a float PREVIEW
// (the on-chain payout in integer base units stays authoritative; this is the estimate the UI shows).
//
//   import { tribesForTags, applyCurve, tribeEarning, earningsForPost, projectPostEarnings,
//            __setFetch } from './scot-earnings.mjs'
//
// Pure + soft-fail-never-throw; the fetch-based projector uses an injectable fetch (offline tests).

let _fetch = (...a) => globalThis.fetch(...a);
/** Test hook — inject fetch; pass nothing to restore the global. */
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

const num = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : 0; };
const norm = (s) => String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9-]/g, '');

/**
 * Which tribe rules a post (by its tags) earns in. A rule matches if its `tag`
 * (default = symbol lowercased) is among the post's tags and the rule is enabled.
 * @param {Array} rules  [{symbol, tag, enabled, emission, window, authorPct, curatorPct, curve}, ...]
 * @param {string[]} tags  the post's tags
 * @returns {Array} matched rules
 */
export function tribesForTags(rules, tags) {
  const set = new Set((Array.isArray(tags) ? tags : []).map(norm).filter(Boolean));
  return (Array.isArray(rules) ? rules : []).filter(
    (r) => r && r.enabled !== false && set.has(norm(r.tag || r.symbol)),
  );
}

/** Apply a reward curve to a numeric weight (mirrors the engine's enumerated curves). */
export function applyCurve(curve, w) {
  const x = num(w);
  if (curve === 'quadratic') return (x * x) / 1e6; // flattens nothing; rewards concentration
  if (curve === 'sqrt') return Math.sqrt(x);       // flattens whales
  return x;                                         // linear (default)
}

/**
 * Project ONE post's earning in ONE tribe.
 * @param {object} rule  the tribe reward rule
 * @param {{postWeight:number, windowTotalWeight:number}} w  this post's weight + the window total
 * @returns {{symbol, token, tag, curve, emission, share, total, author, curators}}
 */
export function tribeEarning(rule, w = {}) {
  const symbol = String(rule.symbol || '').toUpperCase();
  // accept both the projector's shape (emission/authorPct) and the live engine's
  // tribe shape (emissionPerWindow / authorBps), so the same code drives tests + prod.
  const emission = num(rule.emission != null ? rule.emission : rule.emissionPerWindow);
  const authorPct = rule.authorPct != null
    ? Math.min(100, Math.max(0, Number(rule.authorPct)))
    : (rule.authorBps != null ? Math.min(100, Math.max(0, Number(rule.authorBps) / 100)) : 50);
  const pw = applyCurve(rule.curve, w.postWeight);
  // windowTotalWeight should already be curve-applied across all posts; never let share exceed 1.
  const tot = Math.max(pw, num(w.windowTotalWeight));
  const share = tot > 0 ? pw / tot : 0;
  const total = emission * share;
  const author = total * (authorPct / 100);
  const curators = total - author;
  return { symbol, token: symbol, tag: norm(rule.tag || rule.symbol), curve: rule.curve || 'linear', emission, share, total, author, curators };
}

/**
 * THE HEADLINE: a post's earnings across EVERY tribe it is tagged for.
 * @param {{tags:string[]}} post
 * @param {Array} rules  all tribe reward rules
 * @param {Record<string,{postWeight,windowTotalWeight}>} weights  per-symbol weight context
 * @returns {{post, earnings:Array, totalTokens:number}}
 */
export function earningsForPost({ post = {}, rules = [], weights = {} } = {}) {
  const matched = tribesForTags(rules, post.tags);
  const earnings = matched.map((r) => tribeEarning(r, weights[String(r.symbol).toUpperCase()] || {}));
  return { post: { author: post.author, permlink: post.permlink, tags: post.tags || [] }, earnings, totalTokens: earnings.length };
}

// ---- fetch-based projector over the live MELEK-Engine API ------------------
async function getJson(url) {
  try { const r = await _fetch(url); if (!r || !r.ok) return null; return await r.json(); } catch { return null; }
}

/**
 * Pull the live tribe rules + this post's per-tribe weight from the engine API and project
 * earnings across all tribes the post is in. Soft-fails to an empty projection.
 * @param {{author, permlink, tags?}} post
 * @param {{engineApi:string}} opts  base URL of the MELEK-Engine API (e.g. https://engine.alpha.melek.salon)
 * @returns {Promise<{post, earnings, totalTokens}>}
 */
export async function projectPostEarnings(post = {}, { engineApi } = {}) {
  const base = String(engineApi || '').replace(/\/$/, '');
  if (!base || !post.author || !post.permlink) return earningsForPost({ post, rules: [], weights: {} });
  // 1) all reward rules (tribes) — the live engine serves these at /contracts/tribes
  const rulesResp = await getJson(`${base}/contracts/tribes`);
  const rules = (rulesResp && (rulesResp.rules || rulesResp.result || rulesResp)) || [];
  const list = Array.isArray(rules) ? rules : [];
  // 2) per-tribe payout context for this post (emitted+pending + window totals), per matched tribe
  const matched = tribesForTags(list, post.tags);
  const weights = {};
  for (const r of matched) {
    const sym = String(r.symbol).toUpperCase();
    const pr = await getJson(`${base}/contracts/payouts?symbol=${encodeURIComponent(sym)}`);
    // live engine returns a BARE array; tests/other shapes use {posts}/{result}.
    const posts = Array.isArray(pr) ? pr : ((pr && (pr.posts || pr.result)) || []);
    const mine = (Array.isArray(posts) ? posts : []).find(
      (p) => p && p.author === post.author && p.permlink === post.permlink,
    );
    // the live engine names the per-post weight `rewardWeight`; tests use `weight`/`rshares`.
    const pw = (p) => num(p && (p.weight ?? p.rewardWeight ?? p.rshares));
    const total = (Array.isArray(posts) ? posts : []).reduce((s, p) => s + pw(p), 0);
    weights[sym] = { postWeight: pw(mine), windowTotalWeight: total };
  }
  return earningsForPost({ post, rules: list, weights });
}
