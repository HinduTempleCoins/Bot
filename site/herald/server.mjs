// server.mjs — Herald (the MELEK/Pentecaust growth engine's public surface). ONE dashboard that ties
// the Herald modules together into the "AI does your marketing, executed" product, in the SoapBox house
// style (mirrors site/hemp, site/witness). Hathor / the Giant Bot IS the marketing team; Herald is its
// front. Read-only server: holds no key, signs nothing.
//
//   PORT=8163 BASE_URL=https://herald.soapbox.community node site/herald/server.mjs
//
// ── Routes ──────────────────────────────────────────────────────────────────────────────────────
//   /            the growth-engine dashboard — capabilities grouped Create / Rank / Run / Reach / Grow
//   /prompts     the live prompt-pack library (pulled from pentecaust/herald/prompt-packs.mjs)
//   /health /robots.txt /sitemap.xml
//
// ── DISCIPLINE ────────────────────────────────────────────────────────────────────────────────────
//   Facts, not hype: each capability card states what the module actually does. esc() on every
//   interpolated value. Soft-fail: renders even if a module read returns nothing. No key, read-only.
import { createServer } from 'node:http';
import { listPacks } from '../../pentecaust/herald/prompt-packs.mjs';
// Live handlers mounted below. Each is verified to always end the response (JSON API or HTML/redirect),
// so delegating req/res is safe; a throw is caught and soft-failed. Prefix-mounted API modules get
// req.url stripped of the prefix so they see their own native paths (/api/plan, /health, …).
import { handler as seoHandler } from '../../pentecaust/herald/seo-execution.mjs';
import { handler as campaignHandler } from '../../pentecaust/herald/campaign-planner.mjs';
import { handler as analyticsHandler } from '../../pentecaust/herald/analytics.mjs';
import { handler as outreachHandler } from '../../pentecaust/herald/outreach-db.mjs';
import { handler as qrHandler } from '../../pentecaust/herald/qr-tracker.mjs';
// The ad-network is stateful (advertiser/publisher/creative registries live in a per-instance store), so
// unlike the pure modules above we hold ONE singleton and mount its handler. click-validate is pure and
// exports its handler directly. Both are read-only over HTTP — no key held, nothing signed, no funds move.
import { createAdNetwork } from '../../pentecaust/herald/ad-network.mjs';
import { handler as clickValidateHandler } from '../../pentecaust/herald/click-validate.mjs';
import { handler as iftttHandler } from '../../pentecaust/herald/ifttt-triggers.mjs';
// The campaign-sender is stateful (lists/subscribers/templates/queue live in a store), so like the
// ad-network we mount its singleton handler. Native-path routes only — /health stays owned by the server.
import { handler as senderHandler, _singleton as senderSingleton } from '../../pentecaust/herald/campaign-sender.mjs';
// The lead CRM — top-of-funnel capture. Backed by a disk-persisted Map-like store so leads from the public
// capture form AND the Hathor chat bridge survive restarts. Holds no key; a lead is an internal pipeline
// record only — it is NEVER auto-subscribed to bulk email (sending stays double-opt-in via /api/subscribe).
import { createLeadCrm } from '../../pentecaust/herald/lead-crm.mjs';
import { readFileSync as _readFileSync, writeFileSync as _writeFileSync, mkdirSync as _mkdirSync } from 'node:fs';
import { join as _join, dirname as _dirname } from 'node:path';
// The dispatcher is stateful (in-app inbox lives in a store), so like the ad-network / campaign-sender we
// mount its singleton handler. It's the execution rail for fired triggers — email (via the sender's ESP
// seam), Telegram, Discord, generic webhook, and an in-app inbox; every channel unconfigured → soft no-op,
// and it NEVER signs, pays, or broadcasts (reward/post triggers are Signer-only).
import { handler as dispatchHandler } from '../../pentecaust/herald/dispatcher.mjs';
// The ad-auction sells PREMIUM featured slots by sealed-bid second-price (Vickrey) auction — the auction-house
// side of the ad network (ad-network.mjs is the remnant/click side). Stateful (auctions live in a store), so
// we hold a singleton and mount its handler. Auctions touch ONLY premium slots — organic ranking is never
// bought. Settlement is design-only: no funds move, nothing signed.
import { createAdAuction } from '../../pentecaust/herald/ad-auction.mjs';
// The ad-embed is the PUBLIC LAYER over the ad-network engine: the embeddable <iframe> ad unit + the
// copy-paste snippet a publisher pastes on their site / video description / Herald-built page. It holds no
// key, moves no funds, signs nothing — it renders the engine's disclosed unit and routes the click through
// the /go rail for rev-share attribution. We bind it to the ad-network singleton's select + originsOf below.
import { handler as adEmbedHandler, snippet as adSnippet } from '../../pentecaust/herald/ad-embed.mjs';
// The GROWTH FUNNEL — the one number that answers "are we getting users?". Reads real signals the ecosystem
// already produces (the /go click rail, the lead CRM, the opt-in sender, the invite viral tree) and shapes
// them into Reach → Leads → Subscribers → Signups. Read-only, soft-fail, holds no key. This is Herald's
// scoreboard now that its job is user acquisition for OUR sites (not affiliate commissions off other brands).
import { funnelHandler, collectFunnel, renderFunnelHtml } from '../../pentecaust/herald/growth-funnel.mjs';
import { scanStats as qrScanStats } from '../../pentecaust/herald/qr-tracker.mjs';
import { inviteStats } from '../../signup/invites.mjs';
import { DESTINATIONS } from '../../pentecaust/herald/launch-campaign.mjs';

const PORT = +(process.env.PORT || 8163);
const HOST = process.env.HOST || '127.0.0.1';
const BASE_URL = (process.env.BASE_URL || 'https://herald.soapbox.community').replace(/\/$/, '');

export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// The growth engine, grouped the way the vision lays it out. Each = a real Herald module.
export const CAPABILITIES = [
  ['Grow', [
    ['Growth funnel', 'The live user-acquisition scoreboard: Reach → Leads → Subscribers → Signups, with per-campaign reach and step conversion. Read: GET /api/funnel.', 'growth-funnel', '/api/funnel'],
    ['Launch campaigns', 'The /go traffic rail that drives real users to our own funnels — MELEK signup, KulaSwap, the PRANA miner pool — plus the opt-in email nurture. House campaigns to OUR sites, not affiliate offers.', 'launch-campaign', null],
    ['Invite viral tree', 'MELEK is invite-only: every account carries invites, and the tree tracks who pulled whom in. The outstanding-invite count is the growth still in flight.', 'invites', null],
  ]],
  ['Create', [
    ['Prompt packs', 'Plug-and-play prompts for content, links & keywords — run through Hathor.', 'prompt-packs', '/prompts'],
    ['Ad maker', 'Generate scroll-stopping static & video ad creative (SVG→PNG, 4 styles).', 'ad-maker', null],
  ]],
  ['Rank', [
    ['SEO execution', 'Turn an SEO intent into an ordered, approval-gated plan: technical, content, authority, AI-search, deploy.', 'seo-execution', null],
    ['Backlink exchange', 'A member backlink network — one-to-one dupe control, spaced rotation, fair distribution.', 'link-exchange', null],
    ['PR pipeline', 'Distribute press releases + pitch news outlets; HARO/journalist-request monitoring.', 'pr-pipeline', null],
  ]],
  ['Run', [
    ['Crossposter', 'Publish once, syndicate across surfaces and chains.', 'crossposter', null],
    ['Campaign planner', 'A staged growth plan per brand — content → distribution → authority → convert.', 'campaign-planner', null],
    ['Trigger dispatch', 'The execution rail for fired triggers: fan one out to email, Telegram, Discord, a webhook, or an in-app inbox. Unconfigured channels soft no-op; it never signs, pays, or broadcasts.', 'dispatcher', null],
  ]],
  ['Reach', [
    ['Outreach DB', 'The shared, live outreach / backlink tracker (the 151-row tracker, as a system). Sign-in required.', 'outreach-db', '/outreach'],
    ['Lead CRM', 'Verified-only lead capture + a CRM pipeline (only count contacts you can verify). Live: POST /api/capture (chat/opt-in bridge) + /api/lead; read /api/leads.', 'lead-crm', '/api/leads'],
    ['QR tracker', 'Trackable QR codes for offline→online attribution.', 'qr-tracker', null],
    ['Campaign sender', 'The owned sending layer: lists, subscribers, templates, one-shot campaigns + drip/journeys, a durable send-queue, one-click unsubscribe & bounce/complaint suppression (CAN-SPAM). ESP behind an injectable seam — email only.', 'campaign-sender', null],
  ]],
  ['Monetize', [
    ['Earn as a publisher', 'Drop one <iframe> ad unit on your site, video description, or Herald-built page and earn a rev-share per click. MELEK-optional — email + payout destination, no account required; connect MELEK-Signer later to upgrade to token payouts.', 'ad-embed', '/monetize'],
    ['Advertise (buy clicks)', 'Create a campaign — creative + landing URL + CPC bid — as a keyless intent. Funding/escrow/settlement is design-only; funds move only via MELEK-Signer later.', 'ad-network', '/advertise'],
    ['Ad network', 'Advertisers + creators earn/pay per click. Ranking can never be bought — sponsored units are segregated, labeled & FTC-disclosed, click-through on the /go rail.', 'ad-network', '/ad/select'],
    ['Click validate', 'The billable-click / fraud pass over the /go log: window-dedup, crawler filter, per-publisher origin allow-list, rate caps, sybil-gated payout (POST /api/click-validate).', 'click-validate', null],
    ['Ad auction', 'Sell premium featured slots by sealed-bid second-price (Vickrey) auction — winner pays the second-highest bid or the reserve. Premium slots only; organic ranking is never bought. Settlement is design-only.', 'ad-auction', '/ad/premium'],
  ]],
  ['Verify', [
    ['Verifier', 'Confirm placements/backlinks actually went live — no vanity metrics.', 'verifier', null],
  ]],
];

const STYLE = `<style>
 :root{--bg:#0b0d12;--panel:#141a24;--line:#232c3a;--fg:#e9eef5;--mut:#8896a6;--blue:#1d9bf0;--gold:#d9a441;--grn:#3fb950}
 *{box-sizing:border-box} body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.55 -apple-system,Segoe UI,Roboto,Arial,sans-serif}
 a{color:inherit;text-decoration:none} .wrap{max-width:960px;margin:0 auto;padding:0 18px}
 header{padding:26px 0 8px;border-bottom:1px solid var(--line);margin-bottom:20px}
 .brand{font-weight:800;font-size:26px;color:var(--gold)} .brand b{color:var(--fg)}
 .alpha{font-size:11px;font-weight:700;color:#1a1305;background:var(--gold);border-radius:6px;padding:2px 7px;margin-left:6px;vertical-align:middle}
 .lead{color:var(--mut);max-width:640px;margin:10px 0 0}
 h2{font-size:14px;text-transform:uppercase;letter-spacing:.08em;color:var(--gold);margin:26px 0 10px}
 .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px}
 .card{border:1px solid var(--line);border-radius:12px;padding:15px 16px;background:var(--panel)}
 .card:hover{border-color:var(--blue)} .card .t{font-weight:700;font-size:16px} .card .d{color:var(--mut);font-size:13px;margin-top:5px}
 .card .m{font-size:11px;color:var(--grn);margin-top:8px;font-family:ui-monospace,monospace}
 .card.link .t::after{content:' →';color:var(--blue)}
 footer{color:var(--mut);font-size:12px;margin:34px 0 24px;border-top:1px solid var(--line);padding-top:14px}
 .back{color:var(--blue)} .pack{border:1px solid var(--line);border-radius:12px;padding:15px;background:var(--panel);margin-bottom:12px}
 .pack h3{margin:0 0 4px} .pack .cat{font-size:11px;color:var(--gold);text-transform:uppercase} .pack .p{color:var(--mut);font-size:13px;margin-top:8px;border-top:1px solid var(--line);padding-top:8px}
 h1{font-size:24px;margin:8px 0 0} .sec{border:1px solid var(--line);border-radius:12px;padding:15px 16px;background:var(--panel);margin:14px 0}
 .sec h3{margin:0 0 8px;font-size:15px} .sec p{color:var(--mut);font-size:13px;margin:6px 0}
 pre.snip{background:#0a0c10;border:1px solid var(--line);border-radius:8px;padding:12px;overflow-x:auto;font-family:ui-monospace,monospace;font-size:12px;color:#cfe3ff;white-space:pre-wrap;word-break:break-all}
 form.f{display:grid;gap:10px;max-width:520px;margin-top:6px} form.f label{font-size:12px;color:var(--mut);display:grid;gap:4px}
 form.f input,form.f select{background:#0a0c10;border:1px solid var(--line);border-radius:8px;padding:8px 10px;color:var(--fg);font:inherit}
 form.f button{background:var(--blue);color:#04121f;border:0;border-radius:8px;padding:9px 14px;font-weight:700;cursor:pointer;justify-self:start}
 .note{font-size:12px;color:var(--gold);border-left:3px solid var(--gold);padding:6px 10px;margin:10px 0;background:rgba(217,164,65,.07)}
 .intent{border:1px solid var(--grn)} .intent h3{color:var(--grn)}
</style>`;

function pageShell(title, inner, desc = '') {
  return `<!doctype html><html lang=en><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<meta name=description content="${esc(desc || 'Herald — the MELEK growth engine: AI marketing, executed.')}">${STYLE}</head><body><div class=wrap>${inner}
<footer>Herald — the MELEK / Pentecaust growth engine. Facts, not hype: each capability is a real module. Read-only.</footer>
</div></body></html>`;
}

export function homePage() {
  const groups = CAPABILITIES.map(([group, items]) => `<h2>${esc(group)}</h2><div class=grid>${
    items.map(([t, d, m, href]) => {
      const inner = `<div class=t>${esc(t)}</div><div class=d>${esc(d)}</div><div class=m>${esc(m)}</div>`;
      return href ? `<a class="card link" href="${esc(href)}">${inner}</a>` : `<div class=card>${inner}</div>`;
    }).join('')
  }</div>`).join('');
  let funnelHtml = '';
  try { funnelHtml = renderFunnelHtml(collectFunnel(funnelDeps)); } catch { funnelHtml = ''; }
  const funnelSection = funnelHtml
    ? `<h2>Are we getting users?</h2><div class=sec><h3>Growth funnel — live</h3>
        <p class=lead style="margin:0 0 10px">The scoreboard: real people driven to our own sites, down to the ones who claim an account. Reach is /go clicks to melek.salon signup, KulaSwap and the miner pool; signups come from the invite tree.</p>
        ${funnelHtml}</div>`
    : '';
  const body = `<header><span class=brand>◇ <b>Herald</b></span><span class=alpha>ALPHA</span>
    <p class=lead>The <b>user-acquisition</b> engine of the MELEK ecosystem — it drives real people to our own
    sites (MELEK social, KulaSwap DeFi, the PRANA miner pool), <b>executed</b> (not just tracked) by Hathor.
    One AI growth team; these are its tools.</p></header>${funnelSection}${groups}`;
  return pageShell('Herald — the MELEK growth engine', body, 'Herald: user acquisition for the MELEK ecosystem — drive real users to melek.salon, KulaSwap and the PRANA miner pool, measured end to end.');
}

export function promptsPage() {
  let packs = [];
  try { packs = listPacks() || []; } catch { packs = []; }
  const cards = packs.length
    ? packs.map((p) => `<div class=pack><div class=cat>${esc(p.category || '')}</div><h3>${esc(p.title || p.id)}</h3>
        <div class=d style="color:var(--mut);font-size:13px">${esc(p.goal || '')}</div>
        ${(p.prompts || []).map((pr) => `<div class=p><b>${esc(pr.title || '')}</b></div>`).join('')}</div>`).join('')
    : `<p style="color:var(--mut)">The prompt library is loading — check back shortly.</p>`;
  const body = `<header><a class=back href="/">← Herald</a><h1 style="margin:8px 0 0">Prompt packs</h1>
    <p class=lead>Traffic-driving prompt packs for content, links & keywords — model-agnostic, run through Hathor.</p></header>${cards}`;
  return pageShell('Prompt packs — Herald', body, 'Herald prompt packs: plug-and-play prompts for content, links and keywords.');
}

// /monetize — the publisher / creator self-serve page (keyless). Explains earning a rev-share per click as
// a Herald publisher (us, web-builder customers, external YouTubers/TikTokers), the MELEK-OPTIONAL sign-up
// (email + payout destination now; connect MELEK-Signer later to UPGRADE to token payouts — described, not
// implemented), and shows a real copy-paste embed snippet built from ad-embed.snippet(). No funds, no key.
export function monetizePage(searchParams) {
  const q = searchParams || new URLSearchParams();
  let sample = '';
  try { sample = adSnippet('your-publisher-id', 'sponsored', { size: 'mrec', baseUrl: BASE_URL }); }
  catch { sample = ''; }

  // A submitted sign-up echoes a design-only registration INTENT — nothing is stored, no funds move.
  const email = (q.get('email') || '').trim();
  const payout = (q.get('payout') || '').trim();
  const origin = (q.get('origin') || '').trim();
  let intent = '';
  if (email || payout || origin) {
    const rec = {
      role: 'publisher', melekOptional: true, payoutRail: 'fiat (external creator) — upgradeable to token via MELEK-Signer',
      email: email || '(none)', payoutDestination: payout || '(none)', origin: origin || '(none)',
      status: 'design-only intent — not stored, no account created, no funds move',
    };
    intent = `<div class="sec intent"><h3>Your sign-up intent (design-only)</h3>
      <p>This is a preview. Nothing was stored and no account was created — connecting MELEK-Signer later is what turns this into a live, token-paid publisher.</p>
      <pre class=snip>${esc(JSON.stringify(rec, null, 2))}</pre></div>`;
  }

  const body = `<header><a class=back href="/">← Herald</a><h1>Monetize — earn as a publisher</h1>
    <p class=lead>Sell your ad space on the Herald network. Advertisers pay per click; you keep a rev-share of
    every valid click your placement delivers. For us, for people who build their site with us, and for
    external YouTubers / TikTokers / bloggers — <b>no MELEK account required</b>.</p></header>

    <div class=sec><h3>1. Grab your ad unit</h3>
      <p>Paste this <b>plain &lt;iframe&gt;</b> where you want the ad — a page, a sidebar, a video description
      link-out, or a Herald-built site. No third-party JavaScript to trust. Every unit carries the required
      <b>"Ad"</b> disclosure label and routes the click through the <code>/go</code> rail so it's credited to you.</p>
      <pre class=snip>${esc(sample)}</pre>
      <p>Swap <code>your-publisher-id</code> for the id you get on sign-up. Sizes: <code>mrec</code> (300×250),
      <code>leaderboard</code> (728×90), <code>banner</code> (468×60), <code>mobile</code> (320×50),
      <code>halfpage</code> (300×600), <code>square</code> (250×250).</p></div>

    <div class=sec><h3>2. Sign up — MELEK-optional</h3>
      <p>Start with just an <b>email</b> and a <b>payout destination</b>. No wallet, no chain, no MELEK account.
      External creators are paid in <b>fiat</b>. Later, connect <b>MELEK-Signer</b> (scoped, revocable, zero-key)
      to <b>upgrade</b> to token payouts + curation-trail bonuses — a strict upgrade, never a gate.</p>
      <form class=f method=get action="/monetize">
        <label>Email<input name=email type=email placeholder="you@example.com" value="${esc(email)}"></label>
        <label>Payout destination<input name=payout placeholder="PayPal email / bank / (connect MELEK-Signer for token)" value="${esc(payout)}"></label>
        <label>Your site's origin host (for the click allow-list)<input name=origin placeholder="example.com" value="${esc(origin)}"></label>
        <button type=submit>Preview sign-up</button>
      </form>
      <div class=note>Design-only: this page holds no key, stores nothing, and moves no funds. Live payouts run
      only through MELEK-Signer custody or a PCI-safe payouts rail.</div>
    </div>${intent}`;
  return pageShell('Monetize — earn as a Herald publisher', body, 'Earn a rev-share per click: paste one iframe ad unit anywhere. MELEK-optional — email + payout destination, upgrade to token payouts via MELEK-Signer.');
}

// /advertise — the advertiser self-serve page (keyless). Explains buying clicks and builds a campaign as a
// KEYLESS INTENT from the form fields. Funding/escrow/settlement is DESIGN-ONLY — no money moves here; funds
// move only via MELEK-Signer later. The page stores nothing and holds no key.
export function advertisePage(searchParams) {
  const q = searchParams || new URLSearchParams();
  const headline = (q.get('headline') || '').trim();
  const bodyText = (q.get('body') || '').trim();
  const landing = (q.get('landing') || '').trim();
  const cpc = (q.get('cpc') || '').trim();
  const budget = (q.get('budget') || '').trim();

  let intent = '';
  if (headline || landing) {
    const validUrl = /^https?:\/\//i.test(landing);
    const bid = Number(cpc); const bud = Number(budget);
    const rec = {
      type: 'campaign-intent', headline: headline || '(none)', body: bodyText || '(none)',
      landingUrl: validUrl ? landing : '(needs http/https URL)',
      cpcBidUsd: Number.isFinite(bid) && bid > 0 ? bid : '(set a positive CPC)',
      budgetUsd: Number.isFinite(bud) && bud > 0 ? bud : '(optional)',
      funding: 'NOT LIVE — design-only. No escrow, no charge, no settlement in this page.',
      settlement: 'funds move only via MELEK-Signer custody (unsigned calls) or a PCI-safe billing rail — later.',
      ranking: 'sponsored units are segregated, labeled & FTC-disclosed; ranking can never be bought.',
    };
    intent = `<div class="sec intent"><h3>Your campaign intent (design-only)</h3>
      <p>This is the intent your inputs build — a plan, not a purchase. No card was charged, no escrow was
      funded, nothing was broadcast.</p>
      <pre class=snip>${esc(JSON.stringify(rec, null, 2))}</pre></div>`;
  }

  const body = `<header><a class=back href="/">← Herald</a><h1>Advertise — buy clicks</h1>
    <p class=lead>Reach the MELEK ecosystem and the open network of creators who run Herald ad units. You pay
    per <b>billable</b> click — deduped, crawler-filtered, origin-checked. Ranking is <b>never</b> for sale:
    sponsored units are segregated, labeled, and FTC-disclosed.</p></header>

    <div class=sec><h3>Create a campaign (keyless intent)</h3>
      <p>Give your creative, a landing URL, and a CPC bid. Submitting builds a <b>campaign intent</b> only —
      a plan you can review. <b>Funding, escrow, and settlement are not live</b> (design-only); funds move
      only through MELEK-Signer later.</p>
      <form class=f method=get action="/advertise">
        <label>Headline<input name=headline placeholder="Try the offer" value="${esc(headline)}"></label>
        <label>Body (optional)<input name=body placeholder="One clear line about the offer." value="${esc(bodyText)}"></label>
        <label>Landing URL<input name=landing type=url placeholder="https://example.com/deal" value="${esc(landing)}"></label>
        <label>CPC bid (USD)<input name=cpc type=number step="0.01" min="0" placeholder="0.25" value="${esc(cpc)}"></label>
        <label>Budget (USD, optional)<input name=budget type=number step="1" min="0" placeholder="100" value="${esc(budget)}"></label>
        <button type=submit>Build campaign intent</button>
      </form>
      <div class=note>Design-only: no money moves on this page. It holds no key, signs nothing, and charges
      nothing. Escrow + settlement are a later MELEK-Signer build.</div>
    </div>${intent}`;
  return pageShell('Advertise — buy clicks on Herald', body, 'Buy clicks on the Herald ad network: build a campaign intent (creative + landing URL + CPC bid). Keyless — funding and settlement are design-only.');
}

function send(res, html, code = 200) { res.writeHead(code, { 'content-type': 'text/html; charset=utf-8' }); res.end(html); }

// Live module mounts. Prefix-mounted API modules (rewrite set) get req.url stripped so they see their
// own native paths; native-path modules (rewrite null) get req.url unchanged. Every fn always ends the
// response; a throw is caught below. Read-only server: these modules hold no key of ours.
// Load the persisted ad store (written by the launcher) so /ad/select can serve our HOUSE units (the
// organic "Join MELEK / KulaSwap / mine PRANA" promos) as well as any sponsored units. Read-only load; a
// missing/corrupt file → a fresh in-memory store (soft-fail).
const AD_STORE_FILE = process.env.HERALD_ADNETWORK_DATA || _join(process.cwd(), 'data', 'herald-adnetwork.json');
let _adStore = {};
try { const o = JSON.parse(_readFileSync(AD_STORE_FILE, 'utf8')); if (o && typeof o === 'object') _adStore = o; } catch { _adStore = {}; }
const adNetwork = createAdNetwork({ storage: _adStore }); // stateful singleton — serves /ad/select (house + disclosed units).
const adAuction = createAdAuction(); // stateful singleton — serves /ad/premium (won featured unit) + /api/auctions.

// Lead CRM singleton, backed by a disk-persisted Map-like store (data/herald-leads.json). Soft-fail on any
// fs error → falls back to an in-memory Map so capture never 500s. No PII is ever dumped by a GET (the CRM
// esc()'s fields; we expose only /api/lead capture + /api/leads read, both native paths).
const LEADS_FILE = process.env.HERALD_LEADS_DATA || _join(process.cwd(), 'data', 'herald-leads.json');
function diskLeadStore(file) {
  const m = new Map();
  try { const o = JSON.parse(_readFileSync(file, 'utf8')); if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) m.set(k, v); } catch { /* fresh */ }
  const flush = () => { try { _mkdirSync(_dirname(file), { recursive: true }); _writeFileSync(file, JSON.stringify(Object.fromEntries(m), null, 2)); } catch { /* soft */ } };
  return {
    get: (k) => m.get(k), has: (k) => m.has(k), values: () => m.values(), delete: (k) => m.delete(k),
    set: (k, v) => { m.set(k, v); flush(); return m; },
  };
}
const leadCrm = createLeadCrm({ storage: diskLeadStore(LEADS_FILE) });

// The growth-funnel data sources, bound to the live singletons + on-disk rails. Every dep is soft-failed by
// collectFunnel, so a missing/empty source degrades that stage to 0 rather than erroring. Reach is scoped to
// OUR house campaign codes (the DESTINATIONS the launcher drives), so unrelated /go/QR codes never inflate it.
const GROWTH_CODES = DESTINATIONS.map((d) => d.code);
export const funnelDeps = {
  scanStats: () => qrScanStats(),
  leadPipeline: () => leadCrm.pipeline(),
  verifiedLeads: () => leadCrm.verifiedCount(),
  senderStats: () => senderSingleton.stats(),
  inviteStats: () => inviteStats(),
  campaignCodes: GROWTH_CODES,
};

// /api/capture — the opt-in lead-capture bridge for the Hathor chat widget (and any page opt-in). A visitor
// who volunteers an email is recorded as a NEW pipeline lead (source defaults 'chat'). This is NOT a bulk
// subscribe — it never sends anything. Public opt-in to the nurture drip goes through /api/subscribe instead.
async function captureHandler(req, res) {
  try {
    if ((req.method || 'GET').toUpperCase() !== 'POST') { res.writeHead(405, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ ok: false, error: 'method' })); }
    const body = await new Promise((resolve) => {
      if (req.body && typeof req.body === 'object') return resolve(req.body);
      let d = ''; let over = false;
      try {
        req.on('data', (c) => { d += c; if (d.length > 65536) { over = true; try { req.destroy(); } catch {} } });
        req.on('end', () => { if (over) return resolve(null); try { resolve(d ? JSON.parse(d) : {}); } catch { resolve(null); } });
        req.on('error', () => resolve(null));
      } catch { resolve(null); }
    });
    if (!body || typeof body !== 'object') { res.writeHead(400, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ ok: false, error: 'bad-body' })); }
    const r = leadCrm.addLead({ email: body.email, name: body.name, phone: body.phone, source: body.source || 'chat' });
    // A duplicate is a soft success from the caller's view (already captured) — do not leak pipeline internals.
    const ok = r.ok || r.error === 'duplicate email';
    res.writeHead(ok ? 200 : 400, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    return res.end(JSON.stringify({ ok, captured: !!r.ok }));
  } catch { try { res.writeHead(500, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: false, error: 'error' })); } catch { /* soft */ } return undefined; }
}
const MOUNTS = [
  { rewrite: null, fn: outreachHandler, match: (p) => p === '/outreach' || p.startsWith('/outreach/') },
  { rewrite: null, fn: qrHandler, match: (p) => p.startsWith('/go/') || p === '/qr' || p.startsWith('/qr/') },
  { rewrite: '/seo', fn: seoHandler, match: (p) => p === '/seo' || p.startsWith('/seo/') },
  { rewrite: '/campaigns', fn: campaignHandler, match: (p) => p === '/campaigns' || p.startsWith('/campaigns/') },
  { rewrite: '/analytics', fn: analyticsHandler, match: (p) => p === '/analytics' || p.startsWith('/analytics/') },
  // ad-network + click-validate: native-path handlers (rewrite null). /health stays owned by the server
  // above, so we match only each module's real routes — /ad/* and POST /api/click-validate.
  // ad-auction claims /ad/premium + /api/auctions BEFORE the ad-network's broad /ad/ match below.
  { rewrite: null, fn: adAuction.handler, match: (p) => p === '/ad/premium' || p === '/api/auctions' },
  { rewrite: null, fn: adNetwork.handler, match: (p) => p === '/ad/select' || p.startsWith('/ad/') },
  // ad-embed: the PUBLIC ad unit (/embed/unit → the framed, disclosed unit). Bound to the ad-network
  // singleton's select + origin allow-list. Native paths; holds no key, moves no funds.
  { rewrite: null, fn: (req, res) => adEmbedHandler(req, res, { select: adNetwork.select, originsOf: adNetwork.originsOf, baseUrl: BASE_URL }), match: (p) => p === '/embed/unit' || p.startsWith('/embed/') },
  { rewrite: null, fn: clickValidateHandler, match: (p) => p === '/api/click-validate' },
  { rewrite: null, fn: iftttHandler, match: (p) => p === '/ifttt' || p === '/api/ifttt/recipes' || p === '/api/ifttt/evaluate' },
  // dispatcher: the trigger execution rail. Native paths (its own /health stays owned by the server above).
  { rewrite: null, fn: dispatchHandler, match: (p) => p === '/api/dispatch' || p === '/api/inbox' },
  // campaign-sender: one-click unsubscribe + subscribe/webhook/lists/stats (native paths; /health owned above).
  { rewrite: null, fn: senderHandler, match: (p) => p.startsWith('/u/') || p === '/unsubscribe'
    || p === '/api/subscribe' || p === '/api/webhook' || p === '/api/lists' || p === '/api/stats' },
  // lead CRM: the top-of-funnel. /api/capture = the chat/opt-in bridge (POST); /api/lead + /api/leads are the
  // CRM's own native routes. Native paths; /health stays owned by the server above.
  { rewrite: null, fn: captureHandler, match: (p) => p === '/api/capture' },
  { rewrite: null, fn: leadCrm.handler, match: (p) => p === '/api/lead' || p === '/api/leads' },
  // growth funnel: the user-acquisition scoreboard as JSON. Read-only, holds no key.
  { rewrite: null, fn: funnelHandler(funnelDeps), match: (p) => p === '/api/funnel' },
];

export async function handler(req, res) {
  try {
    const url = new URL(req.url, BASE_URL);
    const path = url.pathname;
    if (path === '/health') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end('ok'); }
    if (path === '/robots.txt') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end(`User-agent: *\nAllow: /\nSitemap: ${BASE_URL}/sitemap.xml\n`); }
    if (path === '/sitemap.xml') {
      res.writeHead(200, { 'content-type': 'application/xml' });
      return res.end(`<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${BASE_URL}/</loc></url><url><loc>${BASE_URL}/prompts</loc></url><url><loc>${BASE_URL}/monetize</loc></url><url><loc>${BASE_URL}/advertise</loc></url><url><loc>${BASE_URL}/outreach</loc></url></urlset>`);
    }
    if (path === '/') return send(res, homePage());
    if (path === '/prompts') return send(res, promptsPage());
    if (path === '/monetize') return send(res, monetizePage(url.searchParams));
    if (path === '/advertise') return send(res, advertisePage(url.searchParams));
    // delegate to a mounted module handler if one claims this path
    for (const m of MOUNTS) {
      if (!m.match(path)) continue;
      if (m.rewrite) req.url = req.url.slice(m.rewrite.length) || '/';
      try { return await m.fn(req, res); }
      catch { return send(res, pageShell('Herald', `<p style="color:var(--mut)">That tool hit an error. <a class=back href="/">← Herald</a></p>`), 502); }
    }
    return send(res, pageShell('Not found — Herald', `<p><a class=back href="/">← Herald</a></p><p style="color:var(--mut)">Not found.</p>`), 404);
  } catch {
    return send(res, pageShell('Herald', `<p style="color:var(--mut)">Something went wrong. <a class=back href="/">← Herald</a></p>`), 500);
  }
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  createServer(handler).listen(PORT, HOST, () => console.log(`herald on http://${HOST}:${PORT}`));
}
