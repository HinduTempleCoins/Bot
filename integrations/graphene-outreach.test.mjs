// graphene-outreach.test.mjs — the guards. Offline, no network, no chain.
//
// Every test here is a refusal test, because the failure mode of this module is not "sends too few" — it
// is "sends one that gets @hathor flagged on HIVE." A founding witness account cannot recover a burned
// reputation by apologising, so the guards are pinned: never twice, never over the cap, never generic,
// and never before the bot has voted the person it is writing to.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  CHAINS, CHAIN_LIMITS, PROSPECT_THRESHOLD,
  classifyProspect, composeOutreach, outreachPlan, fetchCurationProspects, handler, __setFetch,
} from './graphene-outreach.mjs';

const GOOD = () => ({
  name: 'somecurator', chain: 'hive',
  programName: 'The Example Curation Trail',
  focus: 'long-form science writing',
  observed: 'your weekly report on under-voted chemistry posts',
  votedByUs: true,
  curationReport: true, delegationsIn: true, hasProgramPost: true, activeRecently: true,
});
const CTX = { ctx: { fromAccount: 'hathor', link: 'https://hathor.live' } };

// --- chains and limits -------------------------------------------------------

test('the three chains are the ones asked for', () => {
  assert.deepEqual(CHAINS, ['steem', 'hive', 'blurt']);
});

test('every chain has an interval and a cap, and the caps are conservative', () => {
  for (const ch of CHAINS) {
    const l = CHAIN_LIMITS[ch];
    assert.ok(l, `${ch} has no limits`);
    assert.ok(l.minIntervalSec >= 60, `${ch} interval too aggressive`);
    assert.ok(l.dailyCap > 0 && l.dailyCap <= 25, `${ch} cap of ${l.dailyCap} is not a social-floor number`);
  }
});

test('limits are frozen — a campaign must not raise them by mutation', () => {
  assert.throws(() => { CHAIN_LIMITS.hive.dailyCap = 5000; }, TypeError);
});

// --- classification ----------------------------------------------------------

test('a real curation programme clears the threshold', () => {
  const c = classifyProspect(GOOD());
  assert.equal(c.ok, true);
  assert.ok(c.score >= PROSPECT_THRESHOLD);
  assert.ok(c.reasons.length >= 3, 'and says why');
});

test('a dormant account is refused however high it scores', () => {
  const p = { ...GOOD(), activeRecently: false };
  const c = classifyProspect(p);
  assert.equal(c.ok, false);
  assert.match(c.why, /dormant/);
});

test('an ordinary active poster is not a curation programme', () => {
  const c = classifyProspect({ name: 'someone', chain: 'hive', activeRecently: true });
  assert.equal(c.ok, false);
  assert.match(c.why, /below threshold/);
});

test('classifyProspect never throws on junk', () => {
  for (const v of [null, undefined, 0, 'x', []]) {
    assert.doesNotThrow(() => classifyProspect(v));
    assert.equal(classifyProspect(v).ok, false);
  }
});

// --- the composer refuses generic --------------------------------------------

test('a message missing the programme name is REFUSED as generic', () => {
  const r = composeOutreach({ ...GOOD(), programName: '' }, CTX.ctx);
  assert.equal(r.ok, false);
  assert.match(r.why, /generic/);
  assert.match(r.why, /programme name/);
});

test('a message with nothing the bot actually observed is REFUSED', () => {
  const r = composeOutreach({ ...GOOD(), observed: '' }, CTX.ctx);
  assert.equal(r.ok, false);
  assert.match(r.why, /specific post or curation/);
});

test('GIVE BEFORE ASKING — a prospect the bot has never voted is refused', () => {
  const r = composeOutreach({ ...GOOD(), votedByUs: false }, CTX.ctx);
  assert.equal(r.ok, false);
  assert.match(r.why, /has not voted/);
});

test('a complete prospect produces a message naming the programme and the observation', () => {
  const r = composeOutreach(GOOD(), CTX.ctx);
  assert.equal(r.ok, true);
  assert.match(r.body, /@somecurator/);
  assert.match(r.body, /The Example Curation Trail/);
  assert.match(r.body, /chemistry/);
});

test('the message tells the recipient how to make it stop', () => {
  const r = composeOutreach(GOOD(), CTX.ctx);
  assert.match(r.body, /no reply needed/i);
  assert.match(r.body, /will not write again/i);
});

test('two different prospects do not produce the same message', () => {
  const a = composeOutreach(GOOD(), CTX.ctx).body;
  const b = composeOutreach({ ...GOOD(), name: 'other', programName: 'Another Trail', observed: 'your art picks' }, CTX.ctx).body;
  assert.notEqual(a, b);
});

test('composeOutreach never throws', () => {
  for (const v of [null, undefined, 0, 'x', []]) assert.doesNotThrow(() => composeOutreach(v, {}));
});

// --- the plan: never twice, never over cap -----------------------------------

test('an already-contacted account is skipped — never twice', () => {
  const state = { contacted: { 'hive:somecurator': '2026-01-01T00:00:00Z' } };
  const p = outreachPlan([GOOD()], state, CTX);
  assert.equal(p.queue.length, 0);
  assert.match(p.skipped[0].why, /already contacted/);
  assert.match(p.skipped[0].why, /never twice/);
});

test('the daily cap holds, and the overflow is reported not dropped silently', () => {
  const many = Array.from({ length: 30 }, (_, i) => ({ ...GOOD(), name: `curator${i}` }));
  const p = outreachPlan(many, {}, CTX);
  assert.equal(p.queue.length, CHAIN_LIMITS.hive.dailyCap);
  assert.equal(p.skipped.length, 30 - CHAIN_LIMITS.hive.dailyCap);
  assert.ok(p.skipped.every((s) => /daily cap/.test(s.why)));
});

test('a cap already partly used today is respected', () => {
  const many = Array.from({ length: 10 }, (_, i) => ({ ...GOOD(), name: `c${i}` }));
  const p = outreachPlan(many, { sentToday: { hive: CHAIN_LIMITS.hive.dailyCap - 2 } }, CTX);
  assert.equal(p.queue.length, 2);
});

test('the queue staggers sends by the chain interval', () => {
  const many = Array.from({ length: 3 }, (_, i) => ({ ...GOOD(), name: `c${i}` }));
  const p = outreachPlan(many, {}, CTX);
  assert.deepEqual(p.queue.map((q) => q.notBeforeOffsetSec),
    [0, CHAIN_LIMITS.hive.minIntervalSec, CHAIN_LIMITS.hive.minIntervalSec * 2]);
});

test('caps are per chain, not shared', () => {
  const mixed = [
    ...Array.from({ length: 25 }, (_, i) => ({ ...GOOD(), name: `h${i}`, chain: 'hive' })),
    ...Array.from({ length: 5 }, (_, i) => ({ ...GOOD(), name: `s${i}`, chain: 'steem' })),
  ];
  const p = outreachPlan(mixed, {}, CTX);
  assert.equal(p.byChain.hive, CHAIN_LIMITS.hive.dailyCap);
  assert.equal(p.byChain.steem, 5);
});

test('an unsupported chain is refused', () => {
  const p = outreachPlan([{ ...GOOD(), chain: 'ethereum' }], {}, CTX);
  assert.equal(p.queue.length, 0);
  assert.match(p.skipped[0].why, /unsupported chain/);
});

test('THE PLAN NEVER BROADCASTS — dryRun is always true', () => {
  const p = outreachPlan([GOOD()], {}, CTX);
  assert.equal(p.dryRun, true);
  assert.ok(p.queue[0].body, 'it produces a body for a human to approve');
});

test('outreachPlan never throws on junk', () => {
  for (const l of [null, undefined, 0, 'x', {}, [null], [0], [{}]]) {
    assert.doesNotThrow(() => outreachPlan(l, null, null));
  }
  assert.equal(outreachPlan(null, null, null).queue.length, 0);
});

// --- discovery ---------------------------------------------------------------

test('fetchCurationProspects groups posts by author', async () => {
  __setFetch(async () => ({
    ok: true,
    json: async () => ({ result: [
      { author: 'a', title: 'Curation report #1' }, { author: 'a', title: 'Curation report #2' }, { author: 'b', title: 'x' },
    ] }),
  }));
  const out = await fetchCurationProspects('hive', { rpcUrl: 'http://x.test' });
  __setFetch(null);
  assert.equal(out.length, 2);
  assert.equal(out.find((p) => p.name === 'a').posts, 2);
});

test('fetchCurationProspects soft-fails to [] rather than crashing a campaign', async () => {
  for (const f of [
    async () => { throw new Error('down'); },
    async () => ({ ok: false }),
    async () => ({ ok: true, json: async () => ({}) }),
    async () => ({ ok: true, json: async () => { throw new Error('bad json'); } }),
  ]) {
    __setFetch(f);
    assert.deepEqual(await fetchCurationProspects('hive', { rpcUrl: 'http://x.test' }), []);
  }
  __setFetch(null);
});

test('fetchCurationProspects refuses an unsupported chain or a missing rpc', async () => {
  assert.deepEqual(await fetchCurationProspects('ethereum', { rpcUrl: 'http://x.test' }), []);
  assert.deepEqual(await fetchCurationProspects('hive', {}), []);
});

// --- handler -----------------------------------------------------------------

test('handler returns the plan without sending', () => {
  let body = '';
  handler({}, { writeHead() {}, end(b) { body = b; } }, [GOOD()], {}, CTX);
  const j = JSON.parse(body);
  assert.equal(j.dryRun, true);
  assert.equal(j.queue.length, 1);
});
