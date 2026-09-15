import test from 'node:test';
import assert from 'node:assert/strict';
import { handler, SITEMAP_PATHS, ladderPage, stepPage, checkPage } from './server.mjs';
import { STEPS } from '../../integrations/business-credit-bot.mjs';

const call = (path) => new Promise((resolve) => {
  const c = [];
  const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    end(b) { c.push(b ?? ''); resolve({ status: this.statusCode, body: c.join('') }); } };
  handler({ url: path, method: 'GET' }, res);
});

test('every sitemap path renders 200 and every step has a page', async () => {
  for (const p of SITEMAP_PATHS) assert.equal((await call(p)).status, 200, p);
  for (const s of STEPS) assert.ok(stepPage(s.key), s.key);
  const sm = await call('/sitemap.xml');
  assert.equal((sm.body.match(/<loc>/g) || []).length, SITEMAP_PATHS.length);
});

test('unknown step 404s', async () => {
  assert.equal((await call('/step/nope')).status, 404);
});

test('the two free steps are labelled free and the charging is named', () => {
  const html = ladderPage();
  assert.match(html, /the <b>EIN<\/b> is free from\s+the IRS/i);
  assert.match(html, /D-U-N-S number<\/b> is free/i);
  assert.match(stepPage('ein'), /Never pay for an EIN/i);
  assert.match(stepPage('duns'), /The NUMBER is free/i);
});

test('the time-gated step says so and cannot be sold around', () => {
  const html = stepPage('history');
  assert.match(html, /time-gated and cannot be shortened/i);
  assert.match(html, /every scheme/i);
});

test('the fraud check fires on each scheme category, with the reason', async () => {
  const cases = [
    ['I can get you a CPN to use instead of your SSN', /credit privacy number/i],
    ['buy aged tradelines for your file', /tradelines/i],
    ['buy an aged shelf corporation for instant funding', /shelf/i],
    ['guaranteed 800 paydex overnight', /boost|guarantee/i],
  ];
  for (const [text, re] of cases) {
    const html = checkPage(text);
    assert.match(html, /credit fraud, not credit building/i, text);
    assert.match(html, re, text);
  }
});

test('a clean offer is not endorsed, only "these rules did not fire"', () => {
  const html = checkPage('net-30 account with Uline, reports to D&B');
  assert.match(html, /not an\s+endorsement/i);
});

test('hostile input is escaped in the check form', async () => {
  const r = await call('/check?q=%3Cscript%3Ealert(1)%3C%2Fscript%3E');
  assert.ok(!r.body.includes('<script>alert(1)'));
});

test('Experian Business opens a file without an application — the fact people miss', async () => {
  assert.match((await call('/bureaus')).body, /no application needed/i);
});
