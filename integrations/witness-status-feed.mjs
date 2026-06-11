// witness-status-feed.mjs — READ-ONLY witness-health feed for the site (surfaces witness-monitor data).
//
// PURPOSE:
//   The Witness School page (witness.melek.salon/hathor) wants a small, public-safe health card
//   for the `hathor` MELEK witness: is it producing, how many blocks has it missed, how far behind
//   head is it, and how fresh is the price feed. This module turns the data the witness-monitor
//   (witness/monitor.mjs) and the feed-state (witness/feed-state.mjs) already produce into ONE flat
//   status object, plus an esc()'d HTML badge for the site.
//
//   It does NOT poll the chain itself. The chain/monitor snapshot is PASSED IN via an INJECTED
//   reader, exactly like the rest of the integrations/ readers — so this stays offline, holds NO
//   keys, makes NO network calls, and can NEVER sign or broadcast. By construction it reads only.
//
// READER CONTRACT (injected; pure data, no network here):
//   witnessStatus(reader) where `reader` is either:
//     - an object snapshot, OR
//     - a function () => snapshot (sync or async),
//   yielding a shape compatible with witness/monitor.mjs's checkWitness() snapshot, optionally with
//   feed-state's lastPublished:
//     {
//       account, ok, totalMissed, lastConfirmedBlock, headBlock, blocksBehind,
//       signingKeyDisabled, version, ts,                       // from monitor.mjs
//       lastPublished: { price, at } | null,                   // from feed-state.mjs (optional)
//       priceFeedAt | feedAt (epoch ms) | priceFeedAgeMin      // any of these supply feed freshness
//     }
//
// OUTPUT (flat, stable, the prompt's contract):
//   { account:'hathor', producing:boolean, missedBlocks:number, lastBlock:number,
//     priceFeedAgeMin:number|null, healthy:boolean }
//
// SOFT-FAIL, NEVER THROW: a missing/empty/throwing/garbage reader collapses to a safe,
//   fully-shaped not-healthy status. esc() guards every interpolated value in the HTML.
//
//   import { witnessStatus, renderStatusHtml } from './integrations/witness-status-feed.mjs';
//   const status = await witnessStatus(snapshot);   // or witnessStatus(() => snapshot)
//   const html = renderStatusHtml(status);
//
// CLI:  node integrations/witness-status-feed.mjs   # print a worked example

// ── HTML escape: used by renderStatusHtml for every interpolated value ──────────────────────────
export function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── injectable reader seam ──────────────────────────────────────────────────────────────────────
// The default reader is null: there is no network here. Callers pass a snapshot (or a fn returning
// one) directly to witnessStatus(); a module-level default can be set for the CLI/convenience.
let _reader = null;

/** Inject a default reader: an object snapshot, or a () => snapshot (sync or async). Falsy resets. */
export function __setReader(r) {
  _reader = r || null;
}

// ── thresholds (tune here; all comparisons soft) ────────────────────────────────────────────────
export const DEFAULT_THRESHOLDS = Object.freeze({
  maxBlocksBehind: 20,    // healthy only if within this many blocks of head (matches monitor's stall)
  maxMissedBlocks: 0,     // healthy requires no missed blocks beyond this many
  maxFeedAgeMin: 90,      // price feed is "stale" past this many minutes (hourly feed + grace)
});

// ── safe coercion helpers ─────────────────────────────────────────────────────────────────────
function num(x) {
  const n = typeof x === 'number' ? x : Number(x);
  return Number.isFinite(n) ? n : 0;
}

function intOr(x, fallback = 0) {
  const n = typeof x === 'number' ? x : Number(x);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

// Resolve the reader argument (or the injected default) to a snapshot object. Never throws.
async function resolveSnapshot(reader) {
  const src = reader != null ? reader : _reader;
  try {
    let snap = src;
    if (typeof src === 'function') snap = await src();
    if (snap && typeof snap === 'object' && !Array.isArray(snap)) return snap;
  } catch {
    // reader threw — soft-fail to empty below
  }
  return null;
}

// Derive price-feed age in minutes from whatever the snapshot offers. null when unknown.
function feedAgeMin(snap, now) {
  if (snap == null) return null;
  // explicit minutes win
  if (snap.priceFeedAgeMin != null && Number.isFinite(Number(snap.priceFeedAgeMin))) {
    const m = Number(snap.priceFeedAgeMin);
    return m >= 0 ? Math.round(m) : null;
  }
  // otherwise derive from a timestamp (lastPublished.at, priceFeedAt, or feedAt)
  const at =
    (snap.lastPublished && Number(snap.lastPublished.at)) ||
    Number(snap.priceFeedAt) ||
    Number(snap.feedAt) ||
    NaN;
  if (!Number.isFinite(at) || at <= 0) return null;
  const ageMs = now - at;
  if (!Number.isFinite(ageMs) || ageMs < 0) return 0; // future stamp → treat as fresh, not negative
  return Math.round(ageMs / 60000);
}

// ── witnessStatus: snapshot → flat status (the prompt's contract) ───────────────────────────────
/**
 * Compute the flat witness status from an injected reader/snapshot. Soft-fails to a safe,
 * not-healthy status on any missing/garbage/throwing input. Never throws.
 *
 * @param {object|function|null} reader  snapshot object, or () => snapshot (sync/async)
 * @param {object} [opts]
 * @param {object} [opts.thresholds]
 * @param {() => number} [opts.now]  clock (epoch ms); defaults to Date.now
 * @returns {Promise<{account:string, producing:boolean, missedBlocks:number, lastBlock:number,
 *                    priceFeedAgeMin:number|null, healthy:boolean}>}
 */
export async function witnessStatus(reader, { thresholds = {}, now = Date.now } = {}) {
  const t = { ...DEFAULT_THRESHOLDS, ...(thresholds && typeof thresholds === 'object' ? thresholds : {}) };
  const nowMs = (() => { try { const n = Number(now()); return Number.isFinite(n) ? n : Date.now(); } catch { return Date.now(); } })();

  const snap = await resolveSnapshot(reader);

  // No snapshot at all → safe, not-healthy default.
  if (snap == null) {
    return { account: 'hathor', producing: false, missedBlocks: 0, lastBlock: 0, priceFeedAgeMin: null, healthy: false };
  }

  const account = snap.account != null ? String(snap.account) : 'hathor';
  const okRead = snap.ok !== false; // monitor sets ok:false on a failed read
  const missedBlocks = Math.max(0, intOr(snap.totalMissed));
  const lastBlock = Math.max(0, intOr(snap.lastConfirmedBlock));
  const headBlock = Math.max(0, intOr(snap.headBlock));
  const blocksBehind = Math.max(0, intOr(snap.blocksBehind, headBlock > 0 && lastBlock > 0 ? headBlock - lastBlock : 0));
  const signingDisabled = snap.signingKeyDisabled === true;
  const ageMin = feedAgeMin(snap, nowMs);

  // producing: a good read, signing enabled, and we are confirming blocks within the stall window.
  const producing = okRead && !signingDisabled && lastBlock > 0 && blocksBehind <= t.maxBlocksBehind;

  // healthy: producing AND missed within budget AND the feed is fresh (known and not stale).
  const feedFresh = ageMin != null && ageMin <= t.maxFeedAgeMin;
  const healthy = producing && missedBlocks <= t.maxMissedBlocks && feedFresh;

  return {
    account,
    producing,
    missedBlocks,
    lastBlock,
    priceFeedAgeMin: ageMin,
    healthy,
  };
}

// ── renderStatusHtml: esc()'d badge + summary for the site ──────────────────────────────────────
/**
 * Render a small HTML status card from a status object (the witnessStatus() output). Every
 * interpolated value is esc()'d. Soft-fails to a safe "unknown" card on a null/garbage status.
 *
 * @param {object} status  the witnessStatus() result
 * @returns {string} HTML
 */
export function renderStatusHtml(status) {
  const s = status && typeof status === 'object' ? status : {};
  const account = esc(s.account != null ? s.account : 'hathor');
  const producing = s.producing === true;
  const healthy = s.healthy === true;
  const missed = esc(intOr(s.missedBlocks));
  const lastBlock = esc(intOr(s.lastBlock));
  const ageMin = s.priceFeedAgeMin == null ? null : intOr(s.priceFeedAgeMin);

  const stateLabel = healthy ? 'healthy' : producing ? 'degraded' : 'down';
  const stateClass = healthy ? 'ok' : producing ? 'warn' : 'err';
  const feedText = ageMin == null ? 'price feed: unknown' : `price feed: ${esc(ageMin)} min ago`;
  const blockText = lastBlock === '0' ? 'no confirmed block' : `last block #${lastBlock}`;
  const produceText = producing ? 'producing blocks' : 'not producing';

  return [
    `<div class="witness-status witness-status--${esc(stateClass)}" data-account="${account}">`,
    `<span class="witness-status__badge">${esc(stateLabel)}</span>`,
    `<span class="witness-status__account">@${account}</span>`,
    `<ul class="witness-status__facts">`,
    `<li>${esc(produceText)}</li>`,
    `<li>${esc(blockText)}</li>`,
    `<li>missed blocks: ${missed}</li>`,
    `<li>${esc(feedText)}</li>`,
    `</ul>`,
    `</div>`,
  ].join('');
}

// ── CLI (guarded) ────────────────────────────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('witness-status-feed.mjs')) {
  const now = Date.now();
  const example = {
    account: 'hathor',
    ok: true,
    totalMissed: 0,
    lastConfirmedBlock: 123456,
    headBlock: 123458,
    blocksBehind: 2,
    signingKeyDisabled: false,
    version: '0.23.0',
    ts: now,
    lastPublished: { price: 0.42, at: now - 20 * 60000 },
  };
  const status = await witnessStatus(example, { now: () => now });
  console.log(JSON.stringify(status, null, 2));
  console.log(renderStatusHtml(status));
}
