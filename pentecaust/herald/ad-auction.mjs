// pentecaust/herald/ad-auction.mjs — Herald AD-SPACE AUCTIONS: sell PREMIUM featured ad slots by sealed-bid
// second-price (Vickrey) auction. The operator direction (MEMORY revenue-launch-and-herald-ad-network,
// 2026-08-24): "sell premium ad placements by AUCTION … advertisers bid for featured slots on our surfaces;
// remnant inventory runs on the click-based ad network." This is the auction house side; ad-network.mjs is
// the remnant/click side.
//
// THE MOAT IS PRESERVED (ad-network.mjs §select, affiliate.assertRankingUnbiased): auctions apply ONLY to
// slots explicitly typed `premium` — a segregated, labeled, FTC-disclosed featured unit that is NEVER
// interleaved into organic ranking. Organic ranking can never be bought. A non-premium slot is refused.
//
// Second-price (Vickrey) by design: the winner is the highest bid but PAYS the second-highest (or the
// reserve, whichever is greater). This is the standard incentive-compatible ad-slot mechanism — advertisers
// bid their true value; it also caps what the top bidder overpays. Deterministic tie-break (earliest bid,
// then bidder id) so the outcome is reproducible and testable offline.
//
// SETTLEMENT IS DESIGN-ONLY (BRIEF.md §7, HERALD.md, ad-network.mjs): this module COUNTS + ATTRIBUTES the
// clearing price into an accrual ledger. No funds move, nothing is escrowed for real, nothing is signed or
// broadcast. A real charge is an external-fiat / Signer step downstream.
//
// House style: ESM .mjs, esc() all interpolation, injectable storage/clock, offline, soft-fail-never-throw,
// handler(req,res) exported, CLI guarded.
//
//   import { createAdAuction } from './ad-auction.mjs';
//   const a = createAdAuction({ storage, now });
//   a.openAuction({ id:'home-hero', slotType:'premium', reserve:1.00, closesAt: t0+3600e3 });
//   a.placeBid({ auctionId:'home-hero', advertiserId:'acme', amount:5, creative:{...} });
//   a.placeBid({ auctionId:'home-hero', advertiserId:'globex', amount:3 });
//   a.settle('home-hero', now);   // → { winner:'acme', clearingPrice:3 (2nd price), … } design-only accrual
//   a.serve('home-hero');         // → disclosed premium unit HTML for the won slot (/go/{code} click-through)

import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';

const envv = (k, d) => (typeof process !== 'undefined' && process.env && process.env[k]) || d;

export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const MAX_FIELD = 300;
const clean = (s) => String(s == null ? '' : s).trim();
const clamp = (s, n = MAX_FIELD) => clean(s).slice(0, n);
const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const isId = (s) => ID_RE.test(clean(s).toLowerCase());
const toNum = (v) => { const n = Number(v); return Number.isFinite(n) ? n : NaN; };
const money = (n) => Math.round(Number(n) * 1e4) / 1e4; // 4dp, avoids float drift
const BASE_URL = () => (envv('BASE_URL', 'https://melek.salon') || 'https://melek.salon').replace(/\/$/, '');

// Only `premium` (featured, segregated, labeled) slots can be auctioned. Anything else is refused so the
// organic-ranking moat can never be bought around.
const AUCTIONABLE = new Set(['premium']);

function normStore(storage) {
  const s = storage && typeof storage === 'object' ? storage : {};
  if (!s.auctions || typeof s.auctions !== 'object') s.auctions = {};
  if (!s.accrual || typeof s.accrual !== 'object') s.accrual = {}; // clearing-price ledger — design-only
  return s;
}

export function createAdAuction(opts = {}) {
  const store = normStore(opts.storage);
  const clock = typeof opts.now === 'function' ? opts.now : () => Date.now();
  const ts = () => { const n = toNum(clock()); return Number.isFinite(n) ? n : 0; };

  // ── open an auction for one premium slot ────────────────────────────────────────────────────────────────
  function openAuction(input) {
    if (!input || typeof input !== 'object') return { ok: false, reason: 'auction spec object required' };
    const id = clean(input.id).toLowerCase();
    if (!isId(id)) return { ok: false, reason: 'auction id (a-z 0-9 -, ≤64) required' };
    const slotType = clean(input.slotType || 'premium').toLowerCase();
    if (!AUCTIONABLE.has(slotType)) return { ok: false, reason: `slotType must be premium (auctions never touch organic ranking) — got "${esc(slotType)}"` };
    if (store.auctions[id] && store.auctions[id].status !== 'draft') return { ok: false, reason: 'auction id already exists' };
    const reserve = Math.max(0, money(toNum(input.reserve) || 0));
    const opened = ts();
    const closesAt = Number.isFinite(toNum(input.closesAt)) ? toNum(input.closesAt) : (opened + 24 * 3600e3);
    const rec = {
      id,
      slotType,
      publisherId: clean(input.publisherId).toLowerCase() || null,
      reserve,
      openedAt: opened,
      closesAt,
      status: 'open',
      bids: [],
      result: null,
    };
    store.auctions[id] = rec;
    return { ok: true, auction: publicAuction(rec) };
  }

  // ── place a sealed bid ──────────────────────────────────────────────────────────────────────────────────
  function placeBid(input) {
    if (!input || typeof input !== 'object') return { ok: false, reason: 'bid spec object required' };
    const auctionId = clean(input.auctionId).toLowerCase();
    const a = store.auctions[auctionId];
    if (!a) return { ok: false, reason: 'no such auction' };
    if (a.status !== 'open') return { ok: false, reason: `auction is ${esc(a.status)}, not open` };
    const now = ts();
    if (Number.isFinite(a.closesAt) && now >= a.closesAt) return { ok: false, reason: 'auction has closed' };
    const advertiserId = clean(input.advertiserId).toLowerCase();
    if (!isId(advertiserId)) return { ok: false, reason: 'advertiser id (a-z 0-9 -, ≤64) required' };
    const amount = money(toNum(input.amount));
    if (!Number.isFinite(amount) || amount <= 0) return { ok: false, reason: 'bid amount must be a positive number' };
    if (amount < a.reserve) return { ok: false, reason: `bid below reserve (${a.reserve})` };
    // sealed: a bidder's latest bid replaces their earlier one (no bid history leakage between bidders).
    const creative = sanitizeCreative(input.creative);
    const existing = a.bids.findIndex((b) => b.advertiserId === advertiserId);
    const bid = { advertiserId, amount, creative, at: now, seq: a.bids.length };
    if (existing >= 0) { bid.seq = a.bids[existing].seq; a.bids[existing] = bid; }
    else a.bids.push(bid);
    return { ok: true, bidId: advertiserId, accepted: true, bidCount: a.bids.length };
  }

  function sanitizeCreative(c) {
    const cr = c && typeof c === 'object' ? c : {};
    const code = clean(cr.code).toLowerCase();
    return {
      code: isId(code) ? code : '',
      headline: clamp(cr.headline, 200),
      body: clamp(cr.body, 500),
    };
  }

  /**
   * settle(auctionId, now?) — close the auction and compute the SECOND-PRICE outcome. Winner = highest bid;
   * clearingPrice = max(second-highest bid, reserve). One bid → pays the reserve. Deterministic tie-break:
   * earliest `at`, then lexical advertiserId. Records a design-only accrual (no funds move). Idempotent —
   * a settled auction returns its stored result.
   */
  function settle(auctionId, now) {
    const id = clean(auctionId).toLowerCase();
    const a = store.auctions[id];
    if (!a) return { ok: false, reason: 'no such auction' };
    if (a.status === 'settled' && a.result) return { ok: true, ...a.result, alreadySettled: true };
    a.status = 'settled';
    a.settledAt = Number.isFinite(toNum(now)) ? toNum(now) : ts();

    if (!a.bids.length) {
      a.result = { auctionId: id, winner: null, clearingPrice: 0, reason: 'no-bids' };
      return { ok: true, ...a.result };
    }
    // Sort by amount desc; tie-break earliest bid, then bidder id (stable, reproducible).
    const ranked = a.bids.slice().sort((x, y) =>
      (y.amount - x.amount) || (x.at - y.at) || (x.advertiserId < y.advertiserId ? -1 : x.advertiserId > y.advertiserId ? 1 : 0));
    const win = ranked[0];
    const second = ranked[1] ? ranked[1].amount : 0;
    const clearingPrice = money(Math.max(second, a.reserve));

    const ledger = {
      auctionId: id,
      winner: win.advertiserId,
      winningBid: win.amount,
      clearingPrice,                 // what the winner is billed — SECOND price, design-only
      secondBid: second,
      reserve: a.reserve,
      bidCount: a.bids.length,
      publisherId: a.publisherId,
      settlement: 'design-only (no funds move — BRIEF.md §7; a real charge is an external/Signer step)',
      settledAt: a.settledAt,
    };
    store.accrual[id] = ledger;
    a.result = { auctionId: id, winner: win.advertiserId, clearingPrice, winningBid: win.amount, secondBid: second, code: win.creative.code || null };
    a.winningCreative = win.creative;
    return { ok: true, ...a.result };
  }

  // ── serve the won premium unit (disclosed, /go/{code} click-through) ─────────────────────────────────────
  function serve(auctionId) {
    const id = clean(auctionId).toLowerCase();
    const a = store.auctions[id];
    if (!a) return { ok: false, reason: 'no such auction' };
    if (a.status !== 'settled') return { ok: false, reason: 'auction not settled' };
    if (!a.result || !a.result.winner) return { ok: false, reason: 'no winner to serve' };
    const cr = a.winningCreative || {};
    const href = `${BASE_URL()}/go/${esc(clean(cr.code).toLowerCase())}`;
    const html =
      `<div class="herald-ad herald-premium" data-auction="${esc(id)}" data-sponsored="true">`
      + `<span class="ad-badge" aria-label="sponsored">Sponsored · Featured</span>`
      + `<a class="ad-cta" href="${cr.code ? href : esc(BASE_URL())}" rel="sponsored nofollow noopener" target="_blank">`
      + `<span class="ad-headline">${esc(cr.headline || 'Featured offer')}</span>`
      + (cr.body ? `<span class="ad-body">${esc(cr.body)}</span>` : '')
      + `</a>`
      + `<span class="ad-disclosure">Sponsored — a paid, clearly-labeled placement.</span>`
      + `</div>`;
    return { ok: true, slot: 'premium', winner: a.result.winner, html };
  }

  const publicAuction = (a) => ({
    id: a.id, slotType: a.slotType, publisherId: a.publisherId, reserve: a.reserve,
    openedAt: a.openedAt, closesAt: a.closesAt, status: a.status, bidCount: a.bids.length,
    result: a.result ? { ...a.result } : null,
  });
  const getAuction = (id) => { const a = store.auctions[clean(id).toLowerCase()]; return a ? publicAuction(a) : null; };
  const listAuctions = () => Object.values(store.auctions).map(publicAuction);
  const accrualFor = (id) => { const l = store.accrual[clean(id).toLowerCase()]; return l ? { ...l } : null; };

  // ── HTTP surface (read-only over HTTP; opening/bidding/settling are lib calls / authed elsewhere) ─────────
  const sendJson = (res, sc, obj) => {
    try { res.writeHead(sc, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); } catch {}
    try { res.end(JSON.stringify(obj)); } catch {}
  };
  const sendHtml = (res, sc, html) => {
    try { res.writeHead(sc, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }); } catch {}
    try { res.end(html == null ? '' : html); } catch {}
  };

  async function handler(req, res) {
    try {
      const method = ((req && req.method) || 'GET').toUpperCase();
      const rawUrl = String((req && req.url) || '/');
      const qi = rawUrl.indexOf('?');
      const path = (qi >= 0 ? rawUrl.slice(0, qi) : rawUrl).replace(/\/+$/, '') || '/';
      const query = new URLSearchParams(qi >= 0 ? rawUrl.slice(qi + 1) : '');

      if (path === '/health' && method === 'GET') {
        return sendJson(res, 200, { ok: true, service: 'herald-ad-auction', auctions: Object.keys(store.auctions).length });
      }
      if (path === '/api/auctions' && method === 'GET') {
        return sendJson(res, 200, { ok: true, auctions: listAuctions() });
      }
      if (path === '/ad/premium' && method === 'GET') {
        const r = serve(query.get('auction') || '');
        if (!r.ok) return sendHtml(res, 200, `<!-- herald-auction: ${esc(r.reason)} -->`);
        return sendHtml(res, 200, r.html);
      }
      return sendJson(res, 404, { ok: false, reason: 'not-found' });
    } catch { return sendJson(res, 500, { ok: false, reason: 'error' }); }
  }

  return { openAuction, placeBid, settle, serve, getAuction, listAuctions, accrualFor, handler, store };
}

// ── CLI (guarded) — demo a two-bidder second-price auction against an in-memory store, no network ───────────
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const a = createAdAuction({ now: () => 1_000_000 });
  a.openAuction({ id: 'home-hero', slotType: 'premium', reserve: 1, closesAt: 2_000_000 });
  a.placeBid({ auctionId: 'home-hero', advertiserId: 'acme', amount: 5, creative: { code: 'acme-01', headline: 'Try Acme' } });
  a.placeBid({ auctionId: 'home-hero', advertiserId: 'globex', amount: 3 });
  const result = a.settle('home-hero', 2_000_001);
  const served = a.serve('home-hero');
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ result, accrual: a.accrualFor('home-hero'), served: { ok: served.ok, winner: served.winner } }, null, 2));
}
