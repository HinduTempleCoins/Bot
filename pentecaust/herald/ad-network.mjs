// pentecaust/herald/ad-network.mjs — the Herald AD-NETWORK core: registries + ad-server select() + the
// first-dollar path. HERALD_AD_NETWORK_DESIGN.md §(d)1/6 + §(e).
//
// This is the small TO-BUILD that sits on top of the green rails:
//   • Registries — advertiser / publisher / creative / campaign records, injectable-storage + soft-fail,
//     modeled on lead-crm.mjs. (Escrow/accrual ledger settlement stays DESIGN-ONLY here — we count and
//     attribute; no money moves, nothing is signed or broadcast — BRIEF.md §7, HERALD.md §2.)
//   • select() — the ad-server slot pick. It reuses affiliate.rankListings + affiliate.assertRankingUnbiased
//     so RANKING CAN NEVER BE BOUGHT: sponsored units are segregated + labeled, never interleaved to outrank
//     organic (assertRankingUnbiased THROWS on violation — the moat). Every served unit carries
//     affiliate.disclose() (FTC).
//   • The first click-dollar path (§e) — register a campaign whose landing URL is a REAL affiliate offer
//     (env-named publisher id via affiliate.trackedLink — never fabricated, soft-fails to a plain link),
//     wire it onto the shipped /go/{code} rail (qr-tracker.registerCampaign), serve its creative in one slot,
//     then count a VALIDATED click (click-validate.classifyClicks) and attribute it to the affiliate account.
//     A converted click pays a real commission into the affiliate account (external fiat) — no new payout infra.
//
// House style: ESM, esc() all interpolation, soft-fail-never-throw, injectable storage/clock/fs, offline.
//
//   import { createAdNetwork } from './ad-network.mjs'
//   const net = createAdNetwork({ storage, now, fs, file });
//   net.registerAdvertiser({...}); net.registerPublisher({...}); net.registerCreative({...});
//   net.select({ slot:'sponsored', publisherId });      // → { ok, creative, html }  (ranking never bought)
//   net.firstDollarCampaign({ code, network, targetUrl, publisherId, bidCpc });
//   net.countValidatedClicks({ code, rawClicks, opts }); // → billable + accrual attribution (design-only)

import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { registerCampaign as qrRegisterCampaign, getCampaign as qrGetCampaign } from './qr-tracker.mjs';
import { classifyClicks } from './click-validate.mjs';
import {
  trackedLink, rankListings, assertRankingUnbiased, disclose, ftcDisclosure,
  networkConfigured, listNetworks,
} from '../../integrations/affiliate.mjs';

const envv = (k, d) => (typeof process !== 'undefined' && process.env && process.env[k]) || d;

export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const MAX_FIELD = 300;
const clean = (s) => String(s == null ? '' : s).trim();
const clamp = (s, n = MAX_FIELD) => clean(s).slice(0, n);
const toNum = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const isId = (s) => ID_RE.test(clean(s).toLowerCase());
const BASE_URL = () => (envv('BASE_URL', 'https://melek.salon') || 'https://melek.salon').replace(/\/$/, '');

// A fresh, in-memory store shape. Passing one into the factory makes it durable to the caller; omitting
// gives a private store. Never throws — a malformed storage is coerced into shape.
function normStore(storage) {
  const s = storage && typeof storage === 'object' ? storage : {};
  for (const k of ['advertisers', 'publishers', 'creatives', 'campaigns']) {
    if (!s[k] || typeof s[k] !== 'object') s[k] = {};
  }
  // accrual ledger — per-code counts + attribution. DESIGN-ONLY: no funds move here.
  if (!s.accrual || typeof s.accrual !== 'object') s.accrual = {};
  return s;
}

export function createAdNetwork(opts = {}) {
  const store = normStore(opts.storage);
  const clock = typeof opts.now === 'function' ? opts.now : () => Date.now();
  const ts = () => { try { return toNum(clock()); } catch { return 0; } };
  // fs/file are threaded into the shipped qr rail so the /go/{code} wiring is testable offline.
  const qrOpts = () => ({ fs: opts.fs, file: opts.file, now: ts() });

  // ── registries ────────────────────────────────────────────────────────────────────────────────────────
  function registerAdvertiser(input = {}) {
    const id = clean(input.id).toLowerCase();
    if (!isId(id)) return { ok: false, reason: 'advertiser id (a-z 0-9 -, ≤64) required' };
    const rec = {
      id,
      name: clamp(input.name),
      contact: clamp(input.contact),
      budgetUsd: toNum(input.budgetUsd),           // escrow amount — DESIGN-ONLY, no funds held here
      network: clamp(input.network),               // set when the "advertiser" is a real affiliate network
      createdAt: ts(),
    };
    store.advertisers[id] = rec;
    return { ok: true, advertiser: { ...rec } };
  }

  function registerPublisher(input = {}) {
    const id = clean(input.id).toLowerCase();
    if (!isId(id)) return { ok: false, reason: 'publisher id (a-z 0-9 -, ≤64) required' };
    const origins = Array.isArray(input.origins) ? input.origins.map((o) => clamp(o, 160)).filter(Boolean) : [];
    const rec = {
      id,
      name: clamp(input.name),
      origins,                                      // the per-tenant allow-list click-validate step 3 checks
      upline: clamp(input.upline),                 // ambassador referral subId (override attribution)
      payout: clamp(input.payout),                 // 'token' (member) | 'fiat' (MELEK-optional external)
      createdAt: ts(),
    };
    store.publishers[id] = rec;
    return { ok: true, publisher: { ...rec } };
  }

  function registerCreative(input = {}) {
    const id = clean(input.id).toLowerCase();
    if (!isId(id)) return { ok: false, reason: 'creative id (a-z 0-9 -, ≤64) required' };
    const rec = {
      id,
      advertiserId: clean(input.advertiserId).toLowerCase(),
      campaignId: clean(input.campaignId).toLowerCase(),
      code: clean(input.code).toLowerCase(),        // the /go/{code} the click-through targets
      headline: clamp(input.headline),
      body: clamp(input.body, 500),
      // honest-ranking signals (affiliate.rankListings sorts on these — NEVER on bid/commission)
      clarity: toNum(input.clarity),
      relevance: toNum(input.relevance),
      bidCpc: toNum(input.bidCpc),                  // the bid rides the click as `value`; it MUST NOT rank
      sponsored: input.sponsored !== false,         // ad units default to sponsored (labeled + segregated)
      house: input.house === true,                  // OUR-OWN-SITE promo (organic, no Sponsored badge, no nofollow)
      createdAt: ts(),
    };
    store.creatives[id] = rec;
    return { ok: true, creative: { ...rec } };
  }

  const getAdvertiser = (id) => store.advertisers[clean(id).toLowerCase()] || null;
  const getPublisher = (id) => store.publishers[clean(id).toLowerCase()] || null;
  const getCreative = (id) => store.creatives[clean(id).toLowerCase()] || null;
  const listCreatives = () => Object.values(store.creatives).map((c) => ({ ...c }));

  // originsOf — the resolver click-validate uses to enforce the per-publisher origin allow-list.
  function originsOf(publisherId) {
    const p = getPublisher(publisherId);
    return p && Array.isArray(p.origins) ? p.origins.slice() : null;
  }

  // ── render one ad unit (escaped) — the click-through is /go/{code}; disclosure is always attached ────────
  function renderUnit(creative) {
    const c = creative || {};
    const href = `${BASE_URL()}/go/${esc(clean(c.code).toLowerCase())}`;
    // OUR-OWN-SITE house promo is organic content, not a paid ad: no "Sponsored" badge, a follow link (no
    // rel=sponsored/nofollow — it's our own site), and no FTC disclosure (nothing is commissioned).
    if (c.house) {
      return `<div class="herald-house" data-creative="${esc(c.id)}" data-house="true">`
        + `<a class="house-cta" href="${href}" rel="noopener">`
        + `<span class="house-headline">${esc(c.headline || 'Join MELEK')}</span>`
        + (c.body ? `<span class="house-body">${esc(c.body)}</span>` : '')
        + `</a></div>`;
    }
    const badge = c.sponsored ? '<span class="ad-badge" aria-label="sponsored">Sponsored</span>' : '';
    const card =
      `<div class="herald-ad" data-creative="${esc(c.id)}"${c.sponsored ? ' data-sponsored="true"' : ''}>`
      + `<a class="ad-cta" href="${href}" rel="sponsored nofollow noopener" target="_blank">`
      + `<span class="ad-headline">${esc(c.headline || 'Sponsored')}</span>`
      + (c.body ? `<span class="ad-body">${esc(c.body)}</span>` : '')
      + `</a>${badge}</div>`;
    return disclose(card); // FTC — the always-on guarantee
  }

  /**
   * select — the ad-server slot pick. Gathers candidate creatives (a passed `candidates` list, else the
   * registry), ranks them with affiliate.rankListings (honest signal = clarity → relevance, NEVER bid), and
   * PROVES the order was not bought via affiliate.assertRankingUnbiased (throws on violation → we catch it
   * and refuse the fill rather than serving a biased slot). Returns the chosen unit for the slot.
   *   slot: 'sponsored' (default — pick top sponsored) | 'organic' (pick top organic).
   */
  function select({ slot = 'sponsored', publisherId, candidates } = {}) {
    let items = Array.isArray(candidates) ? candidates.slice() : listCreatives();
    if (publisherId) {
      // A creative may be scoped to a campaign/publisher later; for now all registered creatives are eligible.
      items = items.filter(Boolean);
    }
    if (!items.length) return { ok: false, reason: 'no creatives available' };

    const ranked = rankListings(items);
    const organicBaseline = rankListings(items.filter((x) => !x?.sponsored));
    try {
      // The moat: this THROWS if a paid/sponsored unit was ranked above an organic one.
      assertRankingUnbiased(organicBaseline, ranked);
    } catch (e) {
      return { ok: false, reason: 'ranking-bias-refused', detail: String((e && e.message) || e) };
    }

    const wantSponsored = clean(slot).toLowerCase() !== 'organic';
    const pick = ranked.find((x) => (wantSponsored ? !!x.sponsored : !x.sponsored)) || null;
    if (!pick) return { ok: false, reason: `no ${wantSponsored ? 'sponsored' : 'organic'} creative for slot` };

    return { ok: true, slot: wantSponsored ? 'sponsored' : 'organic', creative: { ...pick }, html: renderUnit(pick) };
  }

  /**
   * firstDollarCampaign — the §(e) minimal first increment. The "advertiser" is a REAL affiliate network:
   * affiliate.trackedLink tags the destination with our env-named publisher id (never fabricated; soft-fails
   * to a plain link + tracked:false when the env is unset). We then wire the tracked URL onto the shipped
   * /go/{code} rail and register the creative + campaign. A converted click pays a real commission into the
   * affiliate account — the first click-dollar — with no new payout infra.
   *   { code, network, targetUrl, publisherId, bidCpc, subId, label, headline, body, clarity, relevance }
   */
  function firstDollarCampaign(input = {}) {
    const code = clean(input.code).toLowerCase();
    if (!isId(code)) return { ok: false, reason: 'campaign code (a-z 0-9 -, ≤64) required' };
    const network = clean(input.network).toLowerCase();
    const targetUrl = clean(input.targetUrl);
    if (!/^https?:\/\//i.test(targetUrl)) return { ok: false, reason: 'targetUrl (http/https) required' };

    // 1. tag the destination with the env-named affiliate id (never fabricated).
    const link = trackedLink(network, targetUrl, { subId: input.subId });

    // 2. wire it onto the shipped /go/{code} rail (qr-tracker owns the log + 301 redirect).
    const reg = qrRegisterCampaign(code, { landingUrl: link.url, label: clamp(input.label) }, qrOpts());
    if (!reg.ok) return { ok: false, reason: `qr rail rejected code: ${reg.reason}` };

    // 3. register advertiser (the affiliate network) + creative + campaign in our registries.
    const advId = network && isId(network) ? network : 'affiliate';
    if (!getAdvertiser(advId)) registerAdvertiser({ id: advId, name: `Affiliate: ${network || 'network'}`, network });
    const creative = registerCreative({
      id: `${code}-cr`,
      advertiserId: advId,
      campaignId: code,
      code,
      headline: input.headline || clamp(input.label) || 'Featured offer',
      body: input.body,
      clarity: input.clarity,
      relevance: input.relevance,
      bidCpc: input.bidCpc,
      sponsored: true,
    });

    const campaign = {
      id: code,
      code,
      advertiserId: advId,
      network: network || null,
      landingUrl: link.url,
      tracked: link.tracked === true,           // false (plain link) until the affiliate env id is set
      configured: link.configured === true,
      bidCpc: toNum(input.bidCpc),
      publisherId: clean(input.publisherId).toLowerCase() || null,
      subId: clamp(input.subId),
      createdAt: ts(),
    };
    store.campaigns[code] = campaign;

    return {
      ok: true,
      campaign: { ...campaign },
      creative: creative.ok ? creative.creative : null,
      disclosure: link.disclosure || ftcDisclosure(),
      tracked: campaign.tracked,
      configured: campaign.configured,
      reason: campaign.tracked ? undefined : (link.reason || 'affiliate id not configured — link is plain until env set'),
    };
  }

  /**
   * houseCampaign — the USER-ACQUISITION rail: promote ONE OF OUR OWN destinations (wallet.melek.salon
   * signup, kula.money, the PRANA miner, a SoapBox vertical) on the shipped /go/{code} rail. Unlike
   * firstDollarCampaign this is NOT an affiliate offer — there is no external network and no trackedLink.
   * The landing URL is our own site, verbatim; the /go rail adds UTM attribution on redirect and logs the
   * click, so scanStats() counts exactly how many visitors each campaign sent into our sign-up funnels.
   * The "advertiser" is us (the MELEK ecosystem, house). No funds move, nothing is signed (BRIEF.md §7).
   *   { code, targetUrl, publisherId, headline, body, clarity, relevance, cta, label, product }
   */
  function houseCampaign(input = {}) {
    const code = clean(input.code).toLowerCase();
    if (!isId(code)) return { ok: false, reason: 'campaign code (a-z 0-9 -, ≤64) required' };
    const targetUrl = clean(input.targetUrl);
    if (!/^https?:\/\//i.test(targetUrl)) return { ok: false, reason: 'targetUrl (http/https) required' };

    // 1. wire OUR destination onto the /go/{code} rail, verbatim (no affiliate tag). qr adds UTM on redirect.
    const reg = qrRegisterCampaign(code, { landingUrl: targetUrl, label: clamp(input.label) }, qrOpts());
    if (!reg.ok) return { ok: false, reason: `qr rail rejected code: ${reg.reason}` };

    // 2. the "advertiser" is us — the MELEK ecosystem (house). No external network, no commission.
    const advId = 'melek';
    if (!getAdvertiser(advId)) registerAdvertiser({ id: advId, name: 'MELEK ecosystem (house)' });
    const creative = registerCreative({
      id: `${code}-cr`, advertiserId: advId, campaignId: code, code,
      headline: input.headline || clamp(input.label) || 'Join MELEK',
      body: input.body, clarity: input.clarity, relevance: input.relevance,
      sponsored: false, house: true,
    });

    const campaign = {
      id: code, code, advertiserId: advId, network: null,
      house: true, product: clamp(input.product) || null,
      landingUrl: targetUrl, tracked: true, configured: true,
      publisherId: clean(input.publisherId).toLowerCase() || null,
      cta: clamp(input.cta) || null, createdAt: ts(),
    };
    store.campaigns[code] = campaign;
    return { ok: true, campaign: { ...campaign }, creative: creative.ok ? creative.creative : null };
  }

  /**
   * countValidatedClicks — run the billable-click / fraud pass over the raw /go log and ACCRUE the validated
   * clicks to the campaign's ledger, attributed to the affiliate/advertiser. Settlement is DESIGN-ONLY: this
   * records counts + spend (billable × bidCpc) + the attribution target; no funds move, nothing is signed.
   *   { code, rawClicks, opts? }  opts is forwarded to click-validate (windowMs / rateCaps / extraBotRe...).
   */
  function countValidatedClicks({ code, rawClicks, opts: cvOpts } = {}) {
    const c = clean(code).toLowerCase();
    const campaign = store.campaigns[c] || null;
    const result = classifyClicks(rawClicks, { originsOf, ...(cvOpts || {}) });
    const billable = toNum(result.byCode[c]);
    const bid = campaign ? toNum(campaign.bidCpc) : 0;

    const ledger = store.accrual[c] || {
      code: c,
      advertiserId: campaign ? campaign.advertiserId : null,
      network: campaign ? campaign.network : null,
      billableClicks: 0,
      advertiserDebitUsd: 0,          // what the advertiser owes (design-only)
      attribution: campaign && campaign.network
        ? `affiliate account (external fiat) — commission accrues off-platform to ${campaign.network}`
        : 'no affiliate network on campaign',
      settlement: 'design-only (no funds move in this module — BRIEF.md §7)',
    };
    ledger.billableClicks += billable;
    ledger.advertiserDebitUsd = Math.round((ledger.billableClicks * bid) * 1e4) / 1e4;
    ledger.updatedAt = ts();
    store.accrual[c] = ledger;

    return { ok: true, code: c, billable, bidCpc: bid, validation: result, accrual: { ...ledger } };
  }

  const accrualFor = (code) => { const l = store.accrual[clean(code).toLowerCase()]; return l ? { ...l } : null; };

  // ── optional HTTP surface ──────────────────────────────────────────────────────────────────────────────
  const sendJson = (res, sc, obj) => {
    try { res.writeHead(sc, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); } catch {}
    try { res.end(JSON.stringify(obj)); } catch {}
  };
  const sendHtml = (res, sc, html) => {
    try { res.writeHead(sc, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }); } catch {}
    try { res.end(html == null ? '' : html); } catch {}
  };

  // GET /health ; GET /ad/select?slot=&publisher= → served unit HTML (disclosed, /go/{code} click-through).
  async function handler(req, res) {
    try {
      const method = ((req && req.method) || 'GET').toUpperCase();
      const rawUrl = String((req && req.url) || '/');
      const qi = rawUrl.indexOf('?');
      const path = (qi >= 0 ? rawUrl.slice(0, qi) : rawUrl).replace(/\/+$/, '') || '/';
      const query = new URLSearchParams(qi >= 0 ? rawUrl.slice(qi + 1) : '');

      if (path === '/health' && method === 'GET') {
        return sendJson(res, 200, { ok: true, service: 'herald-ad-network', creatives: Object.keys(store.creatives).length });
      }
      if (path === '/ad/select' && method === 'GET') {
        const r = select({ slot: query.get('slot') || 'sponsored', publisherId: query.get('publisher') || undefined });
        if (!r.ok) return sendHtml(res, 200, `<!-- herald: ${esc(r.reason)} -->`);
        return sendHtml(res, 200, r.html);
      }
      return sendJson(res, 404, { ok: false, reason: 'not-found' });
    } catch {
      return sendJson(res, 500, { ok: false, reason: 'error' });
    }
  }

  return {
    registerAdvertiser, registerPublisher, registerCreative,
    getAdvertiser, getPublisher, getCreative, listCreatives,
    originsOf, renderUnit, select,
    houseCampaign, firstDollarCampaign, countValidatedClicks, accrualFor,
    handler, store,
  };
}

// listAffiliateNetworks — surfaces which affiliate networks are configured (env id present), so the
// first-dollar setup can pick a live one. Thin pass-through to affiliate.listNetworks.
export function listAffiliateNetworks() {
  try { return listNetworks(); } catch { return []; }
}
export { networkConfigured };

// ── CLI (guarded) — demo the first-dollar path against an in-memory store (no disk, no network) ──────────
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const memFs = (() => { const box = { data: null }; return { read: () => box.data, write: (_p, s) => { box.data = s; } }; })();
  const net = createAdNetwork({ fs: memFs, file: '/mem/qr.json' });
  const fd = net.firstDollarCampaign({
    code: 'offer-01', network: 'impact', targetUrl: 'https://example.com/deal',
    publisherId: 'melek-salon', bidCpc: 0.25, headline: 'Try the offer', clarity: 5, relevance: 5,
  });
  const served = net.select({ slot: 'sponsored', publisherId: 'melek-salon' });
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({
    firstDollar: { ok: fd.ok, tracked: fd.tracked, configured: fd.configured, landingUrl: fd.campaign && fd.campaign.landingUrl },
    served: { ok: served.ok, slot: served.slot },
    networksConfigured: listAffiliateNetworks().filter((n) => n.configured).map((n) => n.key),
  }, null, 2));
}
