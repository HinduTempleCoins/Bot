// model.mjs — the campaign + inventory CORE of the MELEK ad market.
//
// WHAT THIS IS: the state machine and the ledger for self-serve ads paid in OUR tokens. It creates
// campaigns, walks them through review → funding → active → exhausted, meters each impression/click and
// draws the escrowed budget down against a CPM/CPC rate (pricing.mjs), and picks which ad serves in a
// given slot. It is the honest source of truth for "what is running, what is left in each budget, what
// has this campaign spent." It holds NO keys and moves NO money — funding is verified by an operator
// (confirmFunding) against a real on-chain deposit, and the intents are built in payments.mjs.
//
// STORE: an in-memory Map by default (tests need no disk); optional JSON-file persistence via injectable
// fs (loadStore/saveStore, soft-fail). No native deps — house style is flat files + injectable seams.
//
// LIFECYCLE (a campaign's `status`):
//   draft ─submit→ pending_review ─operator approve→ approved ─confirmFunding(real deposit)→ active
//                              └─operator reject→ rejected
//   active ─budget spent→ exhausted     active ─operator→ paused ⇄ active     active ─operator→ ended
// Only an `active` campaign with budget remaining is ever served. All money math is BigInt base units.
//
// House style: ESM .mjs, soft-fail-never-throw ({ ok:false, error } for user error), injectable now/fs,
// esc() is the renderer's job (serve.mjs), not this pure model's.
//
//   import { createStore, createCampaign, reviewCampaign, confirmFunding, recordServe, pickAd } from './model.mjs'

import {
  TOKENS, tokenSpec, isSupportedToken, isModel, toBaseUnits, fromBaseUnits, amountStr,
  costOf, unitsAffordable, big,
} from './pricing.mjs';

// ── validation helpers ────────────────────────────────────────────────────────────────────────────────
const ACCOUNT_RE = /^[a-z][a-z0-9-]{2,15}(\.[a-z][a-z0-9-]+)*$/;   // Graphene account (MELEK/APIS payers)
const EVM_ADDR_RE = /^0x[0-9a-fA-F]{40}$/;                          // EVM address (PRANA/KULA payers)
const PLACEMENT_RE = /^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$/;        // stable slot key, e.g. 'law-top'
const STATUSES = Object.freeze(['draft', 'pending_review', 'approved', 'active', 'paused', 'exhausted', 'rejected', 'ended']);
const SERVEABLE = Object.freeze(['active']);

const err = (error) => ({ ok: false, error });
const now0 = () => Date.now();

/** An advertiser id is a MELEK account (graphene/engine payers) or an EVM address (PRANA/KULA payers). */
export function isValidAdvertiser(a) {
  return typeof a === 'string' && (ACCOUNT_RE.test(a) || EVM_ADDR_RE.test(a));
}
export function isValidPlacement(p) {
  return typeof p === 'string' && p.length <= 64 && PLACEMENT_RE.test(p);
}

// URL must be http(s) — never javascript:/data:/relative (an advertiser controls the creative link).
export function isValidUrl(u) {
  try { const x = new URL(String(u)); return x.protocol === 'http:' || x.protocol === 'https:'; }
  catch { return false; }
}

/** Validate + normalise a creative. Returns { ok, creative } or { ok:false, error }. */
export function normalizeCreative(c) {
  const o = (c && typeof c === 'object') ? c : {};
  const headline = String(o.headline || '').trim().slice(0, 90);
  const body = String(o.body || '').trim().slice(0, 200);
  const url = String(o.url || '').trim();
  const image = o.image ? String(o.image).trim().slice(0, 500) : '';
  if (!headline) return err('creative.headline required');
  if (!isValidUrl(url)) return err('creative.url must be an http(s) URL');
  if (image && !isValidUrl(image)) return err('creative.image must be an http(s) URL when set');
  return { ok: true, creative: { headline, body, url, image } };
}

// ── the store ─────────────────────────────────────────────────────────────────────────────────────────
/**
 * createStore(opts) → an in-memory store. opts.now injects the clock; opts.seq injects an id counter
 * (tests want deterministic ids). Nothing here touches disk — see loadStore/saveStore for persistence.
 */
export function createStore(opts = {}) {
  return {
    campaigns: new Map(),
    now: typeof opts.now === 'function' ? opts.now : now0,
    _seq: Number.isFinite(opts.seq) ? opts.seq : 0,
  };
}

function nextId(store) {
  store._seq = (store._seq || 0) + 1;
  // human-auditable, sortable id; not a secret.
  const stamp = store.now();
  return `camp_${stamp.toString(36)}_${String(store._seq).padStart(4, '0')}`;
}

/** Deep-ish clone of a campaign row for return (callers never mutate our Map entries). */
function view(c) { return c ? JSON.parse(JSON.stringify(c)) : null; }

// ── create ────────────────────────────────────────────────────────────────────────────────────────────
/**
 * createCampaign(store, params) — register a new campaign in `pending_review`.
 * params:
 *   advertiser : MELEK account or 0x EVM address (who pays / who owns the campaign)
 *   token      : 'MELEK' | 'APIS' | 'PRANA' | 'KULA'
 *   model      : 'cpm' | 'cpc'
 *   rate       : price per 1000 impressions (cpm) or per click (cpc), as a DECIMAL token string ('2.000')
 *   budget     : total intended spend, DECIMAL token string ('50.000')
 *   placement  : target slot key ('law-top')
 *   creative   : { headline, body, url, image? }
 * Amounts are converted to BigInt base units and STORED AS STRINGS (JSON-safe). NEVER throws for user
 * error. Returns { ok:true, campaign } or { ok:false, error }.
 */
export function createCampaign(store, params = {}) {
  if (!store || !(store.campaigns instanceof Map)) throw new TypeError('createCampaign: bad store');
  const p = params || {};

  if (!isValidAdvertiser(p.advertiser)) return err(`invalid advertiser "${p.advertiser}"`);
  const token = String(p.token || '').toUpperCase();
  if (!isSupportedToken(token)) return err(`unsupported token "${p.token}" (use ${Object.keys(TOKENS).join('/')})`);
  const model = String(p.model || '').toLowerCase();
  if (!isModel(model)) return err(`invalid model "${p.model}" (cpm|cpc)`);
  if (!isValidPlacement(p.placement)) return err(`invalid placement "${p.placement}"`);

  const spec = tokenSpec(token);
  const rate = toBaseUnits(p.rate, spec.precision);
  if (rate == null || rate <= 0n) return err(`invalid rate "${p.rate}" for ${token} (${spec.precision} dp, > 0)`);
  const budget = toBaseUnits(p.budget, spec.precision);
  if (budget == null || budget <= 0n) return err(`invalid budget "${p.budget}" for ${token}`);
  if (budget < rate) return err('budget must be at least one rate unit');

  const cre = normalizeCreative(p.creative);
  if (!cre.ok) return cre;

  const id = nextId(store);
  const ts = store.now();
  const campaign = {
    id,
    advertiser: p.advertiser,
    token,
    model,
    rate: rate.toString(),         // base units, string
    budget: budget.toString(),     // base units, string (set from funded amount at confirmFunding)
    requestedBudget: budget.toString(),
    placement: p.placement,
    creative: cre.creative,
    status: 'pending_review',
    impressions: 0,
    clicks: 0,
    spent: '0',                    // base units, string
    escrowRef: null,               // set at confirmFunding (real deposit tx/op id)
    reviewNote: '',
    createdAt: ts,
    updatedAt: ts,
    history: [{ at: ts, to: 'pending_review' }],
  };
  store.campaigns.set(id, campaign);
  return { ok: true, campaign: view(campaign) };
}

function transition(store, id, to, extra = {}) {
  const c = store.campaigns.get(id);
  if (!c) return err(`unknown campaign "${id}"`);
  const ts = store.now();
  c.status = to;
  c.updatedAt = ts;
  c.history.push({ at: ts, to, ...(extra.note ? { note: String(extra.note).slice(0, 200) } : {}) });
  return { ok: true, campaign: view(c) };
}

// ── operator: review the creative BEFORE taking any money ───────────────────────────────────────────────
/**
 * reviewCampaign(store, id, decision, opts) — operator approves or rejects a pending_review campaign.
 * decision: 'approve' → status 'approved' (an approved campaign may now be funded); 'reject' → 'rejected'.
 * This is a HUMAN gate — no money has moved yet; we never charge for an ad we won't run.
 */
export function reviewCampaign(store, id, decision, opts = {}) {
  const c = store.campaigns.get(id);
  if (!c) return err(`unknown campaign "${id}"`);
  if (c.status !== 'pending_review') return err(`campaign "${id}" is ${c.status}, not pending_review`);
  const d = String(decision || '').toLowerCase();
  if (d === 'approve') { if (opts.note) c.reviewNote = String(opts.note).slice(0, 200); return transition(store, id, 'approved', opts); }
  if (d === 'reject') { c.reviewNote = String(opts.note || '').slice(0, 200); return transition(store, id, 'rejected', opts); }
  return err(`decision must be approve|reject (got "${decision}")`);
}

// ── operator: confirm the escrow deposit landed on-chain, then go live ──────────────────────────────────
/**
 * confirmFunding(store, id, opts) — the operator (having VERIFIED a real on-chain deposit into the ad
 * escrow account/contract for `amount`) marks the campaign funded and ACTIVE. This is the money gate:
 * zero-WIF means nothing here signs or broadcasts — the operator/signer settles the deposit off this
 * host and hands us the proof (ref + amount). The confirmed `amount` becomes the campaign's budget
 * (if it differs from the requested budget, the real deposit wins — you get what you actually paid for).
 * opts: { ref (tx/op id, required), amount (decimal token string; defaults to requestedBudget) }
 */
export function confirmFunding(store, id, opts = {}) {
  const c = store.campaigns.get(id);
  if (!c) return err(`unknown campaign "${id}"`);
  if (c.status !== 'approved') return err(`campaign "${id}" is ${c.status}, must be approved before funding`);
  const ref = String(opts.ref || '').trim();
  if (!ref) return err('confirmFunding requires a deposit ref (the on-chain tx/op id you verified)');
  const spec = tokenSpec(c.token);
  let budget;
  if (opts.amount != null) {
    budget = toBaseUnits(opts.amount, spec.precision);
    if (budget == null || budget <= 0n) return err(`invalid confirmed amount "${opts.amount}"`);
  } else {
    budget = BigInt(c.requestedBudget);
  }
  if (budget < BigInt(c.rate)) return err('confirmed amount is below one rate unit — cannot serve');
  c.budget = budget.toString();
  c.escrowRef = ref.slice(0, 200);
  return transition(store, id, 'active', { note: `funded ${amountStr(budget, c.token)} ref=${ref.slice(0, 24)}` });
}

// ── operator: pause / resume / end ──────────────────────────────────────────────────────────────────────
export function pauseCampaign(store, id, opts = {}) {
  const c = store.campaigns.get(id);
  if (!c) return err(`unknown campaign "${id}"`);
  if (c.status !== 'active') return err(`only an active campaign can be paused (is ${c.status})`);
  return transition(store, id, 'paused', opts);
}
export function resumeCampaign(store, id, opts = {}) {
  const c = store.campaigns.get(id);
  if (!c) return err(`unknown campaign "${id}"`);
  if (c.status !== 'paused') return err(`only a paused campaign can be resumed (is ${c.status})`);
  if (BigInt(c.spent) >= BigInt(c.budget)) return transition(store, id, 'exhausted', opts);
  return transition(store, id, 'active', opts);
}
export function endCampaign(store, id, opts = {}) {
  const c = store.campaigns.get(id);
  if (!c) return err(`unknown campaign "${id}"`);
  if (['ended', 'rejected'].includes(c.status)) return err(`campaign "${id}" already ${c.status}`);
  return transition(store, id, 'ended', opts);
}

// ── metering + budget drawdown ──────────────────────────────────────────────────────────────────────────
/** Recompute spent from the counters (single source of truth; avoids per-event rounding drift). */
function recompute(c) {
  const spent = costOf({ model: c.model, rate: c.rate, impressions: c.impressions, clicks: c.clicks });
  c.spent = (spent == null ? 0n : spent).toString();
}

/** Remaining budget (BigInt) for a campaign row. */
export function remaining(c) {
  try { const r = BigInt(c.budget) - BigInt(c.spent); return r > 0n ? r : 0n; } catch { return 0n; }
}

/**
 * recordServe(store, id, opts) — meter ONE billable event and draw the budget down.
 * opts.type: 'impression' (default) or 'click'. Only meters an `active` campaign that can still afford
 * the event; otherwise returns { ok:true, served:false, reason } and (for a now-unaffordable campaign)
 * flips it to `exhausted`. Idempotency: pass opts.eventId to dedupe (a beacon can double-fire) — a
 * repeated eventId is a no-op counted once. Returns { ok, served, charged (base units str), campaign }.
 */
export function recordServe(store, id, opts = {}) {
  const c = store.campaigns.get(id);
  if (!c) return err(`unknown campaign "${id}"`);
  const type = String(opts.type || 'impression').toLowerCase();
  if (type !== 'impression' && type !== 'click') return err(`type must be impression|click`);
  if (c.status !== 'active') return { ok: true, served: false, reason: `status ${c.status}`, campaign: view(c) };

  // CPM bills impressions; CPC bills clicks (an impression on a CPC campaign is free but still counted).
  const billable = (c.model === 'cpm' && type === 'impression') || (c.model === 'cpc' && type === 'click');

  // idempotency
  if (opts.eventId) {
    c._seen = c._seen || {};
    if (c._seen[opts.eventId]) return { ok: true, served: true, deduped: true, charged: '0', campaign: view(c) };
  }

  // would this billable event exceed budget? if the campaign can't afford ONE more billable unit, stop.
  if (billable) {
    const unitCost = c.model === 'cpm' ? (BigInt(c.rate) + 999n) / 1000n : BigInt(c.rate); // ceil per-impression for the guard
    if (remaining(c) < unitCost) {
      transition(store, id, 'exhausted', { note: 'budget spent' });
      return { ok: true, served: false, reason: 'exhausted', campaign: view(c) };
    }
  }

  const before = BigInt(c.spent);
  if (type === 'impression') c.impressions += 1; else c.clicks += 1;
  if (opts.eventId) c._seen[opts.eventId] = 1;
  recompute(c);
  c.updatedAt = store.now();
  const charged = (BigInt(c.spent) - before).toString();

  // flip to exhausted the moment the budget is fully spent.
  if (remaining(c) <= 0n) transition(store, id, 'exhausted', { note: 'budget spent' });

  return { ok: true, served: true, charged, campaign: view(c) };
}

// ── reads ───────────────────────────────────────────────────────────────────────────────────────────────
export function getCampaign(store, id) { return view(store.campaigns.get(id)); }

/** listCampaigns(store, filter?) → array of views. filter: { status, advertiser, placement }. */
export function listCampaigns(store, filter = {}) {
  const out = [];
  for (const c of store.campaigns.values()) {
    if (filter.status && c.status !== filter.status) continue;
    if (filter.advertiser && c.advertiser !== filter.advertiser) continue;
    if (filter.placement && c.placement !== filter.placement) continue;
    out.push(view(c));
  }
  return out.sort((a, b) => b.createdAt - a.createdAt);
}

/** listActiveAds(store, placement) → active, budget-remaining campaigns for a slot, oldest-first (fair). */
export function listActiveAds(store, placement) {
  const out = [];
  for (const c of store.campaigns.values()) {
    if (c.status !== 'active') continue;
    if (c.placement !== placement) continue;
    if (remaining(c) <= 0n) continue;
    out.push(c);
  }
  return out.sort((a, b) => a.createdAt - b.createdAt).map(view);
}

/**
 * pickAd(store, placement, opts) — choose ONE ad to serve in a slot. Rotation is deterministic when
 * opts.rotate (an integer, e.g. a request counter) is given — round-robins across eligible campaigns so
 * budgets deplete fairly; otherwise picks the oldest eligible (FIFO). Returns a campaign view or null
 * (null → the caller falls back to a house ad; see serve.mjs). Does NOT meter — metering is recordServe.
 */
export function pickAd(store, placement, opts = {}) {
  const eligible = listActiveAds(store, placement);
  if (!eligible.length) return null;
  const rotate = Number.isFinite(opts.rotate) ? Math.abs(Math.floor(opts.rotate)) : 0;
  return eligible[rotate % eligible.length];
}

// ── optional JSON-file persistence (soft-fail, injectable fs) ───────────────────────────────────────────
/** Serialise the store to a plain object (drops in-memory-only fields like _seen). */
export function serializeStore(store) {
  const campaigns = [];
  for (const c of store.campaigns.values()) { const { _seen, ...rest } = c; campaigns.push(rest); }
  return { version: 1, seq: store._seq || 0, campaigns };
}

/** saveStore(store, { fs, file }) — write the store as JSON. Returns true/false, never throws. */
export function saveStore(store, opts = {}) {
  try {
    const fs = opts.fs; const file = opts.file;
    if (!fs || !file) return false;
    fs.writeFileSync(file, JSON.stringify(serializeStore(store)));
    return true;
  } catch { return false; }
}

/** loadStore({ fs, file, now }) — read a JSON store back. Returns a store; empty on any problem. */
export function loadStore(opts = {}) {
  const store = createStore({ now: opts.now });
  try {
    const raw = opts.fs && opts.file ? opts.fs.readFileSync(opts.file, 'utf8') : '';
    if (!raw) return store;
    const data = JSON.parse(raw);
    store._seq = Number(data.seq) || 0;
    for (const c of data.campaigns || []) if (c && c.id) store.campaigns.set(c.id, c);
  } catch { /* soft-fail: return whatever we have */ }
  return store;
}

// ── CLI — offline demo (full lifecycle, no network, no disk) ────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('model.mjs')) {
  let t = 1_700_000_000_000;
  const store = createStore({ now: () => t });
  const c = createCampaign(store, {
    advertiser: 'acmecorp', token: 'MELEK', model: 'cpm', rate: '2.000', budget: '10.000',
    placement: 'law-top', creative: { headline: 'Acme Legal Research', body: 'Fast case lookup.', url: 'https://example.com' },
  });
  console.log('admarket/model — campaign lifecycle demo\n' + '─'.repeat(64));
  console.log('create →', c.ok, c.campaign.id, c.campaign.status);
  const id = c.campaign.id;
  console.log('review approve →', reviewCampaign(store, id, 'approve').campaign.status);
  console.log('confirm funding →', confirmFunding(store, id, { ref: '0xdeposit', amount: '10.000' }).campaign.status);
  let served = 0, charged = 0n;
  for (let i = 0; i < 6000; i++) { const r = recordServe(store, id, { type: 'impression' }); if (r.served) served++; else { charged = BigInt(r.campaign.spent); break; } }
  const final = getCampaign(store, id);
  console.log(`served ${served} impressions; spent ${fromBaseUnits(final.spent, 3)} MELEK; status ${final.status}`);
}
