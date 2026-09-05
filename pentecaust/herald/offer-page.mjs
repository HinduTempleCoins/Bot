// pentecaust/herald/offer-page.mjs — the OFFER PAGE: the destination Herald's ads and campaigns point at.
//
// Herald could already plan creative (creative-studio), wire channels (launch-campaign) and measure the
// funnel (growth-funnel) — but there was nothing to send traffic TO. This is that missing surface: the
// direct-response offer page, in the anatomy the operator specified from a working example
// (resellsignals.com, 2026-09-04): sticky CTA bar, social proof, benefit headline, friction-removers,
// product proof, itemized deliverables, bonuses, value stack, guarantee, sticky footer CTA.
//
// ── THE ONE RULE THAT MAKES THIS OURS ────────────────────────────────────────────────────────────
// Every persuasive element is either BACKED BY A REAL NUMBER or it is OMITTED. Never invented.
//
// The reference page carries "6,412 people already bought this", a struck-through $297 that was never
// charged, and "only available on this page". Those convert, and they are also the exact thing that makes
// a claim indefensible later — and this repo's house rule is facts-not-verdicts everywhere else (see
// site/coupons honest-ranking, cheetah/policing, the affiliate engine's disclosure).
//
// So: `socialProof` requires a `source` string or it does not render. `anchorPrice` requires
// `anchorWasCharged: true` or it does not render. `scarcity` requires a real `endsAt`. A page that has no
// real numbers renders WITHOUT those blocks and still converts on substance. verifyOffer() reports what
// was dropped and why, so the operator can see exactly which claims lacked backing.
//
//   import { planOffer, renderOfferPage, verifyOffer } from './offer-page.mjs';
//   node pentecaust/herald/offer-page.mjs melek     # render a sample to stdout
//
// Pure + deterministic: no network, no model call, no keys. esc() on every interpolated value.

export const esc = (s) => String(s == null ? '' : s)
  .replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const str = (v, max = 400) => String(v == null ? '' : v).trim().slice(0, max);
const arr = (v) => (Array.isArray(v) ? v : []);

/** A claim is only usable if it carries evidence. Returns {ok, why}. */
export function claimUsable(claim) {
  if (!claim || typeof claim !== 'object') return { ok: false, why: 'no claim given' };
  if (claim.count != null && !Number.isFinite(Number(claim.count))) return { ok: false, why: 'count is not a number' };
  if (!str(claim.source)) return { ok: false, why: 'no source — a number without a source is a fabrication' };
  return { ok: true, why: '' };
}

/**
 * planOffer — normalise raw input into the offer structure the renderer consumes.
 * Nothing here invents a value; missing sections simply come back empty.
 */
export function planOffer(rawInput = {}) {
  // A `= {}` default only fires on `undefined`. planOffer is exported and called directly, so an
  // explicit null — or a string, or a number — reached `.price` below and threw. Normalise first.
  const input = rawInput && typeof rawInput === 'object' ? rawInput : {};
  const price = Number(input.price);
  const anchor = Number(input.anchorPrice);
  const dropped = [];

  const socialProof = (() => {
    const c = input.socialProof;
    if (!c) return null;
    const v = claimUsable(c);
    if (!v.ok) { dropped.push({ block: 'socialProof', why: v.why }); return null; }
    return { count: Number(c.count), label: str(c.label, 120), source: str(c.source, 200) };
  })();

  const anchorPrice = (() => {
    if (!Number.isFinite(anchor) || anchor <= 0) return null;
    if (input.anchorWasCharged !== true) {
      dropped.push({ block: 'anchorPrice', why: 'anchorWasCharged is not true — a struck-through price that was never charged is a false reference price' });
      return null;
    }
    return anchor;
  })();

  const scarcity = (() => {
    const s = input.scarcity;
    if (!s) return null;
    if (!s.endsAt || Number.isNaN(Date.parse(s.endsAt))) {
      dropped.push({ block: 'scarcity', why: 'no real endsAt — manufactured urgency is not used here' });
      return null;
    }
    return { endsAt: s.endsAt, reason: str(s.reason, 160) };
  })();

  return {
    brand: str(input.brand, 60) || 'MELEK',
    product: str(input.product, 120),
    headline: str(input.headline, 200),
    subhead: str(input.subhead, 300),
    price: Number.isFinite(price) && price >= 0 ? price : null,
    currency: str(input.currency, 8) || 'USD',
    priceNote: str(input.priceNote, 200),
    ctaText: str(input.ctaText, 60) || 'Get Instant Access',
    ctaHref: str(input.ctaHref, 400) || '#start',
    frictionRemovers: arr(input.frictionRemovers).slice(0, 6).map((f) => str(f, 100)).filter(Boolean),
    deliverables: arr(input.deliverables).slice(0, 12)
      .map((d) => ({ name: str(d && d.name, 120), what: str(d && d.what, 400) }))
      .filter((d) => d.name),
    bonuses: arr(input.bonuses).slice(0, 8)
      .map((b) => ({ name: str(b && b.name, 120), what: str(b && b.what, 400) }))
      .filter((b) => b.name),
    proof: arr(input.proof).slice(0, 8)
      .map((p) => ({ label: str(p && p.label, 80), value: str(p && p.value, 60), source: str(p && p.source, 200) }))
      .filter((p) => p.label && p.value && p.source),
    guarantee: str(input.guarantee, 300),
    socialProof, anchorPrice, scarcity, dropped,
  };
}

/** verifyOffer — what was dropped for lack of evidence, so nothing fails silently. */
export function verifyOffer(offer) {
  const o = offer || {};
  const proofless = arr(o.proof).length === 0;
  return {
    ok: arr(o.dropped).length === 0,
    dropped: arr(o.dropped),
    warnings: [
      ...(proofless ? ['no proof rows — the page will carry no numbers at all'] : []),
      ...(!o.guarantee ? ['no guarantee stated'] : []),
      ...(!arr(o.deliverables).length ? ['no deliverables — there is nothing to buy'] : []),
    ],
  };
}

const money = (n, cur) => (n == null ? '' : (cur === 'USD' ? `$${n}` : `${n} ${esc(cur)}`));

/** renderOfferPage — the full page. Deterministic, self-contained, no external assets. */
export function renderOfferPage(offer) {
  const o = planOffer(offer && offer.brand ? offer : (offer || {}));
  const sticky = `<div class=stickybar><div><b>${esc(o.brand)}</b> <span class=mut>${esc(o.product)}</span></div>
    <a class=cta href="${esc(o.ctaHref)}">${esc(o.ctaText)}${o.price != null ? ` — ${esc(money(o.price, o.currency))}` : ''}</a></div>`;

  const proofStrip = o.socialProof
    ? `<p class=social>${esc(String(o.socialProof.count))} ${esc(o.socialProof.label)}
        <span class=src>source: ${esc(o.socialProof.source)}</span></p>` : '';

  const friction = o.frictionRemovers.length
    ? `<ul class=friction>${o.frictionRemovers.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>` : '';

  const proof = o.proof.length
    ? `<div class=proofgrid>${o.proof.map((p) => `<div class=stat><div class=v>${esc(p.value)}</div>
        <div class=l>${esc(p.label)}</div><div class=src>${esc(p.source)}</div></div>`).join('')}</div>` : '';

  const items = o.deliverables.length
    ? `<h2>Everything inside ${esc(o.product || o.brand)}</h2><div class=cards>${o.deliverables
        .map((d) => `<div class=card><div class=t>✓ ${esc(d.name)}</div><div class=d>${esc(d.what)}</div></div>`).join('')}</div>` : '';

  const bonus = o.bonuses.length
    ? `<h2>Also included</h2><div class=cards>${o.bonuses.map((b, i) =>
        `<div class="card bonus"><div class=t>#${i + 1} — ${esc(b.name)}</div><div class=d>${esc(b.what)}</div></div>`).join('')}</div>` : '';

  const stack = o.price != null ? `<div class=stack>
      ${o.anchorPrice ? `<div class=anchor>Regular price <s>${esc(money(o.anchorPrice, o.currency))}</s></div>` : ''}
      <div class=now>${esc(money(o.price, o.currency))}</div>
      ${o.priceNote ? `<div class=mut>${esc(o.priceNote)}</div>` : ''}
      ${o.scarcity ? `<div class=mut>Offer ends ${esc(o.scarcity.endsAt)}${o.scarcity.reason ? ` — ${esc(o.scarcity.reason)}` : ''}</div>` : ''}
    </div>` : '';

  const guarantee = o.guarantee ? `<div class=guarantee>${esc(o.guarantee)}</div>` : '';

  return `<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">
<title>${esc(o.headline || o.product || o.brand)}</title>
<style>
 :root{--bg:#0d1117;--panel:#161b22;--line:#30363d;--fg:#e6edf3;--mut:#8b949e;--blue:#58a6ff}
 *{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.6 system-ui,sans-serif}
 .stickybar{position:sticky;top:0;z-index:9;display:flex;gap:12px;align-items:center;justify-content:space-between;
   background:var(--panel);border-bottom:1px solid var(--line);padding:10px 18px;flex-wrap:wrap}
 .cta{background:var(--blue);color:#04121f;font-weight:800;border-radius:10px;padding:11px 20px;text-decoration:none}
 .wrap{max-width:820px;margin:0 auto;padding:26px 20px 90px}
 h1{font-size:34px;line-height:1.2;margin:18px 0 10px} h2{font-size:20px;margin:30px 0 12px}
 .mut{color:var(--mut)} .src{color:var(--mut);font-size:12px;display:block}
 .social{color:var(--mut);font-size:14px}
 ul.friction{list-style:none;padding:0;display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px}
 ul.friction li{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:12px 14px}
 .cards{display:grid;gap:12px} .card{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:16px 18px}
 .card .t{font-weight:700;margin-bottom:4px} .card .d{color:var(--mut);font-size:14px}
 .card.bonus{border-left:3px solid var(--blue)}
 .proofgrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin:16px 0}
 .stat{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:14px}
 .stat .v{font-size:26px;font-weight:800} .stat .l{font-size:13px;color:var(--mut)}
 .stack{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:22px;text-align:center;margin:26px 0}
 .stack .now{font-size:42px;font-weight:800;color:var(--blue)} .stack .anchor{color:var(--mut)}
 .guarantee{border:1px solid var(--line);border-radius:12px;padding:14px 18px;color:var(--mut);font-size:14px}
 .bigcta{display:block;text-align:center;background:var(--blue);color:#04121f;font-weight:800;font-size:19px;
   border-radius:14px;padding:18px;text-decoration:none;margin:22px 0}
 footer{position:fixed;bottom:0;left:0;right:0;background:var(--panel);border-top:1px solid var(--line);
   padding:10px 18px;display:flex;gap:12px;align-items:center;justify-content:space-between;flex-wrap:wrap}
</style>
${sticky}
<div class=wrap>
  ${proofStrip}
  <h1>${esc(o.headline)}</h1>
  ${o.subhead ? `<p class=mut>${esc(o.subhead)}</p>` : ''}
  ${friction}
  ${proof}
  ${items}
  ${bonus}
  ${stack}
  <a class=bigcta href="${esc(o.ctaHref)}">${esc(o.ctaText)}</a>
  ${guarantee}
</div>
<footer><div><b>${esc(o.brand)}</b> <span class=mut>${esc(o.product)}</span></div>
  <a class=cta href="${esc(o.ctaHref)}">${esc(o.ctaText)}</a></footer>`;
}

/** handler(req,res) — GET /offer renders a planned offer supplied by the caller. */
export function handler(req, res, offer = null) {
  const body = renderOfferPage(offer || {});
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(body);
}

const isMain = process.argv[1] && process.argv[1].endsWith('offer-page.mjs');
if (isMain) {
  const o = planOffer({
    brand: 'MELEK', product: 'Witness School',
    headline: 'Run a MELEK witness — the chain pays block producers, and the seat is open',
    subhead: 'The staged course that takes you from an account to a producing witness.',
    frictionRemovers: ['No prior chain experience', 'Free to start', 'Runs on a small VPS', 'Keys never leave your machine'],
    deliverables: [{ name: 'Witness setup walkthrough', what: 'Every step from account creation to producing blocks.' }],
    price: 0, priceNote: 'Free — the chain pays producers, we do not charge to teach it.',
    anchorPrice: 297, // deliberately dropped: never charged
    socialProof: { count: 900, label: 'people building on MELEK' }, // deliberately dropped: no source
    guarantee: 'Everything is verifiable on-chain. Nothing here asks for a key.',
  });
  console.log(renderOfferPage(o));
  console.error(JSON.stringify(verifyOffer(o), null, 2));
}
