// pentecaust/herald/haro-monitor.test.mjs — offline tests for the Herald source-request (HARO) monitor.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOPICS, matchQuery, draftResponse, scanDigest, __setLLM } from './haro-monitor.mjs';

test('matchQuery: matches crypto + RFRA; unrelated query does not match', () => {
  const m = matchQuery({ subject: 'Seeking a blockchain expert on religious liberty', body: 'RFRA angle for a token story' });
  assert.equal(m.matched, true);
  assert.ok(m.topics.includes('blockchain_crypto'));
  assert.ok(m.topics.includes('religious_liberty_rfra'));

  const n = matchQuery({ subject: 'Best houseplants for low light', body: 'decor tips' });
  assert.equal(n.matched, false);
  assert.deepEqual(n.topics, []);
});

test('draftResponse (no LLM): matched → first-person draft; unmatched → soft-fail', async () => {
  __setLLM(null);
  const r = await draftResponse({ subject: 'kava and kratom regulation', body: 'ethnobotany source needed' });
  assert.equal(r.ok, true);
  assert.ok(r.topics.includes('ethnobotany'));
  assert.ok(/\bI\b/.test(r.draft), 'first person');
  assert.ok(r.draft.length > 0);

  const u = await draftResponse({ subject: 'sports scores', body: 'nothing relevant' });
  assert.equal(u.ok, false);
});

test('draftResponse uses an injected LLM when present', async () => {
  __setLLM(async () => 'CUSTOM LLM PITCH about crypto.');
  const r = await draftResponse({ subject: 'crypto expert wanted', body: 'defi story' });
  __setLLM(null);
  assert.equal(r.ok, true);
  assert.ok(r.draft.includes('CUSTOM LLM PITCH'));
});

test('scanDigest: keeps only matched, sorts by deadline, flags urgent', async () => {
  __setLLM(null);
  const nowMs = 1_000_000_000_000;
  const items = [
    { source: 'HARO', outlet: 'FarAway', subject: 'blockchain', body: 'token', deadline: nowMs + 5 * 24 * 3600 * 1000 }, // far
    { source: 'HARO', outlet: 'Unrelated', subject: 'gardening', body: 'plants only' },                                   // no match
    { source: 'Qwoted', outlet: 'Soon', subject: 'pro se litigation', body: 'self-represented', deadline: nowMs + 3 * 3600 * 1000 }, // urgent
  ];
  const out = await scanDigest(items, { now: nowMs });
  assert.equal(out.length, 2, 'unrelated dropped');
  assert.equal(out[0].outlet, 'Soon', 'soonest deadline first');
  assert.equal(out[0].deadlineFlag, true, 'within 24h flagged');
  assert.equal(out[1].deadlineFlag, false, 'far deadline not flagged');
});
