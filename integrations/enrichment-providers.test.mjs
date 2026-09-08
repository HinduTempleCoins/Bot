import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PROVIDERS, ORDER, keyFor, available, status, TIERS, gradeEvidence, filterByEvidence, handler,
} from './enrichment-providers.mjs';

test('free-first ordering puts self-published links at the top', () => {
  assert.equal(ORDER[0], 'linktree');
  assert.equal(ORDER[1], 'website');
  assert.ok(ORDER.indexOf('twitter') === ORDER.length - 1, 'the paid one is last');
});

test('every provider declares its own rate limit', () => {
  for (const [id, p] of Object.entries(PROVIDERS)) {
    assert.ok(p.limit, `${id} must state a limit`);
    assert.ok(Array.isArray(p.can) && p.can.length, `${id} must declare capabilities`);
    if (!p.keyless) assert.ok(p.getKeyAt, `${id} needs a key, so it must say where to get one`);
  }
});

test('a user key beats a shared key — quotas are never pooled', () => {
  process.env.GITHUB_TOKEN = 'shared-token';
  const shared = keyFor('github', {});
  assert.equal(shared.source, 'shared');
  const own = keyFor('github', { github: 'my-own-token' });
  assert.equal(own.source, 'user');
  assert.equal(own.key, 'my-own-token');
  delete process.env.GITHUB_TOKEN;
});

test('a keyless provider always resolves', () => {
  const k = keyFor('bluesky', {});
  assert.equal(k.ok, true);
  assert.equal(k.source, 'keyless');
});

test('a key-required provider says exactly where to get one', () => {
  const k = keyFor('reddit', {});
  assert.equal(k.ok, false);
  assert.match(k.reason, /reddit\.com\/prefs\/apps/);
});

test('enrichment is usable with zero keys', () => {
  const s = status({});
  assert.ok(s.keyless >= 5, 'at least five providers work with no key at all');
  assert.ok(s.usableNow >= s.keyless);
  assert.match(s.note, /never pooled/);
});

test('supplying a key moves a provider from blocked to usable', () => {
  const before = status({});
  const after = status({ reddit: 'my-reddit-id' });
  assert.ok(after.usableNow > before.usableNow);
  assert.equal(after.withUserKey, 1);
});

test('X is listed with its price so nobody discovers it the hard way', () => {
  assert.match(PROVIDERS.twitter.cost, /\$100\/month/);
  assert.match(PROVIDERS.twitter.note, /351 of 25,375/);
});

test('a link the person published is CONCLUSIVE even with no crypto talk anywhere', () => {
  const g = gradeEvidence({
    holder: 'punicwax', handle: 'totallydifferent',
    bio: 'photographer, dad, coffee', declaredBy: 'their own website',
  });
  assert.equal(g.tier, 'conclusive');
  assert.match(g.why, /published by the holder/);
});

test('a bio naming their own account is conclusive', () => {
  const g = gradeEvidence({ holder: 'diyhub', handle: 'somethingelse', bio: 'DIYHub on Hive' });
  assert.equal(g.tier, 'conclusive');
});

test('absence of a crypto mention NEVER lowers a grade', () => {
  const withCrypto = gradeEvidence({ holder: 'alice', handle: 'alice', bio: 'I post on Hive' });
  const without = gradeEvidence({ holder: 'alice', handle: 'alice', bio: 'gardener and cat owner' });
  assert.equal(withCrypto.tier, 'strong');
  assert.equal(without.tier, 'weak', 'still weak on handle alone — but not rejected outright');
  // and a declared link outranks both regardless of bio content
  const declared = gradeEvidence({ holder: 'alice', handle: 'zzz', bio: 'gardener', declaredBy: 'linktree' });
  assert.equal(declared.tier, 'conclusive');
});

test('a bare handle match is graded weak, because it is usually someone else', () => {
  const g = gradeEvidence({ holder: 'sirguy', handle: 'sirguy', bio: '' });
  assert.equal(g.tier, 'weak');
  assert.match(TIERS.weak.meaning, /wrong most of the time/);
});

test('no evidence yields no tier — never a default pass', () => {
  assert.equal(gradeEvidence({ holder: 'a', handle: 'b', bio: 'c' }).tier, null);
  assert.equal(gradeEvidence({}).tier, null);
});

test('filtering drops weak matches by default', () => {
  const rows = [
    { tier: 'conclusive' }, { tier: 'strong' }, { tier: 'ecosystem' }, { tier: 'weak' }, { tier: null },
  ];
  assert.equal(filterByEvidence(rows).length, 3, 'weak and null are dropped');
  assert.equal(filterByEvidence(rows, 'conclusive').length, 1);
  assert.equal(filterByEvidence(rows, 'weak').length, 4);
});

test('handler publishes the BYOK policy and the tiers', () => {
  const res = { statusCode: 0, headers: {}, body: '',
    setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = b; } };
  handler({ url: '/ep' }, res);
  const j = JSON.parse(res.body);
  assert.match(j.policy, /your key raises your limits only/i);
  assert.match(j.policy, /never pooled/);
  assert.match(j.policy, /usually a different person/);
  assert.ok(j.providers.length === ORDER.length);
});
