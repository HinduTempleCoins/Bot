// server.mjs — Herald (the MELEK/Pentecaust growth engine's public surface). ONE dashboard that ties
// the Herald modules together into the "AI does your marketing, executed" product, in the SoapBox house
// style (mirrors site/hemp, site/witness). Hathor / the Giant Bot IS the marketing team; Herald is its
// front. Read-only server: holds no key, signs nothing.
//
//   PORT=8161 BASE_URL=https://herald.soapbox.community node site/herald/server.mjs
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
import { handler as senderHandler } from '../../pentecaust/herald/campaign-sender.mjs';
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

const PORT = +(process.env.PORT || 8161);
const HOST = process.env.HOST || '127.0.0.1';
const BASE_URL = (process.env.BASE_URL || 'https://herald.soapbox.community').replace(/\/$/, '');

export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// The growth engine, grouped the way the vision lays it out. Each = a real Herald module.
export const CAPABILITIES = [
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
    ['Lead CRM', 'Verified-only lead capture + a CRM pipeline (only count contacts you can verify).', 'lead-crm', null],
    ['QR tracker', 'Trackable QR codes for offline→online attribution.', 'qr-tracker', null],
    ['Campaign sender', 'The owned sending layer: lists, subscribers, templates, one-shot campaigns + drip/journeys, a durable send-queue, one-click unsubscribe & bounce/complaint suppression (CAN-SPAM). ESP behind an injectable seam — email only.', 'campaign-sender', null],
  ]],
  ['Monetize', [
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
  const body = `<header><span class=brand>◇ <b>Herald</b></span><span class=alpha>ALPHA</span>
    <p class=lead>The growth engine of the MELEK ecosystem — reach, ranking, content, backlinks, PR, outreach
    and conversion, <b>executed</b> (not just tracked) by Hathor. One AI marketing team; these are its tools.</p></header>${groups}`;
  return pageShell('Herald — the MELEK growth engine', body, 'Herald: AI marketing executed — prompts, SEO, backlinks, PR, outreach, leads, campaigns, all in one.');
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

function send(res, html, code = 200) { res.writeHead(code, { 'content-type': 'text/html; charset=utf-8' }); res.end(html); }

// Live module mounts. Prefix-mounted API modules (rewrite set) get req.url stripped so they see their
// own native paths; native-path modules (rewrite null) get req.url unchanged. Every fn always ends the
// response; a throw is caught below. Read-only server: these modules hold no key of ours.
const adNetwork = createAdNetwork(); // stateful singleton — its handler serves /ad/select (disclosed unit).
const adAuction = createAdAuction(); // stateful singleton — serves /ad/premium (won featured unit) + /api/auctions.
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
  { rewrite: null, fn: clickValidateHandler, match: (p) => p === '/api/click-validate' },
  { rewrite: null, fn: iftttHandler, match: (p) => p === '/ifttt' || p === '/api/ifttt/recipes' || p === '/api/ifttt/evaluate' },
  // dispatcher: the trigger execution rail. Native paths (its own /health stays owned by the server above).
  { rewrite: null, fn: dispatchHandler, match: (p) => p === '/api/dispatch' || p === '/api/inbox' },
  // campaign-sender: one-click unsubscribe + subscribe/webhook/lists/stats (native paths; /health owned above).
  { rewrite: null, fn: senderHandler, match: (p) => p.startsWith('/u/') || p === '/unsubscribe'
    || p === '/api/subscribe' || p === '/api/webhook' || p === '/api/lists' || p === '/api/stats' },
];

export async function handler(req, res) {
  try {
    const url = new URL(req.url, BASE_URL);
    const path = url.pathname;
    if (path === '/health') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end('ok'); }
    if (path === '/robots.txt') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end(`User-agent: *\nAllow: /\nSitemap: ${BASE_URL}/sitemap.xml\n`); }
    if (path === '/sitemap.xml') {
      res.writeHead(200, { 'content-type': 'application/xml' });
      return res.end(`<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${BASE_URL}/</loc></url><url><loc>${BASE_URL}/prompts</loc></url><url><loc>${BASE_URL}/outreach</loc></url></urlset>`);
    }
    if (path === '/') return send(res, homePage());
    if (path === '/prompts') return send(res, promptsPage());
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
