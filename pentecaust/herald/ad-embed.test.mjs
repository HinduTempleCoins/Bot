// pentecaust/herald/ad-embed.test.mjs — offline suite for the Herald ad-embed PUBLIC LAYER.
//   node --test pentecaust/herald/ad-embed.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handler, snippet, unitHtml, unitDoc, unitSize, normHost, AD_LABEL } from './ad-embed.mjs';

// A fake `select` seam standing in for the ad-network engine — returns one disclosed creative.
const FILL = { ok: true, creative: { id: 'offer-01-cr', code: 'offer-01', headline: 'Try the offer', body: 'A real deal.', sponsored: true } };
const selectFill = () => FILL;
const selectEmpty = () => ({ ok: false, reason: 'no creatives available' });

function call(url, opts) {
  return new Promise((resolve) => {
    const cap = { code: 0, headers: {}, body: '' };
    const res = { writeHead(c, h) { cap.code = c; cap.headers = h || {}; }, end(b) { cap.body = b == null ? '' : b; resolve(cap); } };
    handler({ method: 'GET', url, headers: (opts && opts.headers) || {} }, res, opts || {});
  });
}

test('unitSize normalizes keywords and WxH; unknown → mrec default', () => {
  assert.deepEqual(unitSize('leaderboard'), { name: 'leaderboard', w: 728, h: 90 });
  assert.equal(unitSize('300x250').name, 'mrec');
  assert.equal(unitSize('nonsense').name, 'mrec');
  assert.equal(unitSize().name, 'mrec');
});

test('snippet is a plain iframe pointing at /embed/unit, sandboxed, escaped', () => {
  const s = snippet('melek-salon', 'sponsored', { size: 'mrec', baseUrl: 'https://herald.example' });
  assert.match(s, /^<iframe /);
  assert.match(s, /\/embed\/unit\?pub=melek-salon&amp;slot=sponsored&amp;fmt=mrec/);  // & escaped in the attr
  assert.match(s, /width="300" height="250"/);
  assert.match(s, /sandbox="allow-popups allow-popups-to-escape-sandbox"/);
  assert.doesNotMatch(s, /<script/i);           // no third-party JS
});

test('snippet soft-fails a bad publisher id to empty (never fabricates)', () => {
  const s = snippet('Not An Id!', 'sponsored', { baseUrl: 'https://herald.example' });
  assert.match(s, /pub=&/);                       // empty pub, still a valid iframe
});

test('unitHtml renders the Ad label + a /go/{code} click-through carrying the pub id', () => {
  const html = unitHtml(FILL.creative, { pub: 'melek-salon', baseUrl: 'https://herald.example' });
  assert.match(html, new RegExp(`>${AD_LABEL}<`));               // disclosure label present
  assert.match(html, /href="https:\/\/herald\.example\/go\/offer-01\?pub=melek-salon"/);
  assert.match(html, /rel="sponsored nofollow noopener"/);
  assert.match(html, /Try the offer/);
});

test('unitHtml with no creative renders a disclosed house unit (no fabricated click)', () => {
  const html = unitHtml(null, { pub: 'melek-salon' });
  assert.match(html, new RegExp(`>${AD_LABEL}<`));
  assert.match(html, /Advertise here/);
  assert.doesNotMatch(html, /\/go\//);           // nothing to click through to
});

test('unitDoc is a self-contained document with inline style, no external fetch', () => {
  const doc = unitDoc(unitHtml(FILL.creative, { pub: 'p', baseUrl: 'https://h' }), { fmt: 'mrec' });
  assert.match(doc, /^<!doctype html>/i);
  assert.match(doc, /<style>/);
  assert.doesNotMatch(doc, /<script/i);
  assert.doesNotMatch(doc, /https?:\/\/[^"']*\.(?:js|css)/i);   // no external asset URLs
});

test('GET /embed/unit — serves a disclosed unit whose click routes via /go and carries pub', async () => {
  const cap = await call('/embed/unit?pub=melek-salon&slot=sponsored&fmt=mrec', { select: selectFill, baseUrl: 'https://herald.example' });
  assert.equal(cap.code, 200);
  assert.match(cap.headers['content-type'], /text\/html/);
  assert.match(cap.body, new RegExp(`>${AD_LABEL}<`));            // Ad disclosure label
  assert.match(cap.body, /\/go\/offer-01\?pub=melek-salon/);       // click on the /go rail, attributed
});

test('GET /embed/unit — origin allow-list enforced: off-origin referer gets no paid unit', async () => {
  const originsOf = (pubId) => (pubId === 'melek-salon' ? ['melek.salon'] : null);
  // Off-origin referer → house unit, NOT the paid creative.
  const off = await call('/embed/unit?pub=melek-salon&slot=sponsored', {
    select: selectFill, originsOf, headers: { referer: 'https://evil.example.com/page' },
  });
  assert.equal(off.code, 200);
  assert.doesNotMatch(off.body, /\/go\/offer-01/);
  assert.match(off.body, /origin-not-allowed/);
  // On an allowed origin → the paid unit serves.
  const on = await call('/embed/unit?pub=melek-salon&slot=sponsored', {
    select: selectFill, originsOf, headers: { referer: 'https://www.melek.salon/post' },
  });
  assert.match(on.body, /\/go\/offer-01/);
});

test('GET /embed/unit — soft-fail on bad publisher, no fill, and no select seam (always a valid 200 unit)', async () => {
  const bad = await call('/embed/unit?pub=Bad%20Id', { select: selectFill });
  assert.equal(bad.code, 200);
  assert.match(bad.body, /invalid-publisher/);
  assert.match(bad.body, new RegExp(`>${AD_LABEL}<`));

  const empty = await call('/embed/unit?pub=melek-salon', { select: selectEmpty });
  assert.equal(empty.code, 200);
  assert.match(empty.body, /no-fill/);

  const noSeam = await call('/embed/unit?pub=melek-salon', {});
  assert.equal(noSeam.code, 200);
  assert.match(noSeam.body, /no-fill/);
  assert.doesNotMatch(noSeam.body, /\/go\//);
});

test('normHost strips scheme/www/port/path so the embed + billable gates agree', () => {
  assert.equal(normHost('https://www.melek.salon:443/some/path?x=1'), 'melek.salon');
  assert.equal(normHost(''), '');
});
