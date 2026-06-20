import { test } from 'node:test';
import assert from 'node:assert/strict';
import { joinList, joinListMarkdown, handler, OUR_LEGS } from './exchange-onboarding.mjs';

test('joinList returns only US-accessible crypto venues (no us:no)', () => {
  const l = joinList();
  for (const r of [...l.cex, ...l.dex]) {
    assert.ok(r.us === 'full' || r.us === 'partial', `${r.name} is ${r.us}`);
  }
  assert.ok(l.cex.length > 0 && l.dex.length > 0);
});

test('includePartial:false drops partial venues', () => {
  const full = joinList({ includePartial: false });
  for (const r of [...full.cex, ...full.dex]) assert.equal(r.us, 'full');
  // partial-inclusive list is a superset
  assert.ok(joinList().cex.length >= full.cex.length);
});

test('the new venues are present and joinable', () => {
  const names = [...joinList().cex, ...joinList().dex].map((r) => r.name);
  for (const n of ['Uphold', 'CEX.IO', 'CoW Swap', 'Matcha (0x)']) assert.ok(names.includes(n), `missing ${n}`);
});

test('ranking puts us:full + trade-API venues at the top', () => {
  const top = joinList().cex[0];
  assert.equal(top.us, 'full');
  assert.ok(/trade|public/.test(top.api));
  // scores are descending
  const scores = joinList().cex.map((r) => r.score);
  assert.deepEqual(scores, [...scores].sort((a, b) => b - a));
});

test('DEX rows say no-signup / fund a wallet; KYC none', () => {
  for (const r of joinList().dex) {
    assert.equal(r.kyc, 'none');
    assert.match(r.whatToDo, /wallet|No signup/i);
  }
});

test('every row carries a start-small size and what-to-do', () => {
  for (const r of [...joinList().cex, ...joinList().dex]) {
    assert.ok(r.startSmallUsd > 0);
    assert.ok(r.whatToDo && r.whatToDo.length > 5);
    assert.ok(Array.isArray(r.listsOurLegs));
  }
});

test('BTC-only rails only claim BTC', () => {
  const swan = joinList().cex.find((r) => r.name === 'Swan Bitcoin');
  if (swan) assert.deepEqual(swan.listsOurLegs, ['BTC']);
});

test('summary counts are honest', () => {
  const l = joinList();
  assert.equal(l.summary.joinableCex, l.cex.length);
  assert.equal(l.summary.joinableDex, l.dex.length);
  assert.ok(l.summary.usBlockedSkipped > 0);
  assert.ok(OUR_LEGS.includes('BTC'));
});

test('type filter returns one class', () => {
  assert.equal(joinList({ type: 'DEX' }).cex.length, 0);
  assert.equal(joinList({ type: 'CEX' }).dex.length, 0);
});

test('markdown renders both sections', () => {
  const md = joinListMarkdown();
  assert.match(md, /CEXs \(\d+\)/);
  assert.match(md, /DEXs \(\d+/);
  assert.match(md, /start small/i);
});

test('handler returns JSON', () => {
  let body = '', code = 0;
  const res = { writeHead: (c) => { code = c; }, end: (b) => { body = b; } };
  handler({ url: '/api/exchanges/join' }, res);
  assert.equal(code, 200);
  const j = JSON.parse(body);
  assert.ok(Array.isArray(j.cex) && Array.isArray(j.dex));
});

test('handler ?format=md returns markdown', () => {
  let body = '', ct = '';
  const res = { writeHead: (c, h) => { ct = h['content-type']; }, end: (b) => { body = b; } };
  handler({ url: '/api/exchanges/join?format=md' }, res);
  assert.match(ct, /markdown/);
  assert.match(body, /Exchanges to join/);
});
