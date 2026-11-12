// server.test.mjs — offline tests for the read-only tutorial page (site/tutorial/server.mjs).
// No network, no chain, no LLM: the reader seam is injected with fixture lesson data.
// Asserts the page lists lesson titles/summaries and that HTML in lesson fields is escaped.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { handler, renderTutorialHtml, loadLessons, esc, __setReader, daoCardHtml,
  __setActivityReader, __setBroadcastJson, __setDelegate } from './server.mjs';
import { MEMBERSHIP_STAGES } from '../../integrations/melek-dao.mjs';

// The DAO roll must never touch the real one from a test.
process.env.DAO_DATA = new URL(`./.test-dao-roll-${process.pid}.json`, import.meta.url).pathname;

// minimal fake req/res that captures what the handler writes
function fakeReqRes(reqUrl = '/', method = 'GET', body) {
  const res = {
    statusCode: null,
    headers: null,
    body: '',
    writeHead(code, headers) { this.statusCode = code; this.headers = headers; return this; },
    end(chunk) { if (chunk != null) this.body += chunk; return this; },
  };
  const h = {};
  const req = { url: reqUrl, method, headers: {}, on: (e, fn) => { h[e] = fn; return req; }, destroy: () => {} };
  queueMicrotask(() => { if (body !== undefined && h.data) h.data(JSON.stringify(body)); if (h.end) h.end(); });
  return { req, res };
}

// Chain activity (tutorial/chain-reader shape) that satisfies all six stages.
function fullActivity(acct) {
  return {
    account: acct,
    posts: [{ author: acct, body: 'x'.repeat(250), tags: ['introduceyourself'] }, { author: acct, body: 'y'.repeat(900), tags: ['howto'] }],
    comments: [
      { author: acct, parent_author: 'kalivankush', body: 'c'.repeat(100) },
      { author: acct, parent_author: 'nicedude', body: 'd'.repeat(100) },
      { author: acct, parent_author: 'megareigns', body: 'e'.repeat(100) },
    ],
    votes_received: [{ voter: 'kalivankush', author: acct, permlink: 'p', weight: 10000 }],
    transfers_to_vesting: [{ from: acct, to: acct, amount: '5.000 MELEK' }],
    witness_votes: ['hathor'],
  };
}
const call = async (url, method = 'GET', body) => {
  const { req, res } = fakeReqRes(url, method, body);
  await handler(req, res);
  let j = null; try { j = JSON.parse(res.body); } catch {}
  return { code: res.statusCode, body: res.body, j };
};

const FIXTURE = {
  _meta: { version: 2 },
  stages: [
    { id: 1, key: 'intro_post', tier: 'A', label: 'Post an introduction', description: 'New user publishes a top-level post introducing themselves.' },
    { id: 2, key: 'engage_three_posts', tier: 'A', label: 'Comment on three posts', description: 'Leave substantive comments on three distinct authors.' },
    { id: 7, key: 'curation', tier: 'B', label: 'Earn a curation reward', description: 'Vote early on a post that does well.' },
    { id: 14, key: 'converse', tier: 'C', label: 'Talk with the Witness', description: 'Hold a real conversation in the Angelic register.' },
  ],
};

test('renderTutorialHtml lists every lesson title and summary', () => {
  const html = renderTutorialHtml(FIXTURE.stages);
  for (const s of FIXTURE.stages) {
    assert.ok(html.includes(esc(s.label)), `missing title: ${s.label}`);
    assert.ok(html.includes(esc(s.description)), `missing summary: ${s.description}`);
  }
  // tier badges rendered
  assert.ok(html.includes('Tier A'));
  assert.ok(html.includes('Tier B'));
  assert.ok(html.includes('Tier C'));
});

test('renderTutorialHtml escapes HTML in lesson fields', () => {
  const evil = [{ id: 1, tier: 'A', label: '<script>alert(1)</script>', description: 'a & b < c > "d"' }];
  const html = renderTutorialHtml(evil);
  assert.ok(!html.includes('<script>alert(1)</script>'), 'raw script tag leaked');
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'), 'title not escaped');
  assert.ok(html.includes('a &amp; b &lt; c &gt; &quot;d&quot;'), 'summary not escaped');
});

test('renderTutorialHtml soft-fails on non-array / empty input', () => {
  assert.ok(renderTutorialHtml(null).includes('temporarily unavailable'));
  assert.ok(renderTutorialHtml([]).includes('temporarily unavailable'));
  assert.ok(renderTutorialHtml(undefined).includes('temporarily unavailable'));
});

test('renderTutorialHtml tolerates missing fields', () => {
  const html = renderTutorialHtml([{}, { id: 5 }, { label: 'Only a label' }]);
  assert.ok(html.includes('Only a label'));
  assert.ok(html.includes('Lesson')); // fallback title for the empty object
});

test('handler GET / serves a full HTML page listing lesson titles (escaped)', async () => {
  __setReader(() => FIXTURE);
  try {
    const { req, res } = fakeReqRes('/');
    await handler(req, res);
    assert.equal(res.statusCode, 200);
    assert.match(res.headers['content-type'], /text\/html/);
    assert.ok(res.body.startsWith('<!doctype html>'));
    assert.ok(res.body.includes('Post an introduction'));
    assert.ok(res.body.includes('Talk with the Witness'));
    assert.ok(res.body.includes('New user publishes a top-level post introducing themselves.'));
  } finally {
    __setReader(null); // reset to default loader
  }
});

test('handler GET / soft-fails to placeholder when reader throws (still 200, no throw)', async () => {
  __setReader(() => { throw new Error('disk gone'); });
  try {
    const { req, res } = fakeReqRes('/');
    await handler(req, res);
    assert.equal(res.statusCode, 200);
    assert.ok(res.body.includes('temporarily unavailable'));
  } finally {
    __setReader(null);
  }
});

test('handler GET /health returns ok', async () => {
  const { req, res } = fakeReqRes('/health');
  await handler(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body, 'ok');
});

test('handler unknown path redirects to /', async () => {
  const { req, res } = fakeReqRes('/does-not-exist');
  await handler(req, res);
  assert.equal(res.statusCode, 302);
  assert.equal(res.headers.location, '/');
});

test('loadLessons returns the real committed 19 stages through the default loader', () => {
  __setReader(null); // default = tutorial/composers.mjs loadStagesDoc()
  const lessons = loadLessons();
  assert.ok(Array.isArray(lessons));
  assert.ok(lessons.length >= 19, `expected >=19 stages, got ${lessons.length}`);
  assert.ok(lessons.every((s) => s && s.label));
});


// ── the DAO on the Instructions page (operator, 2026-11-12) ───────────────────────────────────────

import { after, beforeEach } from 'node:test';
import { unlinkSync, writeFileSync } from 'node:fs';
after(() => { try { unlinkSync(process.env.DAO_DATA); } catch {} });
beforeEach(() => { writeFileSync(process.env.DAO_DATA, '{}'); __setActivityReader(null); __setBroadcastJson(null); __setDelegate(null); });

test('the Instructions page says finishing them puts you in the DAO', () => {
  const html = daoCardHtml();
  assert.match(html, /Finish all of these and you are in the MELEK DAO/);
  assert.match(html, /3% of every block/);
  assert.match(html, /earned by finishing every one of the 6 stages/);
  assert.match(html, /href="\/dao"/);
});

test('GET /dao renders the fund, the stages, the roll and what a seat gives', async () => {
  const r = await call('/dao');
  assert.equal(r.code, 200);
  assert.match(r.body, /The MELEK DAO/);
  assert.match(r.body, /648\.000 a day/);           // 3% of 21,600/day
  assert.match(r.body, /27\.000 MELEK an hour/);
  for (const k of MEMBERSHIP_STAGES) assert.ok(r.body.includes(k), `stage missing from /dao: ${k}`);
  assert.match(r.body, /No one has finished every stage yet/);
});

test('GET /api/dao/membership reads progress off the chain and names what is left', async () => {
  const partial = fullActivity('halfway');
  partial.witness_votes = [];
  __setActivityReader(async () => partial);
  const r = await call('/api/dao/membership?account=halfway');
  assert.equal(r.code, 200);
  assert.equal(r.j.eligible, false);
  assert.equal(r.j.pctComplete, 83.33);
  assert.deepEqual(r.j.missing, ['vote_for_a_witness']);
});

test('POST /api/dao/enroll seats a finisher and records the seat on-chain', async () => {
  const ops = [];
  __setActivityReader(async (a) => fullActivity(a));
  __setBroadcastJson(async (op) => { ops.push(op); return { id: 'trx-seat' }; });
  const r = await call('/api/dao/enroll', 'POST', { account: 'finisher' });
  assert.equal(r.code, 200);
  assert.equal(r.j.ok, true);
  assert.equal(r.j.trxId, 'trx-seat');
  assert.equal(ops[0][0], 'custom_json');
  assert.deepEqual(ops[0][1].required_posting_auths, ['hathor']);
  assert.deepEqual(ops[0][1].required_auths, []);
  // the delegation is not wired by default, and the route says so instead of claiming it
  assert.equal(r.j.delegation.delegated, false);
  const list = await call('/api/dao/roll');
  assert.equal(list.j.count, 1);
  assert.equal(list.j.members[0].account, 'finisher');
});

test('POST /api/dao/enroll refuses someone who has not finished, with the list', async () => {
  const partial = fullActivity('notdone');
  partial.posts = [];
  __setActivityReader(async () => partial);
  __setBroadcastJson(async () => ({ id: 'should-not-happen' }));
  const r = await call('/api/dao/enroll', 'POST', { account: 'notdone' });
  assert.equal(r.code, 422);
  assert.equal(r.j.ok, false);
  assert.match(r.j.reason, /intro_post/);
  assert.equal((await call('/api/dao/roll')).j.count, 0);
});

test('the DAO routes never throw, and need an account', async () => {
  assert.equal((await call('/api/dao/membership')).code, 422);
  assert.equal((await call('/api/dao/enroll', 'POST', {})).code, 422);
  __setActivityReader(async () => { throw new Error('rpc down'); });
  const r = await call('/api/dao/membership?account=someone');
  assert.equal(r.code, 200);
  assert.equal(r.j.eligible, false);
  assert.match(r.j.reason, /no chain reader wired|could not read/);
});

test('GET /api/dao states the 3% carve and that the existing balance is untouched', async () => {
  const r = await call('/api/dao');
  assert.equal(r.code, 200);
  assert.equal(r.j.fundSharePct, 0.03);
  assert.equal(r.j.inflowPerDay, 648);
  assert.equal(r.j.dao, 'melek.dao');
  assert.match(r.j.fundNote, /not touched/);
});
