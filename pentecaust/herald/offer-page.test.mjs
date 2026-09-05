// offer-page.test.mjs — the direct-response offer page. Offline, deterministic, no network.
//
// The tests that matter here are the REFUSALS. This module's whole discipline is that a
// persuasion block only renders if it carries evidence: a social-proof number needs a source,
// a struck-through anchor price has to have actually been charged, and urgency needs a real
// deadline. Those are the claims that turn a landing page into a false statement, so each one
// has a test proving it is dropped AND that the drop is reported rather than silent.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  esc, claimUsable, planOffer, verifyOffer, renderOfferPage, handler,
} from './offer-page.mjs';

const full = () => ({
  brand: 'MELEK', product: 'PRANA miner onboarding', headline: 'Point your Ethash rigs at a fair launch',
  subhead: 'No premine, no allocation, no founder share.',
  price: 0, currency: 'USD', ctaText: 'Start mining', ctaHref: 'https://example.test/start',
  frictionRemovers: ['No signup', 'No wallet handover'],
  deliverables: [{ name: 'Pool endpoint', what: 'stratum URL + worker config' }],
  bonuses: [{ name: 'Wallet generator', what: 'in-browser, keys never leave the page' }],
  proof: [{ label: 'Block height', value: '42,849', source: 'https://pranascan.test' }],
  guarantee: 'Stop any time; nothing is custodial.',
});

// --- escaping ---------------------------------------------------------------

test('esc neutralises the four HTML-significant characters', () => {
  assert.equal(esc('a & b < c > d " e'), 'a &amp; b &lt; c &gt; d &quot; e');
});

test('esc never throws and renders null/undefined as empty', () => {
  for (const v of [null, undefined, 0, {}, []]) assert.doesNotThrow(() => esc(v));
  assert.equal(esc(null), '');
  assert.equal(esc(undefined), '');
});

// --- claim evidence ---------------------------------------------------------

test('a claim without a source is unusable — a number with no source is a fabrication', () => {
  const v = claimUsable({ count: 1200, label: 'miners' });
  assert.equal(v.ok, false);
  assert.match(v.why, /source/);
});

test('a claim with a non-numeric count is unusable', () => {
  assert.equal(claimUsable({ count: 'loads', label: 'miners', source: 'x' }).ok, false);
});

test('a sourced claim is usable', () => {
  assert.equal(claimUsable({ count: 1200, label: 'miners', source: 'https://x.test' }).ok, true);
});

test('claimUsable soft-fails on junk rather than throwing', () => {
  for (const junk of [null, undefined, 0, 'x', []]) {
    assert.doesNotThrow(() => claimUsable(junk));
    assert.equal(claimUsable(junk).ok, false);
  }
});

// --- the refusals -----------------------------------------------------------

test('unsourced social proof is DROPPED, and the drop is reported', () => {
  const o = planOffer({ ...full(), socialProof: { count: 9000, label: 'happy users' } });
  assert.equal(o.socialProof, null);
  assert.ok(o.dropped.some((d) => d.block === 'socialProof'));
});

test('an anchor price that was never charged is DROPPED as a false reference price', () => {
  const o = planOffer({ ...full(), anchorPrice: 499 });          // anchorWasCharged not set
  assert.equal(o.anchorPrice, null);
  assert.ok(o.dropped.some((d) => d.block === 'anchorPrice'));
});

test('an anchor price that WAS charged survives', () => {
  const o = planOffer({ ...full(), anchorPrice: 499, anchorWasCharged: true });
  assert.equal(o.anchorPrice, 499);
  assert.equal(o.dropped.length, 0);
});

test('scarcity without a real deadline is DROPPED — no manufactured urgency', () => {
  for (const s of [{ reason: 'almost gone' }, { endsAt: 'soon', reason: 'x' }]) {
    const o = planOffer({ ...full(), scarcity: s });
    assert.equal(o.scarcity, null);
    assert.ok(o.dropped.some((d) => d.block === 'scarcity'));
  }
});

test('scarcity with a parseable deadline survives', () => {
  const o = planOffer({ ...full(), scarcity: { endsAt: '2026-12-01T00:00:00Z', reason: 'epoch rollover' } });
  assert.equal(o.scarcity.endsAt, '2026-12-01T00:00:00Z');
});

test('a proof row missing its source is discarded — proof is the one block that must cite', () => {
  const o = planOffer({ ...full(), proof: [{ label: 'Height', value: '42,849' }] });
  assert.equal(o.proof.length, 0);
});

// --- normalisation ----------------------------------------------------------

test('planOffer invents nothing: an empty input yields empty sections, not filler', () => {
  const o = planOffer({});
  assert.equal(o.product, '');
  assert.equal(o.headline, '');
  assert.equal(o.price, null);
  assert.deepEqual(o.deliverables, []);
  assert.deepEqual(o.proof, []);
  assert.equal(o.socialProof, null);
});

test('planOffer supplies only structural defaults (brand, CTA, currency)', () => {
  const o = planOffer({});
  assert.equal(o.brand, 'MELEK');
  assert.equal(o.currency, 'USD');
  assert.ok(o.ctaText && o.ctaHref);
});

test('a free offer keeps price 0 rather than treating it as absent', () => {
  assert.equal(planOffer({ price: 0 }).price, 0);
  assert.equal(planOffer({ price: -5 }).price, null, 'a negative price is not a price');
});

test('list sections are capped and de-junked', () => {
  const o = planOffer({
    deliverables: [...Array(30)].map((_, i) => ({ name: `d${i}`, what: 'x' })).concat([{ what: 'nameless' }]),
    frictionRemovers: [...Array(30)].map((_, i) => `f${i}`),
  });
  assert.equal(o.deliverables.length, 12);
  assert.equal(o.frictionRemovers.length, 6);
  assert.ok(o.deliverables.every((d) => d.name), 'a deliverable with no name is dropped');
});

test('planOffer never throws on junk', () => {
  for (const junk of [null, undefined, 0, 'x', [], { deliverables: 'no', proof: 7, bonuses: null }]) {
    assert.doesNotThrow(() => planOffer(junk));
  }
});

// --- verification -----------------------------------------------------------

test('verifyOffer reports drops so nothing fails silently', () => {
  const o = planOffer({ ...full(), socialProof: { count: 9000, label: 'users' } });
  const v = verifyOffer(o);
  assert.equal(v.ok, false);
  assert.equal(v.dropped.length, 1);
});

test('verifyOffer warns about a page with no numbers, no guarantee and nothing to buy', () => {
  const v = verifyOffer(planOffer({}));
  assert.equal(v.warnings.length, 3);
  assert.ok(v.warnings.some((w) => /nothing to buy/.test(w)));
});

test('a fully evidenced offer verifies clean', () => {
  const v = verifyOffer(planOffer(full()));
  assert.equal(v.ok, true);
  assert.deepEqual(v.warnings, []);
});

test('verifyOffer never throws on junk', () => {
  for (const junk of [null, undefined, {}, { dropped: 'no', proof: 3 }]) {
    assert.doesNotThrow(() => verifyOffer(junk));
  }
});

// --- render -----------------------------------------------------------------

test('the page renders the evidenced content', () => {
  const html = renderOfferPage(full());
  assert.match(html, /Point your Ethash rigs at a fair launch/);
  assert.match(html, /Pool endpoint/);
  assert.match(html, /42,849/);
});

test('a dropped block leaves NO trace in the rendered page', () => {
  const html = renderOfferPage({ ...full(), socialProof: { count: 9000, label: 'happy users' }, anchorPrice: 499 });
  assert.ok(!html.includes('9000'), 'unsourced social proof must not render');
  assert.ok(!html.includes('499'), 'an uncharged anchor price must not render');
});

test('hostile input cannot inject markup into the page', () => {
  const html = renderOfferPage({
    ...full(),
    brand: '<script>alert(1)</script>',
    headline: 'a " onmouseover="evil()',
    ctaHref: 'javascript:alert(1)"><script>x</script>',
  });
  assert.ok(!html.includes('<script>alert(1)</script>'), 'raw script tag survived');
  assert.ok(html.includes('&lt;script&gt;'), 'it should appear escaped instead');
  assert.ok(!/onmouseover="evil\(\)/.test(html), 'attribute break-out survived');
});

test('the renderer is deterministic — same input, byte-identical output', () => {
  assert.equal(renderOfferPage(full()), renderOfferPage(full()));
});

test('renderOfferPage never throws, even on nothing', () => {
  for (const junk of [null, undefined, {}, 0, 'x']) assert.doesNotThrow(() => renderOfferPage(junk));
  assert.match(renderOfferPage({}), /<div class=stickybar>/);
});

// --- handler ----------------------------------------------------------------

test('handler serves HTML 200', () => {
  let code = 0; let headers = null; let body = '';
  handler({}, {
    writeHead(c, h) { code = c; headers = h; },
    end(b) { body = b; },
  }, full());
  assert.equal(code, 200);
  assert.match(headers['content-type'], /text\/html/);
  assert.match(body, /Point your Ethash rigs/);
});

test('handler with no offer still serves a valid page rather than erroring', () => {
  let code = 0; let body = '';
  assert.doesNotThrow(() => handler({}, { writeHead(c) { code = c; }, end(b) { body = b; } }));
  assert.equal(code, 200);
  assert.ok(body.length > 0);
});
