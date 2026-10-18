import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ensureBeacon, ensureSocialMeta, finishPage, cardForHost, SHARE_CARDS, DEFAULT_BEACON_URL } from './page-meta.mjs';

const BARE = '<!doctype html><html><head><meta charset=utf-8><title>KULA Community Fund — MELEK</title>'
  + '<meta name=description content="A community-funded pool on MELEK.">'
  + '<link rel=canonical href="https://melek.salon/kula"></head><body><p>x</p></body></html>';

test('ensureSocialMeta fills OG/Twitter from the page itself and adds the share card', () => {
  const out = ensureSocialMeta(BARE);
  assert.match(out, /<meta property="og:title" content="KULA Community Fund — MELEK">/);
  assert.match(out, /<meta property="og:description" content="A community-funded pool on MELEK.">/);
  assert.match(out, /<meta property="og:url" content="https:\/\/melek.salon\/kula">/);
  assert.match(out, /<meta property="og:type" content="website">/);
  assert.match(out, /og:image" content="https:\/\/melek.salon\/og\/melek-card.png"/);
  assert.match(out, /og:image:width" content="1200"/);
  assert.match(out, /og:image:height" content="630"/);
  assert.match(out, /name="twitter:card" content="summary_large_image"/);
  assert.match(out, /name="twitter:image" content="https:\/\/melek.salon\/og\/melek-card.png"/);
  assert.ok(out.indexOf('og:title') < out.indexOf('</head>'));
});

test('ensureSocialMeta never replaces what a page already sets, and is idempotent', () => {
  const page = BARE.replace('</head>', '<meta property="og:title" content="Own"><meta property="og:image" content="https://x.test/a.jpg"><meta name="twitter:card" content="summary"></head>');
  const out = ensureSocialMeta(page);
  assert.equal((out.match(/og:title/g) || []).length, 1);
  assert.equal((out.match(/property="og:image"/g) || []).length, 1);
  assert.match(out, /twitter:card" content="summary"/);         // page's own image: its card choice stands
  assert.match(out, /twitter:title" content="Own"/);
  assert.equal(ensureSocialMeta(out), out);
  const once = ensureSocialMeta(BARE);
  assert.equal(ensureSocialMeta(once), once);
});

test('a small summary card is upgraded only when we supplied the wide image', () => {
  const page = BARE.replace('</head>', '<meta name="twitter:card" content="summary"></head>');
  assert.match(ensureSocialMeta(page), /twitter:card" content="summary_large_image"/);
});

test('cards per host', () => {
  assert.equal(cardForHost('kula.money'), SHARE_CARDS.kula);
  assert.equal(cardForHost('www.vankushfamily.com'), SHARE_CARDS.vankush);
  assert.equal(cardForHost('wiki.soapbox.community'), SHARE_CARDS.melek);
});

test('ensureBeacon adds the first-party beacon once, never soapy.blog', () => {
  const out = ensureBeacon(BARE);
  assert.ok(out.includes(DEFAULT_BEACON_URL));
  assert.ok(!out.includes('soapy.blog'));
  assert.equal(ensureBeacon(out), out);
  assert.equal(finishPage(finishPage(BARE)), finishPage(BARE));
});

test('fragments and non-strings pass through untouched', () => {
  assert.equal(ensureSocialMeta('<p>no head</p>'), '<p>no head</p>');
  assert.equal(ensureBeacon('<p>no head</p>'), '<p>no head</p>');
  assert.equal(ensureSocialMeta(null), null);
});

test('attribute values from the page cannot break out of the tag', () => {
  const page = BARE.replace('<title>KULA Community Fund — MELEK</title>', '<title>a "b" &lt;c&gt;</title>');
  const out = ensureSocialMeta(page);
  assert.match(out, /og:title" content="a &quot;b&quot; &lt;c&gt;"/);
});

test('finishHtmlResponses rewrites a single-shot HTML response and fixes content-length', async () => {
  const { finishHtmlResponses } = await import('./page-meta.mjs');
  const sent = {};
  const res = {
    _h: {}, headersSent: false,
    getHeader(k) { return this._h[k.toLowerCase()]; }, setHeader(k, v) { this._h[k.toLowerCase()] = v; },
    writeHead(code, h) { sent.code = code; sent.headers = { ...h }; },
    write() {}, end(b) { sent.body = b; },
  };
  finishHtmlResponses(res, {}, { headers: { host: 'kula.money' } });
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-length': Buffer.byteLength(BARE) });
  res.end(BARE);
  assert.equal(sent.code, 200);
  assert.ok(sent.body.includes(DEFAULT_BEACON_URL));
  assert.ok(sent.body.includes('kula-card.png'));
  assert.equal(sent.headers['content-length'], Buffer.byteLength(sent.body));
  // JSON is untouched
  const res2 = { ...res, _h: {} }; const s2 = {};
  res2.writeHead = (c, h) => { s2.h = h; }; res2.end = (b) => { s2.b = b; }; res2.__pageMeta = false;
  finishHtmlResponses(res2);
  res2.writeHead(200, { 'content-type': 'application/json' }); res2.end('{"a":1}');
  assert.equal(s2.b, '{"a":1}');
});

test('name="og:*" is rewritten to property= without duplicating tags', () => {
  const page = BARE.replace('</head>', '<meta name="og:title" content="T" data-reactid="9"/><meta name="og:image" content="https://x.test/i.jpg"/></head>');
  const out = ensureSocialMeta(page);
  assert.match(out, /<meta property="og:title" content="T" data-reactid="9"\/>/);
  assert.equal((out.match(/og:title/g) || []).length, 1);
  assert.equal((out.match(/og:image"/g) || []).length, 1);
  assert.equal(ensureSocialMeta(out), out);
});

test('a wide header logo as og:image is swapped for the share card', () => {
  const page = BARE.replace('</head>', '<meta property="og:image" content="https://wallet.melek.salon/images/logo.png"/><meta name="twitter:card" content="summary"/><meta name="twitter:image" content="https://wallet.melek.salon/images/logo.png"/></head>');
  const out = ensureSocialMeta(page);
  assert.ok(!out.includes('images/logo.png'));
  assert.match(out, /og:image" content="https:\/\/melek.salon\/og\/melek-card.png"/);
  assert.match(out, /twitter:card" content="summary_large_image"/);
  assert.equal(ensureSocialMeta(out), out);
});
