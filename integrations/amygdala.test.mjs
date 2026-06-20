import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreSalience, rank, topSalient } from './amygdala.mjs';

test('threat + urgency score higher than a cosmetic task', () => {
  const danger = scoreSalience('Possible key leak in a public commit — investigate the breach');
  const cosmetic = scoreSalience('Add a tooltip to the tutorial page');
  assert.ok(danger.salience > cosmetic.salience);
  assert.ok(danger.threat > 0);
  assert.ok(danger.tags.includes('threat'));
});

test('urgent/broken items get an urgent tag and high urgency', () => {
  const s = scoreSalience('The feed is DOWN — vault key expired, welcomer crashed');
  assert.ok(s.urgency >= 0.34);
  assert.ok(s.tags.includes('urgent'));
});

test('valence: good news positive, bad news negative', () => {
  assert.ok(scoreSalience('Shipped and verified — all tests green, merged').valence > 0.3);
  assert.ok(scoreSalience('crash, error, lost data, corrupt, wrong').valence < -0.2);
});

test('importance lexicon (keys/chain/users) lifts salience', () => {
  const imp = scoreSalience('rotate the witness key on the live chain for all users');
  assert.ok(imp.importance > 0);
  assert.ok(imp.tags.includes('important'));
});

test('novelty: a repeat in the same batch scores 0 novelty', () => {
  const seen = new Set();
  const a = scoreSalience('patch the trivy CVEs in deps', { seen });
  const b = scoreSalience('patch the Trivy CVEs in dependencies deps', { seen }); // paraphrase → same key region
  assert.ok(a.novelty > 0);
  assert.ok(b.novelty <= a.novelty);
});

test('rank orders most-salient first and is stable on ties', () => {
  const items = [
    'Add a tooltip to the tutorial page',
    'SECURITY: key leak — exploit drained funds, urgent',
    'Polish the footer spacing',
  ];
  const r = rank(items);
  assert.match(r[0].text, /SECURITY/);
  assert.equal(r.length, 3);
});

test('rank shares a seen-set so novelty is honest across the batch', () => {
  const r = rank(['deploy the wallet pages live', 'deploy the wallet pages to production live']);
  // second near-dup should not also get full novelty
  assert.ok(r[0].novelty >= r[1].novelty);
});

test('topSalient returns the k most important', () => {
  const items = ['cosmetic a', 'cosmetic b', 'urgent crash down broken outage', 'important live chain key', 'cosmetic c'];
  const top = topSalient(items, { k: 2 });
  assert.equal(top.length, 2);
  assert.ok(top[0].salience >= top[1].salience);
});

test('timestamped items get a small recency boost', () => {
  const now = 1_000_000_000_000;
  const fresh = scoreSalience({ text: 'witness note', at: now - 1000 }, { now });
  const old = scoreSalience({ text: 'witness note', at: now - 40 * 3.6e6 }, { now });
  assert.ok(fresh.salience >= old.salience);
});

test('object items keep their source', () => {
  const s = scoreSalience({ text: 'check the gate', source: '_conference-audit.md' });
  assert.equal(s.source, '_conference-audit.md');
});

test('all sub-scores are within [0,1] and valence within [-1,1]', () => {
  for (const t of ['a normal sentence', 'THREAT exploit hack leak breach scam drain', 'done shipped live green']) {
    const s = scoreSalience(t);
    for (const k of ['salience', 'urgency', 'importance', 'threat', 'novelty']) { assert.ok(s[k] >= 0 && s[k] <= 1, `${k}=${s[k]}`); }
    assert.ok(s.valence >= -1 && s.valence <= 1);
  }
});
