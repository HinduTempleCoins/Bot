// integrations/calendar.mjs — the shared MELEK ecosystem CALENDAR / events module.
//
// ONE calendar that aggregates events across the ecosystem's surfaces — Seeds/Farm, GTArcade, MELEK
// (chain/social), SoapBox — plus the "First Harvest — Founders' Season" schedule (source:'harvest',
// see .local/HARVEST_FOUNDERS_SEASON_SCHEMA.md). It is a pure off-chain aggregator + read/query layer:
// no network, no wall-clock in asserted logic (the clock is injected), no randomness.
//
// Factory shape (matches the herald injectable-storage + soft-fail-never-throw discipline):
//
//   import { createCalendar } from './calendar.mjs'
//   const cal = createCalendar({ storage, now });   // storage = in-memory {events:[]}, now = () => ms
//   cal.addEvent({ title, start, end, source, category, url, allDay })
//   cal.events({ from, to, source, category })      // filtered + sorted-by-start
//   cal.upcoming(n, { source })                     // next n from the injected clock
//   cal.day(dateMs) / cal.month(year, month) / cal.agenda(fromMs, days)
//   cal.recurring({ title, source, everyDays, count, start, ... })
//   cal.seedHarvestSeason(year)                     // the 6 Founders'-Season events
//   cal.renderAgenda(events)                        // esc-safe HTML
//   cal.handler(req,res)                            // GET /api/events, POST /api/event, /health
//
//   PORT=8170 node integrations/calendar.mjs        # tiny demo server (default in-memory store)

import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';

// ── small pure helpers ────────────────────────────────────────────────────────────────────────────────
const clean = (s) => String(s == null ? '' : s).trim();
export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const DAY_MS = 86400000;

// The five aggregated sources. Anything else falls back to 'melek' (never rejected on source alone).
export const SOURCES = ['seeds-farm', 'gtarcade', 'melek', 'soapbox', 'harvest'];

/** Parse a ms-timestamp (number or all-digit string) or an ISO date string → ms. NaN on failure. */
export function toMs(v) {
  if (v == null || v === '') return NaN;
  if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
  const s = String(v).trim();
  if (/^-?\d+$/.test(s)) { const n = Number(s); return Number.isFinite(n) ? n : NaN; }
  const p = Date.parse(s); // ISO / date-only are spec-deterministic (UTC) — no wall-clock involved
  return Number.isFinite(p) ? p : NaN;
}

/** ms → 'YYYY-MM-DD' in UTC (deterministic; used for grouping + rendering). '' on bad input. */
export function ymd(ms) {
  if (!Number.isFinite(ms)) return '';
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}

// Floor a ms timestamp to UTC midnight of its day.
const dayFloor = (ms) => Math.floor(ms / DAY_MS) * DAY_MS;

// ── the factory ─────────────────────────────────────────────────────────────────────────────────────────
export function createCalendar({ storage, now } = {}) {
  // In-memory store by default; an injected {events:[]} is used (and mutated) as-is so tests can inspect it.
  const store = storage && Array.isArray(storage.events) ? storage : { events: [] };
  const clock = typeof now === 'function' ? now : () => Date.now();

  // Deterministic id: index + injected clock (NO Math.random) — reproducible under a fixed now().
  function makeId() {
    const base = `evt-${store.events.length + 1}-${clock()}`;
    if (!store.events.some((e) => e.id === base)) return base;
    for (let i = 2; i < 100000; i++) { const id = `${base}-${i}`; if (!store.events.some((e) => e.id === id)) return id; }
    return base;
  }

  function normSource(s) {
    const v = clean(s).toLowerCase();
    return SOURCES.includes(v) ? v : 'melek';
  }

  /** Add one event. Validates title + start; soft-fails (no throw) with a shaped {ok:false,reason}. */
  function addEvent(input = {}) {
    try {
      const src = input && typeof input === 'object' ? input : {};
      const title = clean(src.title);
      if (!title) return { ok: false, reason: 'title required' };
      const start = toMs(src.start);
      if (!Number.isFinite(start)) return { ok: false, reason: 'invalid start' };
      let end = toMs(src.end);
      if (!Number.isFinite(end) || end < start) end = start; // default/repair end
      const ev = {
        id: clean(src.id) || makeId(),
        title,
        start,
        end,
        source: normSource(src.source),
        category: clean(src.category) || 'community',
        url: clean(src.url),
        allDay: !!src.allDay,
        createdAt: clock(),
      };
      if (store.events.some((e) => e.id === ev.id)) return { ok: false, reason: 'duplicate id' };
      store.events.push(ev);
      return { ok: true, event: ev };
    } catch (e) {
      return { ok: false, reason: 'error' };
    }
  }

  /** All events, filtered by {from,to,source,category} and sorted ascending by start. Never throws. */
  function events({ from, to, source, category } = {}) {
    try {
      const lo = Number.isFinite(toMs(from)) ? toMs(from) : -Infinity;
      const hi = Number.isFinite(toMs(to)) ? toMs(to) : Infinity;
      const src = source ? normSource(source) : null;
      const cat = category ? clean(category) : null;
      return store.events
        .filter((e) => e && e.end >= lo && e.start <= hi)     // range-overlap
        .filter((e) => (src ? e.source === src : true))
        .filter((e) => (cat ? e.category === cat : true))
        .slice()
        .sort((a, b) => (a.start - b.start) || (a.end - b.end));
    } catch { return []; }
  }

  /** Next n events at/after the injected clock (by start). Optional {source} filter. Never throws. */
  function upcoming(n, { source } = {}) {
    try {
      const cap = Math.max(0, Math.floor(Number(n)) || 0);
      const t = clock();
      const list = events({ source }).filter((e) => e.end >= t);
      return cap ? list.slice(0, cap) : list;
    } catch { return []; }
  }

  /** Events overlapping the UTC day containing dateMs. Never throws. */
  function day(dateMs) {
    const ms = toMs(dateMs);
    if (!Number.isFinite(ms)) return [];
    const lo = dayFloor(ms);
    return events({ from: lo, to: lo + DAY_MS - 1 });
  }

  /** Events overlapping a calendar month. month is 1-based (1=Jan). Never throws. */
  function month(year, mon) {
    const y = Math.floor(Number(year));
    const m = Math.floor(Number(mon));
    if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) return [];
    const lo = Date.UTC(y, m - 1, 1);
    const hi = Date.UTC(y, m, 1) - 1;
    return events({ from: lo, to: hi });
  }

  /** Grouped-by-day agenda: fromMs floored to its day, spanning `days` days. Never throws. */
  function agenda(fromMs, days) {
    const startMs = Number.isFinite(toMs(fromMs)) ? dayFloor(toMs(fromMs)) : dayFloor(clock());
    const span = Math.max(1, Math.floor(Number(days)) || 1);
    const groups = [];
    for (let i = 0; i < span; i++) {
      const dms = startMs + i * DAY_MS;
      groups.push({ date: ymd(dms), dateMs: dms, events: day(dms) });
    }
    return groups;
  }

  /**
   * Expand a simple every-N-days recurrence into `count` events, deterministically anchored on the
   * given `start` (NOT the wall clock). Returns { ok, added, events:[...] }. Soft-fails.
   */
  function recurring({ title, source, everyDays, count, start, end, category, url, allDay } = {}) {
    try {
      const t = clean(title);
      const startMs = toMs(start);
      if (!t) return { ok: false, reason: 'title required', added: 0, events: [] };
      if (!Number.isFinite(startMs)) return { ok: false, reason: 'invalid start', added: 0, events: [] };
      const step = Math.floor(Number(everyDays));
      const n = Math.floor(Number(count));
      if (!Number.isFinite(step) || step < 1) return { ok: false, reason: 'invalid everyDays', added: 0, events: [] };
      if (!Number.isFinite(n) || n < 1) return { ok: false, reason: 'invalid count', added: 0, events: [] };
      const dur = Number.isFinite(toMs(end)) && toMs(end) > startMs ? toMs(end) - startMs : 0;
      const out = [];
      for (let i = 0; i < n; i++) {
        const s = startMs + i * step * DAY_MS;
        const r = addEvent({ title: t, start: s, end: s + dur, source, category, url, allDay });
        if (r.ok) out.push(r.event);
      }
      return { ok: true, added: out.length, events: out };
    } catch { return { ok: false, reason: 'error', added: 0, events: [] }; }
  }

  /**
   * Seed the "First Harvest — Founders' Season" (Sept→Dec) as source:'harvest' events for `year`.
   * Deterministic UTC dates. Returns { ok, added, events:[...] }. Soft-fails.
   */
  function seedHarvestSeason(year) {
    try {
      const y = Math.floor(Number(year));
      if (!Number.isFinite(y)) return { ok: false, reason: 'invalid year', added: 0, events: [] };
      const plan = [
        { title: 'Founding Planting',              m: 9,  d: 1,  cat: 'harvest' },                          // Sept
        { title: 'First Harvest Fair',             m: 9,  d: 22, cat: 'harvest' },                          // late Sept
        { title: 'Hollow Harvest',                 m: 10, d: 24, cat: 'harvest' },                          // Oct (Halloween)
        { title: 'Día de los Muertos — Community Altar', m: 10, d: 31, cat: 'harvest', em: 11, ed: 2, allDay: true }, // Oct 31–Nov 2
        { title: 'Cornucopia',                     m: 11, d: 26, cat: 'harvest' },                          // late Nov (Thanksgiving)
        { title: "Founders' Advent",               m: 12, d: 1,  cat: 'harvest' },                          // Dec capstone
      ];
      const out = [];
      for (const p of plan) {
        const start = Date.UTC(y, p.m - 1, p.d);
        const end = p.em ? Date.UTC(y, p.em - 1, p.ed) : start;
        const r = addEvent({ title: p.title, start, end, source: 'harvest', category: p.cat, allDay: !!p.allDay });
        if (r.ok) out.push(r.event);
      }
      return { ok: true, added: out.length, events: out };
    } catch { return { ok: false, reason: 'error', added: 0, events: [] }; }
  }

  // ── esc-safe HTML agenda list ────────────────────────────────────────────────────────────────────────
  function renderAgenda(list) {
    const evs = Array.isArray(list) ? list : [];
    if (!evs.length) return '<ul class="agenda"><li class="empty">No events.</li></ul>';
    const items = evs.map((e) => {
      const date = esc(ymd(e && e.start));
      const title = esc((e && e.title) || '');
      const source = esc((e && e.source) || '');
      // Only http(s) URLs are allowed as hrefs — esc() does NOT neutralize javascript:/data: URIs, so
      // an unrestricted href would be an XSS vector for a malicious event url.
      const raw = clean(e && e.url);
      const url = /^https?:\/\//i.test(raw) ? raw : '';
      const label = url
        ? `<a href="${esc(url)}" rel="noopener noreferrer">${title}</a>`
        : title;
      return `<li class="ev"><time>${date}</time> ${label} <span class="badge src-${source}">${source}</span></li>`;
    }).join('');
    return `<ul class="agenda">${items}</ul>`;
  }

  // ── tiny HTTP surface ──────────────────────────────────────────────────────────────────────────────────
  // GET /api/events?from&to&source&category · POST /api/event {title,start,...} · GET /health
  function sendJson(res, code, obj) {
    const body = JSON.stringify(obj);
    try {
      if (typeof res.writeHead === 'function') res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      else { res.statusCode = code; if (res.setHeader) res.setHeader('content-type', 'application/json; charset=utf-8'); }
    } catch { /* soft-fail headers */ }
    res.end(body);
  }

  function readBody(req) {
    return new Promise((resolve) => {
      try {
        if (req && req.body != null) return resolve(typeof req.body === 'string' ? safeJson(req.body) : req.body);
        let d = '';
        req.on('data', (c) => { d += c; });
        req.on('end', () => resolve(safeJson(d)));
        req.on('error', () => resolve({}));
      } catch { resolve({}); }
    });
  }
  const safeJson = (s) => { try { return s ? JSON.parse(s) : {}; } catch { return {}; } };

  async function handler(req, res) {
    try {
      const url = String((req && req.url) || '');
      const method = String((req && req.method) || 'GET').toUpperCase();
      const path = url.split('?')[0].replace(/\/+$/, '') || '/';
      const qs = new URLSearchParams(url.split('?')[1] || '');

      if (path === '/health') return sendJson(res, 200, { ok: true, service: 'melek-calendar', sources: SOURCES });
      if (path === '/api/events' && method === 'GET') {
        const list = events({
          from: qs.get('from'), to: qs.get('to'),
          source: qs.get('source'), category: qs.get('category'),
        });
        return sendJson(res, 200, { ok: true, count: list.length, events: list });
      }
      if (path === '/api/event' && method === 'POST') {
        const body = await readBody(req);
        return sendJson(res, 200, addEvent(body || {}));
      }
      return sendJson(res, 404, { ok: false, error: esc(`no route for ${method} ${path}`) });
    } catch (e) {
      return sendJson(res, 200, { ok: false, error: 'error' });
    }
  }

  return {
    store,
    addEvent, events, upcoming, day, month, agenda,
    recurring, seedHarvestSeason, renderAgenda, handler,
  };
}

// ── CLI (guarded) ───────────────────────────────────────────────────────────────────────────────────────
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const PORT = +(process.env.PORT || 8170);
  const HOST = process.env.HOST || '127.0.0.1';
  const cal = createCalendar({});
  cal.seedHarvestSeason(new Date().getUTCFullYear());
  createServer((req, res) => cal.handler(req, res)).listen(PORT, HOST, () => {
    console.log(`melek calendar on http://${HOST}:${PORT}/api/events`);
  });
}
