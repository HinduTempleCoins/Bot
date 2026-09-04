// pentecaust/herald/deliverability-hud.mjs — Herald DELIVERABILITY HUD.
// A per-domain/inbox sending board on top of the shipped compliance substrate: for each row
// {domain, sent, bounces, complaints, warmupDay} it grades health (bounce <2%, complaint <0.3%),
// shows the warmup ramp cap, and renders an escaped green/amber/red board + a fleet summary.
//   import { hudRow, buildHud, renderHud, summary } from './deliverability-hud.mjs'
//
// Reuses compliance.mjs deliverabilityHealth + warmupCap verbatim — one source of truth for the thresholds.
// House rules: ESM, esc() all interpolation, soft-fail (never throw), pure/offline, unit-testable.

import { deliverabilityHealth, warmupCap, esc } from './compliance.mjs';

const num = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };

// status → traffic-light band. compliance status is one of ok | throttle | stop.
const BANDS = {
  ok: { light: 'green', label: 'GO', color: '#1a7f37', bg: '#e6f4ea' },
  throttle: { light: 'amber', label: 'THROTTLE', color: '#9a6700', bg: '#fff8e1' },
  stop: { light: 'red', label: 'STOP', color: '#b42318', bg: '#fde8e6' },
};
const bandFor = (status) => BANDS[status] || BANDS.stop;

/** hudRow — grade one domain/inbox row. Never throws; unknown fields default to 0. */
export function hudRow(row = {}) {
  const domain = String(row.domain == null ? '(unknown)' : row.domain);
  const sent = Math.max(0, num(row.sent));
  const bounces = Math.max(0, num(row.bounces));
  const complaints = Math.max(0, num(row.complaints));
  const warmupDay = Math.max(0, Math.floor(num(row.warmupDay)));
  const health = deliverabilityHealth({ sent, bounces, complaints });
  const dailyCap = warmupCap(warmupDay); // ramp start=10 → max=50 over 28d
  const warming = warmupDay < 28;
  const band = bandFor(health.status);
  return {
    domain, sent, bounces, complaints, warmupDay, warming, dailyCap,
    bounceRate: health.bounceRate,
    complaintRate: health.complaintRate,
    status: health.status,           // ok | throttle | stop
    light: band.light,               // green | amber | red
    reasons: health.reasons,
  };
}

/** buildHud — grade a whole fleet. Accepts an array (or anything → empty). */
export function buildHud(rows) {
  const list = Array.isArray(rows) ? rows : [];
  return list.map(hudRow);
}

/** summary — fleet-level counts by disposition. Accepts raw rows or already-graded rows. */
export function summary(rows) {
  const graded = (Array.isArray(rows) ? rows : []).map((r) =>
    (r && typeof r.status === 'string' && 'light' in r) ? r : hudRow(r || {}));
  const out = { total: graded.length, ok: 0, throttle: 0, stop: 0, warming: 0, sent: 0 };
  for (const r of graded) {
    if (r.status === 'ok') out.ok++;
    else if (r.status === 'throttle') out.throttle++;
    else out.stop++;
    if (r.warming) out.warming++;
    out.sent += num(r.sent);
  }
  return out;
}

const pct = (r) => `${(num(r) * 100).toFixed(2)}%`;

/** renderHud — an escaped HTML board, one card per domain, plus a summary bar. Pure string, no DOM. */
export function renderHud(rows) {
  const graded = buildHud(rows);
  const sum = summary(graded);
  const cards = graded.map((r) => {
    const band = bandFor(r.status);
    const reason = r.reasons.length ? esc(r.reasons.join('; ')) : (r.warming ? `warming: day ${r.warmupDay}/28` : 'within limits');
    const warmBadge = r.warming ? `<span class="warm">warmup ${esc(r.warmupDay)}/28</span>` : '';
    return `<div class="dh-card" data-light="${esc(band.light)}" style="background:${band.bg};border-left:4px solid ${band.color}">
  <div class="dh-head"><span class="dh-dot" style="background:${band.color}"></span><strong>${esc(r.domain)}</strong>${warmBadge}<span class="dh-tag" style="color:${band.color}">${esc(band.label)}</span></div>
  <div class="dh-stats">sent ${esc(r.sent)} · bounce ${esc(pct(r.bounceRate))} · complaint ${esc(pct(r.complaintRate))} · cap ${esc(r.dailyCap)}/day</div>
  <div class="dh-reason">${reason}</div>
</div>`;
  }).join('\n');

  const board = graded.length ? cards : `<div class="dh-empty">No sending domains to show.</div>`;
  return `<section class="deliverability-hud">
  <div class="dh-summary">
    <span class="dh-pill" data-light="green">GO ${esc(sum.ok)}</span>
    <span class="dh-pill" data-light="amber">THROTTLE ${esc(sum.throttle)}</span>
    <span class="dh-pill" data-light="red">STOP ${esc(sum.stop)}</span>
    <span class="dh-pill">warming ${esc(sum.warming)}</span>
    <span class="dh-pill">${esc(sum.total)} domains · ${esc(sum.sent)} sent</span>
  </div>
  <div class="dh-board">
${board}
  </div>
</section>`;
}

// CLI: print the board for a tiny sample so the surface is eyeball-testable.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const sample = [
    { domain: 'go.pentecaust.com', sent: 1000, bounces: 5, complaints: 1, warmupDay: 40 },
    { domain: 'mail.melek.salon', sent: 400, bounces: 8, complaints: 1, warmupDay: 10 },
    { domain: 'blast.example.com', sent: 500, bounces: 20, complaints: 3, warmupDay: 60 },
  ];
  console.log(renderHud(sample));
  console.log('\nSUMMARY', JSON.stringify(summary(sample)));
}
