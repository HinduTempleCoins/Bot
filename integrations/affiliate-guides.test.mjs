// affiliate-guides.test.mjs — offline, node --test. No network. Verifies the quality gate, the
// money-path link resolution, and the render/JSON-LD shape.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as guides from './affiliate-guides.mjs';
import * as affiliate from './affiliate.mjs';

test('every seed guide passes the quality gate', () => {
  const { ok, results } = guides.validateAllGuides();
  const failed = results.filter((r) => !r.ok);
  assert.equal(ok, true, 'failures: ' + JSON.stringify(failed));
  assert.ok(results.length >= 5);
});

test('validateGuide rejects thin/doorway content', () => {
  const thin = { slug: 'x', vertical: 'shopping', title: 'Too thin', description: 'short', intro: 'tiny', criteria: [], picks: [{ name: 'A', url: 'https://a.com' }], faq: [] };
  const r = guides.validateGuide(thin);
  assert.equal(r.ok, false);
  assert.ok(r.errors.length >= 4, 'should flag many problems: ' + JSON.stringify(r.errors));
  // specific gates fire
  assert.ok(r.errors.some((e) => /intro under/.test(e)));
  assert.ok(r.errors.some((e) => /picks/.test(e)));
  assert.ok(r.errors.some((e) => /FAQ/.test(e)));
});

test('validateGuide flags a pick missing a real url and thin blurb', () => {
  const g = JSON.parse(JSON.stringify(guides.GUIDES[0]));
  g.picks[0].url = 'not-a-url';
  g.picks[1].blurb = 'too short';
  const r = guides.validateGuide(g);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /merchant url/.test(e)));
  assert.ok(r.errors.some((e) => /thin rationale/.test(e)));
});

test('validateGuide catches duplicate merchant urls', () => {
  const g = JSON.parse(JSON.stringify(guides.GUIDES[0]));
  g.picks[1].url = g.picks[0].url;
  const r = guides.validateGuide(g);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /duplicate merchant url/.test(e)));
});

test('guidesFor + guideBySlug are vertical-scoped and only serve published guides', () => {
  const shopping = guides.guidesFor('shopping');
  assert.ok(shopping.length >= 1);
  assert.ok(shopping.every((g) => g.vertical === 'shopping'));
  const g = guides.guideBySlug('shopping', 'best-standing-desks');
  assert.ok(g);
  assert.equal(g.slug, 'best-standing-desks');
  // wrong vertical -> not found
  assert.equal(guides.guideBySlug('travel', 'best-standing-desks'), null);
});

test('guideSitemapPaths returns /guides + one path per published guide', () => {
  const paths = guides.guideSitemapPaths('home-goods');
  assert.equal(paths[0], '/guides');
  const goods = guides.guidesFor('home-goods');
  assert.equal(paths.length, goods.length + 1);
  assert.ok(paths.every((p) => p === '/guides' || p.startsWith('/g/')));
});

test('pickHref: impact merchants render the PLAIN url for the UTT to transform', () => {
  const r = guides.pickHref({ url: 'https://www.example.com/x', network: 'impact' }, affiliate);
  assert.equal(r.href, 'https://www.example.com/x');
  assert.equal(r.via, 'impact-utt');
  assert.equal(r.tracked, false);
});

test('pickHref: unset network defaults to impact/plain', () => {
  const r = guides.pickHref({ url: 'https://www.example.com/y' }, affiliate);
  assert.equal(r.href, 'https://www.example.com/y');
  assert.equal(r.via, 'impact-utt');
});

test('pickHref: param-network is untracked (plain url) when its id is unset', () => {
  const saved = process.env.RAKUTEN_AFFILIATE_ID; delete process.env.RAKUTEN_AFFILIATE_ID;
  const savedAlt = process.env.AFFIL_RAKUTEN_ID; delete process.env.AFFIL_RAKUTEN_ID;
  const r = guides.pickHref({ name: 'Rakuten', url: 'https://www.rakuten.com/', network: 'rakuten' }, affiliate);
  assert.equal(r.tracked, false);
  assert.equal(r.href, 'https://www.rakuten.com/'); // soft-fail to plain
  if (saved !== undefined) process.env.RAKUTEN_AFFILIATE_ID = saved;
  if (savedAlt !== undefined) process.env.AFFIL_RAKUTEN_ID = savedAlt;
});

test('pickHref: param-network IS tracked when its id is set', () => {
  process.env.AFFIL_RAKUTEN_ID = 'TESTMID123';
  const r = guides.pickHref({ name: 'Rakuten', url: 'https://www.rakuten.com/', network: 'rakuten' }, affiliate);
  assert.equal(r.tracked, true);
  assert.match(r.href, /ranMID=TESTMID123/);
  delete process.env.AFFIL_RAKUTEN_ID;
});

test('renderGuideBody: carries disclosure, picks, CTAs, and JSON-LD', () => {
  const g = guides.guideBySlug('shopping', 'best-standing-desks');
  const { html, jsonld } = guides.renderGuideBody(g, { baseUrl: 'https://shopping.example', affiliate, seo: null });
  assert.match(html, /ftc-disclosure/);
  assert.match(html, /rel="sponsored nofollow noopener"/);
  assert.match(html, /What to look for/);
  assert.match(html, /Frequently asked/);
  // one CTA per pick
  const ctas = (html.match(/pick-cta/g) || []).length;
  assert.equal(ctas, g.picks.length);
  // JSON-LD: Article + ItemList + FAQPage
  const types = jsonld.map((j) => j['@type']);
  assert.ok(types.includes('Article'));
  assert.ok(types.includes('ItemList'));
  assert.ok(types.includes('FAQPage'));
});

test('renderGuideBody escapes interpolation (no raw injection)', () => {
  const evil = { slug: 'e', vertical: 'shopping', title: '<script>x</script>', description: 'd', intro: 'i',
    criteria: [{ h: 'h', body: 'b' }], picks: [{ name: '<b>n</b>', merchant: 'm', url: 'https://a.com', blurb: 'x', pros: ['p'] }], faq: [{ q: 'q', a: 'a' }] };
  const { html } = guides.renderGuideBody(evil, { baseUrl: 'https://x', affiliate });
  assert.ok(!html.includes('<script>x</script>'));
  assert.match(html, /&lt;script&gt;/);
});

test('renderGuideIndexBody lists the vertical guides, soft-fails on empty', () => {
  const body = guides.renderGuideIndexBody('coupons');
  assert.match(body, /Buying guides/);
  assert.match(body, /how-to-stack-coupons-and-cashback|How to Stack/i);
  const none = guides.renderGuideIndexBody('nonexistent-vertical');
  assert.match(none, /No guides published/);
});
