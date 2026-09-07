import { test } from 'node:test';
import assert from 'node:assert/strict';
import { REG_TIERS, STACKS, stack, byTier, tiers, licenseWarnings, stale, plan, handler }
  from './comms-stack.mjs';

test('every stack entry carries repo, licence, push date and a reason', () => {
  for (const s of STACKS) {
    assert.ok(s.id && s.repo, 'id/repo');
    assert.ok(s.license, `license: ${s.id}`);
    assert.match(s.pushed, /^\d{4}-\d{2}-\d{2}$/, `pushed: ${s.id}`);
    assert.ok(s.why && s.why.length > 20, `every entry must say WHY: ${s.id}`);
    assert.ok(['app-only', 'resell', 'full'].includes(s.tier), `tier: ${s.id}`);
  }
});

test('stack ids are unique and lookup works', () => {
  const ids = STACKS.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(stack('livekit').repo, 'livekit/livekit');
  assert.equal(stack('nope'), null);
});

test('⭐ app-only is NOT interconnected and carries no carrier obligations', () => {
  assert.equal(REG_TIERS.APP_ONLY.interconnected, false);
  assert.deepEqual(REG_TIERS.APP_ONLY.obligations, []);
});

test('⭐ the full tier lists E911 first among its obligations', () => {
  assert.equal(REG_TIERS.FULL.interconnected, true);
  assert.match(REG_TIERS.FULL.obligations[0], /E911/);
  assert.match(REG_TIERS.FULL.note, /ends projects/);
});

test('reselling puts the regulatory burden on the carrier, not on us', () => {
  assert.equal(REG_TIERS.RESELL.burdenOn, 'carrier');
  assert.equal(REG_TIERS.FULL.burdenOn, 'us');
});

test('tiers() routes a PSTN architecture to resell and warns about full', () => {
  const t = tiers('we want real phone numbers and dial-out');
  assert.equal(t.id, 'resell');
  assert.equal(t.alsoConsider.id, 'full');
  assert.match(t.recommendation, /do not seek your own/);
});

test('tiers() routes in-app calling to app-only and says ship it', () => {
  const t = tiers('members call each other in-app over webrtc');
  assert.equal(t.id, 'app-only');
  assert.match(t.recommendation, /ship this first/);
});

test('tiers() assumes app-only for an unrecognised architecture but SAYS SO', () => {
  const t = tiers('something else entirely');
  assert.equal(t.id, 'app-only');
  assert.match(t.recommendation, /state the PSTN question explicitly/);
});

test('tiers() is safe on empty input', () => {
  assert.equal(tiers('').id, 'app-only');
  assert.equal(tiers(null).id, 'app-only');
});

test('AGPL projects are flagged with the NETWORK clause, not just the licence name', () => {
  const w = licenseWarnings();
  const ids = w.map((x) => x.id);
  for (const expected of ['azuracast', 'libretime', 'synapse']) {
    assert.ok(ids.includes(expected), `${expected} is AGPL and must be flagged`);
  }
  assert.match(w[0].warning, /network clause/);
  assert.match(w[0].warning, /even though nothing is distributed/);
});

test('coturn is present and marked non-optional, because calls fail without TURN', () => {
  const c = stack('coturn');
  assert.ok(c);
  assert.match(c.why, /NOT OPTIONAL/);
});

test('byTier partitions and every stack lands in a tier', () => {
  const total = byTier('app-only').length + byTier('resell').length + byTier('full').length;
  assert.equal(total, STACKS.length);
});

test('stale() finds nothing today but flags an old push when asked from the future', () => {
  assert.deepEqual(stale('2026-09-07T00:00:00Z', 12), []);
  const future = stale('2030-01-01T00:00:00Z', 12);
  assert.equal(future.length, STACKS.length, 'from far enough ahead everything is stale');
  assert.match(future[0].note, /verify before adopting/);
});

test('the plan escalates and names what each step triggers', () => {
  const p = plan();
  assert.equal(p[0].tier, 'app-only');
  assert.equal(p[0].triggers, 'no carrier obligations');
  assert.equal(p[2].tier, 'resell');
  assert.match(p[2].triggers, /carrier holds E911/);
  assert.equal(p[3].tier, 'full');
  assert.match(p[3].why, /only if volume ever justifies/);
  for (const s of p) assert.ok(s.why, `every step must carry its reasoning: ${s.step}`);
});

test('step 2 preserves the POINT posture of the existing radio reader', () => {
  assert.match(plan()[1].why, /never rehosts/);
});

test('handler leads with the regulatory reality and disclaims legal advice', () => {
  const res = { code: 0, body: '', writeHead(c) { this.code = c; }, end(b) { this.body = b; } };
  handler({ url: '/' }, res);
  assert.equal(res.code, 200);
  const j = JSON.parse(res.body);
  assert.match(j.headline, /software is free and mature/);
  assert.match(j.headline, /E911/);
  assert.match(j.disclaimer, /[Nn]ot legal advice/);
  assert.equal(j.counts.agpl, 3);
});
