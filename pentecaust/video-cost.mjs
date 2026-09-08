// video-cost.mjs — WHAT A MELEK VIDEO ACTUALLY COSTS. Nobody plans a rollout on a guess.
//
// The two questions that decide whether video is viable, answered with arithmetic instead of vibes:
//
//   1. HOW MANY BYTES DO WE STORE?   duration x the bitrate ladder we encode. This is paid once and
//      then every month, forever, by whoever owns the box.
//   2. HOW MANY BYTES GO OUT PER VIEWER-HOUR?  bitrate x 3600. This is paid EVERY TIME someone watches,
//      and it is the number that kills video businesses. ~2 GB per 1080p viewer-hour: a thousand people
//      watching an hour of 1080p moves two terabytes.
//
// Egress, not storage, is the real bill. One 10-minute 1080p video costs ~350 MB of disk once; a single
// viewer watching it costs ~350 MB of transfer, and the ten-thousandth viewer costs the same again.
// That asymmetry is why "who pays to keep this alive, and what happens when they stop" is the whole
// question — DTube's pinning bill was this bill.
//
// It also settles the on-chain question by computing it rather than asserting it: MELEK is 65,536 bytes
// per 4-second block = 1.42 GB/day for the ENTIRE chain (spamtest/limits.mjs CHAIN_DEFAULTS, decoded
// from the live testnet 2026-06-06). `chainDayShare` says what fraction of a full day of total chain
// capacity one video would be. For a 10-minute 1080p ladder the answer is about half a day. For one
// video. Stored forever by every witness.
//
// Pure arithmetic. No network, no fetch, no keys, no state. Soft-fails to a zeroed model, never throws.
//
//   import { estimateVideo, egressPerViewerHour, projectCost, PRICE_SCENARIOS } from './video-cost.mjs'
//   node pentecaust/video-cost.mjs 600 1080          # a 10-minute 1080p video

import { fileURLToPath } from 'node:url';
import { CHAIN_DEFAULTS } from '../spamtest/limits.mjs';

const env = (k, d) => (typeof process !== 'undefined' && process.env && process.env[k]) || d;

// ── the chain's side of the comparison (from the live testnet config, not from memory) ────────────
export const MAX_BLOCK_BYTES = Math.max(1, Number(env('MELEK_MAX_BLOCK_BYTES', CHAIN_DEFAULTS.maxTransactionSize)) || 65536);
export const BLOCK_INTERVAL_SEC = Math.max(1, Number(env('MELEK_BLOCK_INTERVAL_SEC', CHAIN_DEFAULTS.blockIntervalSec)) || 4);
export const BLOCKS_PER_DAY = Math.floor(86400 / BLOCK_INTERVAL_SEC);
/** Total bytes the WHOLE chain — every user, every op — can absorb in one day. */
export const CHAIN_BYTES_PER_DAY = MAX_BLOCK_BYTES * BLOCKS_PER_DAY;

// ── the encoding ladder ──────────────────────────────────────────────────────────────────────────
// Video bitrate in kbps by frame height, H.264 at ~30 fps. These are the conventional streaming-ladder
// numbers (the ones YouTube/Bitmovin/Apple HLS authoring guidance land on), not aspirational ones —
// a low-motion talking head comes in under, sport comes in over.
export const BITRATE_LADDER = Object.freeze({
  144: 200, 240: 400, 360: 700, 480: 1200, 720: 2500, 1080: 4500, 1440: 9000, 2160: 16000,
});
export const LADDER_HEIGHTS = Object.freeze(Object.keys(BITRATE_LADDER).map(Number).sort((a, b) => a - b));

/** Audio rides with every rendition. 128 kbps stereo AAC. */
export const AUDIO_KBPS = 128;

// Newer codecs buy real bytes at the cost of encode time and player support.
export const CODECS = Object.freeze({ h264: 1.0, vp9: 0.65, hevc: 0.6, av1: 0.5 });
export const codecFactor = (c) => CODECS[String(c || 'h264').toLowerCase()] || 1.0;

const num = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

/** The nearest ladder rung at or below `height` (so 1082 and 1080 cost the same). */
export function nearestRung(height) {
  const h = num(height, 0);
  if (h <= 0) return 0;
  let best = LADDER_HEIGHTS[0];
  for (const r of LADDER_HEIGHTS) if (r <= h) best = r;
  return h >= LADDER_HEIGHTS[LADDER_HEIGHTS.length - 1] ? LADDER_HEIGHTS[LADDER_HEIGHTS.length - 1] : best;
}

/** Total kbps (video + audio) for one rendition at `height`, for `codec`. */
export function rungKbps(height, codec = 'h264') {
  const rung = nearestRung(height);
  if (!rung) return 0;
  return Math.round(BITRATE_LADDER[rung] * codecFactor(codec)) + AUDIO_KBPS;
}

/**
 * The renditions you would actually publish for a source of this height: the source rung plus the
 * rungs below it, newest-first, capped at `max` (4 is the usual working ladder). A single-rendition
 * publish is `{ ladder:false }` — cheapest to store, worst on a phone connection.
 */
export function ladderFor(height, { max = 4, single = false } = {}) {
  const top = nearestRung(height);
  if (!top) return [];
  if (single) return [top];
  const rungs = LADDER_HEIGHTS.filter((h) => h <= top).sort((a, b) => b - a);
  return rungs.slice(0, clamp(Math.round(num(max, 4)), 1, LADDER_HEIGHTS.length));
}

// ── STORAGE ──────────────────────────────────────────────────────────────────────────────────────
/**
 * estimateVideo — bytes on disk for one video, and what that is against the chain.
 * @param {{durationSec:number, height?:number, heights?:number[], codec?:string, single?:boolean, ladderMax?:number}} o
 * @returns {{ durationSec, codec, renditions:[{height,kbps,bytes,gb}], storageBytes, storageGb,
 *             chainDayShare, chainDays, note }}
 * Total: bad input gives a zeroed model, never a throw.
 */
export function estimateVideo(o = {}) {
  const durationSec = Math.max(0, num(o.durationSec ?? o.duration, 0));
  const codec = String(o.codec || 'h264').toLowerCase();
  const heights = Array.isArray(o.heights) && o.heights.length
    ? o.heights.map(nearestRung).filter(Boolean)
    : ladderFor(o.height ?? 1080, { max: o.ladderMax, single: o.single });
  const renditions = [];
  let storageBytes = 0;
  for (const h of Array.from(new Set(heights)).sort((a, b) => b - a)) {
    const kbps = rungKbps(h, codec);
    const bytes = Math.round((kbps * 1000 / 8) * durationSec);
    storageBytes += bytes;
    renditions.push({ height: h, kbps, bytes, gb: bytes / 1e9 });
  }
  const chainDayShare = CHAIN_BYTES_PER_DAY > 0 ? storageBytes / CHAIN_BYTES_PER_DAY : 0;
  return {
    durationSec,
    codec,
    renditions,
    storageBytes,
    storageGb: storageBytes / 1e9,
    // What this ONE video would be as a fraction of a full day of TOTAL chain capacity, if the bytes
    // went on-chain. This is the number that ends the "can we put video on the chain" conversation.
    chainDayShare,
    chainDays: chainDayShare,
    note: `${MAX_BLOCK_BYTES} bytes / ${BLOCK_INTERVAL_SEC}s block = ${(CHAIN_BYTES_PER_DAY / 1e9).toFixed(2)} GB/day for the entire chain`,
  };
}

// ── EGRESS — the bill that scales with success ───────────────────────────────────────────────────
/** Bytes transferred per hour watched at `height`. THE number: ~2.08 GB for 1080p H.264. */
export function egressPerViewerHour(height = 1080, codec = 'h264') {
  return Math.round((rungKbps(height, codec) * 1000 / 8) * 3600);
}

/** Bytes transferred for `viewerHours` hours watched at `height`. */
export function egressBytes({ viewerHours = 0, height = 1080, codec = 'h264' } = {}) {
  return Math.round(egressPerViewerHour(height, codec) * Math.max(0, num(viewerHours, 0)));
}

// ── PRICES ───────────────────────────────────────────────────────────────────────────────────────
// Three honest scenarios. The operator runs the boxes, so `ownBox` is the default: a dedicated server
// with a bandwidth allowance and ~EUR 1/TB overage. `bigCloud` is there to show what NOT to do — S3-class
// egress makes video a straight loss at any scale that matters.
export const PRICE_SCENARIOS = Object.freeze({
  ownBox: { label: 'Own boxes (dedicated + bandwidth allowance)', storageUsdPerGbMonth: 0.002, egressUsdPerGb: 0.001 },
  cheapCloud: { label: 'Budget object store / CDN', storageUsdPerGbMonth: 0.005, egressUsdPerGb: 0.01 },
  bigCloud: { label: 'S3-class (do not serve video from here)', storageUsdPerGbMonth: 0.023, egressUsdPerGb: 0.085 },
});

/** Resolve a price set: a scenario name, an explicit object, or the env/default. */
export function prices(p) {
  if (p && typeof p === 'object') {
    return {
      label: String(p.label || 'custom'),
      storageUsdPerGbMonth: Math.max(0, num(p.storageUsdPerGbMonth, PRICE_SCENARIOS.ownBox.storageUsdPerGbMonth)),
      egressUsdPerGb: Math.max(0, num(p.egressUsdPerGb, PRICE_SCENARIOS.ownBox.egressUsdPerGb)),
    };
  }
  const name = String(p || env('MELEK_VIDEO_PRICES', 'ownBox'));
  const s = PRICE_SCENARIOS[name] || PRICE_SCENARIOS.ownBox;
  return { ...s };
}

// ── THE PROJECTION ───────────────────────────────────────────────────────────────────────────────
/**
 * projectCost — one video's storage + egress bill.
 * @param {{durationSec:number, height?:number, heights?:number[], codec?:string, single?:boolean,
 *          views?:number, watchFraction?:number, viewerHours?:number, months?:number,
 *          serveHeight?:number, prices?:string|object}} o
 *
 * `views` x `watchFraction` x duration gives viewer-hours when you think in views; pass `viewerHours`
 * directly if you already have the number. `serveHeight` is what people actually WATCH at (default: the
 * top rung) — dropping the default rendition to 720p is the single biggest lever on the egress bill.
 * Total: never throws.
 */
export function projectCost(o = {}) {
  const est = estimateVideo(o);
  const p = prices(o.prices);
  const months = Math.max(0, num(o.months, 12));
  const codec = est.codec;
  const serveHeight = nearestRung(o.serveHeight ?? (est.renditions[0] ? est.renditions[0].height : 1080));

  const viewerHours = o.viewerHours != null
    ? Math.max(0, num(o.viewerHours, 0))
    : Math.max(0, num(o.views, 0)) * clamp(num(o.watchFraction, 0.5), 0, 1) * (est.durationSec / 3600);

  const perViewerHourBytes = egressPerViewerHour(serveHeight, codec);
  const egress = Math.round(perViewerHourBytes * viewerHours);

  const storageUsd = est.storageGb * p.storageUsdPerGbMonth * months;
  const egressUsd = (egress / 1e9) * p.egressUsdPerGb;

  return {
    ...est,
    prices: p,
    months,
    serveHeight,
    viewerHours,
    egressPerViewerHourBytes: perViewerHourBytes,
    egressPerViewerHourGb: perViewerHourBytes / 1e9,
    egressBytes: egress,
    egressGb: egress / 1e9,
    storageUsd,
    egressUsd,
    totalUsd: storageUsd + egressUsd,
    usdPerViewerHour: (perViewerHourBytes / 1e9) * p.egressUsdPerGb,
    // How many hours of watching one dollar of egress budget buys. The rollout-planning number.
    viewerHoursPerUsd: p.egressUsdPerGb > 0 ? 1 / ((perViewerHourBytes / 1e9) * p.egressUsdPerGb) : Infinity,
  };
}

// ── SANITY-CHECK A POST'S CLAIM ──────────────────────────────────────────────────────────────────
/**
 * A post claims a filesize and a duration. Back out the implied bitrate and say whether it is plausible
 * for the claimed resolution. Catches a truncated upload, a mislabelled resolution, and a post whose
 * numbers were invented. Returns { ok, impliedKbps, expectedKbps, ratio, verdict } — never throws.
 */
export function checkClaim({ filesizeBytes = 0, durationSec = 0, height = 0, codec = 'h264' } = {}) {
  const bytes = Math.max(0, num(filesizeBytes, 0));
  const dur = Math.max(0, num(durationSec, 0));
  const expectedKbps = rungKbps(height, codec);
  if (!bytes || !dur || !expectedKbps) {
    return { ok: false, impliedKbps: 0, expectedKbps, ratio: 0, verdict: 'not enough numbers to check' };
  }
  const impliedKbps = Math.round((bytes * 8) / dur / 1000);
  const ratio = impliedKbps / expectedKbps;
  let verdict = 'plausible';
  let ok = true;
  if (ratio < 0.15) { ok = false; verdict = `only ${impliedKbps} kbps for ${nearestRung(height)}p — truncated upload, or the resolution is mislabelled`; }
  else if (ratio < 0.4) verdict = `low bitrate for ${nearestRung(height)}p (${impliedKbps} kbps) — heavy compression or a still-frame video`;
  else if (ratio > 4) { ok = false; verdict = `${impliedKbps} kbps is far above a ${nearestRung(height)}p ladder — a mezzanine/master file, not a delivery encode`; }
  else if (ratio > 2) verdict = `high bitrate (${impliedKbps} kbps) — worth re-encoding before it is served`;
  return { ok, impliedKbps, expectedKbps, ratio, verdict };
}

// ── presentation ─────────────────────────────────────────────────────────────────────────────────
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));
const gb = (bytes) => `${(num(bytes, 0) / 1e9).toFixed(bytes < 1e9 ? 3 : 2)} GB`;
const usd = (n) => `$${num(n, 0).toFixed(num(n, 0) < 1 ? 4 : 2)}`;

/** Plain-text lines for a CLI / a log / a brief. */
export function describeCost(model) {
  const m = model || {};
  const lines = [];
  lines.push(`duration ${Math.round(num(m.durationSec, 0))}s · codec ${esc(m.codec || 'h264')} · prices: ${esc((m.prices || {}).label || 'n/a')}`);
  for (const r of (m.renditions || [])) lines.push(`  ${String(r.height).padStart(4)}p  ${String(r.kbps).padStart(6)} kbps  ${gb(r.bytes).padStart(10)}`);
  lines.push(`  STORAGE   ${gb(m.storageBytes)}  (${(num(m.chainDayShare, 0) * 100).toFixed(1)}% of a FULL DAY of total chain capacity — this is why the bytes are off-chain)`);
  if (m.egressPerViewerHourBytes != null) {
    lines.push(`  EGRESS    ${gb(m.egressPerViewerHourBytes)} per viewer-hour at ${m.serveHeight}p  →  ${usd(m.usdPerViewerHour)}/viewer-hour`);
    lines.push(`            ${Math.round(num(m.viewerHours, 0))} viewer-hours = ${gb(m.egressBytes)} = ${usd(m.egressUsd)}`);
    lines.push(`  TOTAL     ${usd(m.totalUsd)} (storage ${usd(m.storageUsd)} over ${m.months} months + egress ${usd(m.egressUsd)})`);
    lines.push(`            $1 of egress buys ${Math.round(num(m.viewerHoursPerUsd, 0))} viewer-hours`);
  }
  lines.push(`  ${esc(m.note || '')}`);
  return lines;
}

/** An escaped HTML panel — used by the media hub so a planner sees the bill next to the player. */
export function renderCostPanel(model) {
  const m = model || {};
  const rows = (m.renditions || []).map((r) =>
    `<tr><td>${esc(r.height)}p</td><td>${esc(r.kbps)} kbps</td><td>${esc(gb(r.bytes))}</td></tr>`).join('');
  return `<section class="video-cost"><h3>What this costs to serve</h3>`
    + `<table class="cost-table"><thead><tr><th>rendition</th><th>bitrate</th><th>storage</th></tr></thead>`
    + `<tbody>${rows}</tbody></table>`
    + `<p class="cost-line"><b>Storage:</b> ${esc(gb(m.storageBytes))} once, then every month.`
    + ` That is <b>${esc((num(m.chainDayShare, 0) * 100).toFixed(1))}%</b> of a full day of total MELEK chain capacity —`
    + ` which is why the bytes live off-chain and only the reference goes on it.</p>`
    + (m.egressPerViewerHourBytes != null
      ? `<p class="cost-line"><b>Egress:</b> ${esc(gb(m.egressPerViewerHourBytes))} per viewer-hour at ${esc(m.serveHeight)}p`
        + ` (${esc(usd(m.usdPerViewerHour))} at ${esc((m.prices || {}).label || '')}).`
        + ` A thousand viewer-hours moves ${esc(gb(num(m.egressPerViewerHourBytes, 0) * 1000))}.`
        + ` Storage is paid once; <b>egress is paid every single time somebody watches</b>.</p>`
      : '')
    + `<p class="data-note">${esc(m.note || '')}</p></section>`;
}

// ── CLI (guarded) — `node pentecaust/video-cost.mjs 600 1080 [views]` ─────────────────────────────
if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  const durationSec = Number(process.argv[2] || 600);
  const height = Number(process.argv[3] || 1080);
  const views = Number(process.argv[4] || 1000);
  console.log(`MELEK video cost — ${durationSec}s at ${height}p, ${views} views @ 50% watched`);
  console.log('─'.repeat(78));
  for (const scenario of ['ownBox', 'cheapCloud', 'bigCloud']) {
    const m = projectCost({ durationSec, height, views, watchFraction: 0.5, months: 12, prices: scenario });
    console.log(`[${scenario}]`);
    for (const l of describeCost(m)) console.log(l);
    console.log('');
  }
  const single = projectCost({ durationSec, height, views, watchFraction: 0.5, single: true });
  console.log(`single-rendition (no ladder): storage ${(single.storageGb).toFixed(3)} GB vs ladder`
    + ` ${(projectCost({ durationSec, height }).storageGb).toFixed(3)} GB`);
}
