// crowdsource-prices.mjs — token-crowdsourced LOCAL prices (v3 doc §5; queue task #233).
//
// THE OWNED DIFFERENTIATOR (v3 §5): Google Places gives only price_level (––$$$), not real
// numbers. Numbeo charges to store. So we own the freshest cost-of-living layer by letting
// real people submit real local prices (a grocery-basket item, fuel, rent) for their city,
// rewarded in token — then we FUSE that proprietary, fresh dataset with the official gov
// series already wired in coliving.mjs (BLS CPI + EIA/BLS fuel + Open Prices + Census), each
// line provenance-tagged.
//
// DESIGN INVARIANTS (strict):
//   • ESM .mjs, pure-where-possible, soft-fail (never throw out of a public fn).
//   • Injectable clock + injectable store + injectable official-source → 100% offline tests.
//   • Submissions are HUMANITY-GATED (reuse proof-of-human.mjs) to resist spam/Sybil farms.
//   • Token payout is RECEIVE/record-only. This module HOLDS NO KEYS and NEVER signs. It emits
//     a `rewardIntent` record that the separate signer fulfills later. (zero-WIF-on-host rule.)
//   • Reuse coliving.mjs via DEFENSIVE import — do NOT duplicate its fusion/provenance/official
//     getters. If the import ever fails we soft-fail to crowd-only, never crash.
//   • ESCAPE all rendered text (renderBasket).
//   • No secrets read or logged here; official keys live inside coliving's own getters.
//
//   import { submitPrice, outlierFilter, cityBasket, costOfLiving,
//            rewardSchedule, renderBasket } from './crowdsource-prices.mjs'

// ── defensive reuse of the existing cost-of-living build (no duplication) ──────────────────
// Imported eagerly but every USE is guarded; a missing/renamed export degrades to crowd-only.
import * as coliving from './soapbox/coliving.mjs';
import { assess, gate } from './proof-of-human.mjs';

// ── tiny numeric / string helpers ───────────────────────────────────────────────────────
const num = (x) => { const n = Number(x); return Number.isFinite(n) ? n : null; };
const round2 = (n) => Math.round(n * 100) / 100;
const round4 = (n) => Math.round(n * 10000) / 10000;

// HTML-escape for any rendered text (matches sibling soapbox modules).
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

// Normalize a free-text key (city / item) to a stable lowercase bucket id.
function normKey(s) {
  return String(s == null ? '' : s).trim().toLowerCase().replace(/\s+/g, ' ');
}

// ── plausibility bounds — reject obvious nonsense at submit time ───────────────────────────
// A consumer local price is a positive, finite, not-absurd dollar figure. We reject
// non-positive and absurd values (fat-finger / spam). Bounds are deliberately generous: even
// a month's rent in an expensive metro sits well under the ceiling.
export const PRICE_BOUNDS = Object.freeze({ min: 0.01, max: 100000 });

export function isPlausiblePrice(price) {
  const p = num(price);
  return p != null && p >= PRICE_BOUNDS.min && p <= PRICE_BOUNDS.max;
}

// ── submitPrice: validate + store one crowd submission, return a reward INTENT ─────────────
// deps: { store, clock, idgen } — all injectable for offline tests.
//   store.put(submission)  — persists; may be sync or async. Soft-failed.
//   store.list({ city, item, since }) — used by rewardSchedule for anti-farm + gap bonus.
//   clock() — ms-since-epoch (defaults Date.now).
//   idgen() — unique id (defaults timestamp+random).
//
// Returns { ok, id, rewardIntent, submission?, reason? }.
//   • rewardIntent is RECORD-ONLY: { kind:'token_reward', user, amount, currency, reason,
//     submissionId, createdAt, status:'pending' }. NO keys, NO signing — the signer fulfills it.
//   • Rejects non-positive/absurd price and requires a humanity flag.
export async function submitPrice(input = {}, deps = {}) {
  const clock = typeof deps.clock === 'function' ? deps.clock : Date.now;
  const now = num(input.at) != null ? num(input.at) : clock();
  const idgen = typeof deps.idgen === 'function'
    ? deps.idgen
    : () => `sub_${now}_${Math.random().toString(36).slice(2, 10)}`;

  const user = String(input.user == null ? '' : input.user).trim();
  const city = normKey(input.city);
  const item = normKey(input.item);
  const price = num(input.price);
  const unit = String(input.unit == null ? 'each' : input.unit).trim() || 'each';

  if (!user) return { ok: false, reason: 'missing user' };
  if (!city) return { ok: false, reason: 'missing city' };
  if (!item) return { ok: false, reason: 'missing item' };
  if (!isPlausiblePrice(price)) {
    return { ok: false, reason: `implausible price ${input.price} (must be ${PRICE_BOUNDS.min}..${PRICE_BOUNDS.max})` };
  }

  // HUMANITY GATE. A submission must carry either an explicit humanity flag or proof-of-human
  // signals that clear the bar. We reuse proof-of-human.mjs to assess; the flag alone is the
  // minimum the surface must set (anonymous still allowed but down-weighted by reward logic).
  const humanity = assessHumanity(input);
  if (!humanity.humanityChecked) {
    return { ok: false, reason: 'humanity flag required (humanity-gated surface)' };
  }

  const id = idgen();
  const submission = {
    id,
    user,
    city,
    item,
    price: round2(price),
    unit,
    at: now,
    source: 'crowdsource',
    provenance: 'crowdsource',
    humanityChecked: true,
    humanityScore: humanity.humanityScore,
    humanityTier: humanity.tier,
  };

  // Persist (soft-fail — a dead store must not lose the reward intent or crash the surface).
  try {
    if (deps.store && typeof deps.store.put === 'function') await deps.store.put(submission);
  } catch { /* soft-fail: stored=false but we still return the intent */ }

  // Reward is computed by the anti-farm schedule, then emitted as an INTENT for the signer.
  let amount = 0;
  try {
    const sched = await rewardSchedule(submission, deps);
    amount = sched.amount;
  } catch { amount = 0; }

  const rewardIntent = makeRewardIntent({ user, amount, submissionId: id, now });

  return { ok: true, id, submission, rewardIntent };
}

// Build the receive/record-only reward intent. NO keys, NO broadcast — the signer fulfills it.
function makeRewardIntent({ user, amount, submissionId, now }) {
  return Object.freeze({
    kind: 'token_reward',
    user,
    amount: round4(Math.max(0, num(amount) ?? 0)),
    currency: 'SOAP',
    reason: 'crowdsourced local price submission',
    submissionId,
    createdAt: new Date(now).toISOString(),
    status: 'pending', // signer flips this; this module never holds a key
  });
}

// Assess humanity from a submission's flags/signals using proof-of-human.mjs.
// `humanityChecked: true` (an explicit attest from the surface) is the floor; richer signals
// (deviceAttested/idVerified + anomaly fields) refine the score & tier.
function assessHumanity(input = {}) {
  const flag = input.humanityChecked === true || input.humanity === true;
  const signals = (input.signals && typeof input.signals === 'object') ? input.signals : {};
  let tier = 'anonymous';
  let humanityScore = 0;
  try {
    const a = assess({ signals });
    tier = a.tier;
    humanityScore = a.humanityScore;
  } catch { /* soft-fail: keep defaults */ }
  // The flag is required; signals alone (without the surface asserting a check) don't pass,
  // so a scraper can't slip through by sending raw fields.
  const humanityChecked = flag === true;
  return { humanityChecked, humanityScore, tier };
}

// ── outlierFilter: median + MAD outlier rejection, recency-weighted ───────────────────────
// Thin crowd data lies — a single fat-finger 10× price poisons a naive mean. We use the robust
// median + Median-Absolute-Deviation: anything more than `k` MADs from the median is dropped.
// Survivors are recency-weighted (newer submissions count more) into a weighted-median price.
//   returns { price, n, kept, dropped, median, mad }
//     price  = recency-weighted median of survivors (null if none)
//     kept   = surviving submissions; dropped = rejected ones (with .reason)
export function outlierFilter(submissions = [], opts = {}) {
  const k = num(opts.k) != null ? num(opts.k) : 3.5; // MAD multiplier (robust default)
  const now = num(opts.now) != null ? num(opts.now) : Date.now();
  const halfLifeMs = num(opts.halfLifeMs) != null ? num(opts.halfLifeMs) : 90 * 24 * 60 * 60 * 1000;

  const rows = (Array.isArray(submissions) ? submissions : [])
    .map((s) => ({ ...s, _p: num(s.price) }))
    .filter((s) => s._p != null && s._p > 0);

  if (rows.length === 0) return { price: null, n: 0, kept: [], dropped: [], median: null, mad: null };
  if (rows.length === 1) {
    return { price: round2(rows[0]._p), n: 1, kept: rows, dropped: [], median: round2(rows[0]._p), mad: 0 };
  }

  const prices = rows.map((r) => r._p);
  const med = median(prices);
  const absDev = prices.map((p) => Math.abs(p - med));
  const mad = median(absDev);

  const kept = [];
  const dropped = [];
  for (const r of rows) {
    // When MAD is 0 (all identical-ish), fall back to a relative band so we still catch a 10×.
    const within = mad > 0
      ? Math.abs(r._p - med) <= k * mad
      : Math.abs(r._p - med) <= Math.max(0.01, 0.5 * med);
    if (within) kept.push(r);
    else dropped.push({ ...r, reason: `outlier ${r._p} vs median ${round2(med)} (MAD ${round2(mad)})` });
  }

  // recency-weighted median over survivors (exponential decay by age).
  const survivors = kept.length ? kept : rows; // never drop everything
  const weighted = survivors.map((r) => {
    const age = Math.max(0, now - (num(r.at) != null ? num(r.at) : now));
    const w = Math.pow(0.5, age / halfLifeMs);
    return { p: r._p, w: w > 0 ? w : 1e-9 };
  });
  const price = weightedMedian(weighted);

  return {
    price: price == null ? null : round2(price),
    n: rows.length,
    kept,
    dropped,
    median: round2(med),
    mad: round2(mad),
  };
}

function median(arr) {
  const a = arr.slice().sort((x, y) => x - y);
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

function weightedMedian(items) {
  const a = items.filter((i) => num(i.p) != null && num(i.w) != null && i.w > 0)
    .sort((x, y) => x.p - y.p);
  if (!a.length) return null;
  const total = a.reduce((s, i) => s + i.w, 0);
  let acc = 0;
  for (const i of a) {
    acc += i.w;
    if (acc >= total / 2) return i.p;
  }
  return a[a.length - 1].p;
}

// ── provenance tagging (reuse coliving's primitive when present, else local fallback) ──────
function tag({ value, source, observedAt, nowMs }) {
  try {
    if (typeof coliving.provenanceTag === 'function') {
      return coliving.provenanceTag({ value, source, observedAt, nowMs });
    }
  } catch { /* fall through to local */ }
  // minimal local fallback so this module works even if coliving is unavailable
  return {
    value: value == null ? null : value,
    source,
    fetched_at: new Date(nowMs).toISOString(),
    freshness: observedAt == null ? 'unknown' : 'fresh',
    confidence: value == null ? 0 : 0.5,
  };
}

// ── cityBasket: fused crowd + official basket, each line provenance-tagged ────────────────
// deps: { store, official, clock }
//   store.list({ city, item }) → submissions[]  (the owned crowd dataset)
//   official → an injected official source: { basketLine({city,item}) } OR a function
//              ({city,item}) → { value, source, observedAt }. Soft-failed per line.
//   clock() → now ms.
//
// Returns { city, lines:[ { item, unit, crowd:{price,n}, official:{value,source},
//   value, provenance:{crowd:n, official:bool, asOf}, source, ...tag } ], asOf }
export async function cityBasket(city, deps = {}) {
  const clock = typeof deps.clock === 'function' ? deps.clock : Date.now;
  const now = clock();
  const cityKey = normKey(city);
  const items = Array.isArray(deps.items) && deps.items.length
    ? deps.items.map(normKey)
    : DEFAULT_BASKET_ITEMS.slice();

  const lines = [];
  for (const item of items) {
    // crowd side
    let subs = [];
    try {
      if (deps.store && typeof deps.store.list === 'function') {
        subs = await deps.store.list({ city: cityKey, item }) || [];
      }
    } catch { subs = []; }
    const filtered = outlierFilter(subs, { now });
    const crowdN = filtered.kept.length || (filtered.price != null ? filtered.n : 0);

    // official side (soft-fail per line)
    const off = await officialLine(deps.official, { city: cityKey, item, now });

    // blend: crowd is the OWNED fresh signal; official anchors when crowd is thin/absent.
    const blend = blendLine({ crowd: filtered, official: off, now });
    lines.push({
      item,
      unit: subs[0] && subs[0].unit ? subs[0].unit : 'each',
      crowd: filtered.price != null ? { price: filtered.price, n: crowdN } : null,
      official: off && off.value != null ? { value: off.value, source: off.source } : null,
      ...blend,
    });
  }

  return { city: cityKey, lines, asOf: new Date(now).toISOString() };
}

// Default crowd basket items (v3 §5 examples: a grocery item, fuel, rent).
export const DEFAULT_BASKET_ITEMS = Object.freeze(['milk', 'gasoline', 'rent']);

// Pull one official line via the injected source. Accepts a function or an object with
// basketLine(). Returns { value, source, observedAt } or null. Never throws.
async function officialLine(official, { city, item, now }) {
  if (!official) return null;
  try {
    let raw = null;
    if (typeof official === 'function') raw = await official({ city, item, now });
    else if (typeof official.basketLine === 'function') raw = await official.basketLine({ city, item, now });
    else return null;
    if (!raw) return null;
    const value = num(raw.value);
    if (value == null) return null;
    return { value: round2(value), source: raw.source || 'official', observedAt: raw.observedAt ?? null };
  } catch {
    return null; // soft-fail this line; the basket still renders crowd-only
  }
}

// Blend one crowd-filtered result with one official line into a provenance-tagged value.
// Preference: crowd when it has support (n>0), else official, else null — each tagged.
function blendLine({ crowd, official, now }) {
  const crowdN = crowd && crowd.kept ? crowd.kept.length : 0;
  const hasCrowd = crowd && crowd.price != null && crowdN > 0;
  const hasOff = official && official.value != null;

  let value = null;
  let source = 'crowdsource';
  let observedAt = now;
  if (hasCrowd && hasOff) {
    // confidence-style blend: crowd weighted by support, official as the stabilizing anchor.
    const cw = Math.min(1, crowdN / 5); // 5+ submissions → crowd-dominant
    value = round2(crowd.price * cw + official.value * (1 - cw));
    source = 'fused';
  } else if (hasCrowd) {
    value = crowd.price; source = 'crowdsource';
  } else if (hasOff) {
    value = official.value; source = official.source || 'official'; observedAt = official.observedAt ?? null;
  }

  const t = tag({ value, source, observedAt, nowMs: now });
  return {
    value: t.value,
    source: t.source,
    fetched_at: t.fetched_at,
    freshness: t.freshness,
    confidence: t.confidence,
    provenance: {
      crowd: crowdN,
      official: !!hasOff,
      asOf: new Date(now).toISOString(),
    },
  };
}

// ── costOfLiving: state→city→country rollup blending crowd + official, soft-fail per source ─
// deps: { store, official, clock, coliving? } — `official`/`store` as in cityBasket; the gov
// macro rollup defers to coliving.costOfLiving (defensively) when present.
//   query: { state?, city?, country? }
// Returns { scope, city?, state?, country?, basket?, macro?, provenance, asOf }.
export async function costOfLiving(query = {}, deps = {}) {
  const clock = typeof deps.clock === 'function' ? deps.clock : Date.now;
  const now = clock();
  const { state, city, country } = query || {};
  const scope = city ? 'city' : state ? 'state' : country ? 'country' : 'unknown';

  const out = { scope, asOf: new Date(now).toISOString(), provenance: { crowd: 0, official: false, sources: [] } };
  if (city) out.city = normKey(city);
  if (state) out.state = normKey(state);
  if (country) out.country = normKey(country);

  // crowd basket for the most specific geography we have (city preferred).
  if (city) {
    try {
      const basket = await cityBasket(city, deps);
      out.basket = basket;
      const crowdTotal = (basket.lines || []).reduce((a, l) => a + (l.provenance ? l.provenance.crowd : 0), 0);
      out.provenance.crowd = crowdTotal;
      if (crowdTotal > 0) out.provenance.sources.push('crowdsource');
    } catch { /* soft-fail: no basket, continue to macro */ }
  }

  // official macro rollup via coliving.costOfLiving (metro = city or state). Soft-fail.
  const metro = city || state || undefined;
  try {
    const colivingFn = (deps.coliving && typeof deps.coliving.costOfLiving === 'function')
      ? deps.coliving.costOfLiving
      : (typeof coliving.costOfLiving === 'function' ? coliving.costOfLiving : null);
    if (colivingFn) {
      const macro = await colivingFn({ metro, nowMs: now });
      if (macro) {
        out.macro = macro;
        if (macro.value != null) { out.provenance.official = true; out.provenance.sources.push('official'); }
      }
    }
  } catch { /* soft-fail the official source; crowd basket (if any) still stands */ }

  return out;
}

// ── rewardSchedule: small, anti-farm token reward logic ───────────────────────────────────
// Principles (v3 §5 + proof-of-human discipline):
//   • Small base reward per accepted submission.
//   • Diminishing per-user-per-day: each additional same-day submission earns less (anti-farm).
//   • Gap bonus: a submission filling a city/item with NO prior data earns a bonus (we want
//     coverage of fresh, owned data).
//   • Humanity-scaled: cleaner/verified humans earn the full amount; we reuse proof-of-human's
//     gate so a low-humanity submission is down-weighted (or zeroed) here too.
// deps: { store, clock } — store.list used to count today's prior submissions + detect a gap.
//   returns { amount, base, multiplier, gapBonus, sameDayCount, reason }
export const REWARD = Object.freeze({
  base: 1.0,            // base SOAP per accepted submission
  gapBonus: 2.0,        // extra for filling a no-data city/item
  dailyDecay: 0.5,      // each prior same-day submission halves the next (geometric)
  dailyFloor: 0.05,     // never below this for an accepted, humanity-checked submission
});

export async function rewardSchedule(submission = {}, deps = {}) {
  const clock = typeof deps.clock === 'function' ? deps.clock : Date.now;
  const now = num(submission.at) != null ? num(submission.at) : clock();
  const user = String(submission.user == null ? '' : submission.user).trim();
  const city = normKey(submission.city);
  const item = normKey(submission.item);

  // count this user's accepted submissions earlier today (same UTC day) → diminishing returns.
  let sameDayCount = 0;
  let priorForCityItem = 0;
  try {
    if (deps.store && typeof deps.store.list === 'function') {
      const dayStart = startOfUtcDay(now);
      const mine = await deps.store.list({ user, since: dayStart }) || [];
      sameDayCount = mine.filter((s) => num(s.at) != null && num(s.at) < now).length;

      const existing = await deps.store.list({ city, item }) || [];
      // a gap = no OTHER submission for this city/item before now (this one is first).
      priorForCityItem = existing.filter((s) => s.id !== submission.id
        && num(s.at) != null && num(s.at) <= now).length;
    }
  } catch { sameDayCount = 0; priorForCityItem = 0; }

  const decayMult = Math.pow(REWARD.dailyDecay, sameDayCount);
  const gapBonus = priorForCityItem === 0 ? REWARD.gapBonus : 0;

  // humanity scaling via proof-of-human gate: a clean device/verified human keeps full value.
  const humanityScore = num(submission.humanityScore);
  let humanityMult = 1;
  try {
    const a = {
      tier: submission.humanityTier || 'device',
      humanityScore: humanityScore != null ? humanityScore : 0.65,
      multiplier: 1,
      reasons: [],
    };
    const g = gate({ payout: 1, assessment: a, rules: { minHumanityScore: 0.1 } });
    humanityMult = g.allowed ? Math.max(0, g.adjustedPayout) : 0;
  } catch { humanityMult = 1; }

  let amount = (REWARD.base * decayMult + gapBonus) * humanityMult;
  if (amount > 0 && amount < REWARD.dailyFloor && humanityMult > 0) amount = REWARD.dailyFloor;
  amount = round4(Math.max(0, amount));

  return {
    amount,
    base: REWARD.base,
    multiplier: round4(decayMult * humanityMult),
    gapBonus,
    sameDayCount,
    reason: gapBonus > 0
      ? `base×${round4(decayMult)} + gap-fill bonus${humanityMult !== 1 ? ` × humanity ${round4(humanityMult)}` : ''}`
      : `base×${round4(decayMult)} (submission #${sameDayCount + 1} today)${humanityMult !== 1 ? ` × humanity ${round4(humanityMult)}` : ''}`,
  };
}

function startOfUtcDay(ms) {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

// ── renderBasket: escaped HTML with provenance badges ─────────────────────────────────────
// Renders a cityBasket() result. EVERY user-influenced string (city, item, source) is escaped.
// Each line carries a provenance badge: crowd count, official-anchor flag, freshness, asOf.
export function renderBasket(basket = {}) {
  const city = esc(basket.city || 'this city');
  const lines = Array.isArray(basket.lines) ? basket.lines : [];
  const asOf = esc(basket.asOf || '');

  const rows = lines.map((l) => {
    const item = esc(l.item);
    const unit = esc(l.unit || 'each');
    const value = l.value == null ? 'n/a' : esc(`$${l.value}`);
    const prov = l.provenance || {};
    const badges = [];
    if (prov.crowd > 0) badges.push(`<span class="badge badge-crowd">${esc(prov.crowd)} crowd</span>`);
    if (prov.official) badges.push('<span class="badge badge-official">official anchor</span>');
    badges.push(`<span class="badge badge-source">${esc(l.source || 'n/a')}</span>`);
    if (l.freshness) badges.push(`<span class="badge badge-fresh">${esc(l.freshness)}</span>`);
    return `    <tr>
      <td class="item">${item}</td>
      <td class="price">${value}</td>
      <td class="unit">${unit}</td>
      <td class="prov">${badges.join(' ')}</td>
    </tr>`;
  }).join('\n');

  return `<section class="soapbox-basket" data-city="${city}">
  <h3>Cost of living — ${city}</h3>
  <table class="basket">
    <thead><tr><th>Item</th><th>Price</th><th>Unit</th><th>Provenance</th></tr></thead>
    <tbody>
${rows}
    </tbody>
  </table>
  <p class="crowd-note">These are prices <strong>you helped crowdsource</strong> — submit a real local price for your city and earn token. Crowd figures are blended with official series and provenance-tagged.</p>
  <p class="as-of">As of ${asOf}</p>
</section>`;
}

// ── CLI (guarded) ─────────────────────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('crowdsource-prices.mjs')) {
  // demo with an in-memory store + offline official source (no network, no keys).
  const mem = [];
  const store = {
    put: (s) => { mem.push(s); },
    list: ({ city, item, user, since } = {}) => mem.filter((s) => (
      (city == null || s.city === normKey(city))
      && (item == null || s.item === normKey(item))
      && (user == null || s.user === user)
      && (since == null || s.at >= since)
    )),
  };
  const official = ({ item }) => ({
    value: { milk: 4.1, gasoline: 3.6, rent: 1850 }[item] ?? null,
    source: 'official',
    observedAt: Date.now() - 20 * 24 * 60 * 60 * 1000,
  });

  const r1 = await submitPrice(
    { user: 'alice', city: 'Denver', item: 'milk', price: 4.5, unit: 'gallon', humanityChecked: true },
    { store },
  );
  console.log('submit:', JSON.stringify(r1, null, 2));

  const basket = await cityBasket('Denver', { store, official });
  console.log('\nbasket:', JSON.stringify(basket, null, 2));
  console.log('\nHTML:\n', renderBasket(basket));

  const col = await costOfLiving({ city: 'Denver', state: 'Colorado', country: 'US' }, { store, official });
  console.log('\ncostOfLiving:', JSON.stringify(col.provenance, null, 2));
}
