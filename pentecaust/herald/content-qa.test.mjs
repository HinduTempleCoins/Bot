import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreText, gate, AI_CLICHES, HEDGES } from './content-qa.mjs';

// A human-ish sample: varied sentence length, a point of view, no stock phrases, no em-dashes.
const HUMAN = `The pool broke last Tuesday. Nobody noticed until the miners stopped getting paid.
We traced it to a stale RPC port. I fixed it in twenty minutes and shipped a guard so it can't happen again.
Short outage. Real lesson: watch the boundary, not the middle.`;

// An AI-ish sample: uniform sentences, hedges, cliches, em-dashes, repeated openers.
const AI = `In the ever-evolving landscape of technology, it is important to note that innovation plays a crucial role.
Moreover, businesses may generally leverage cutting-edge solutions to unlock new opportunities — seamlessly.
Additionally, it is worth noting that these robust frameworks could possibly foster growth — holistically.
Furthermore, when it comes to navigating the world of digital transformation, one might delve into the realm of synergy.`;

test('scoreText: AI-ish sample scores well above human-ish sample', () => {
  const h = scoreText(HUMAN);
  const a = scoreText(AI);
  assert.ok(a.aiScore > h.aiScore, `expected AI(${a.aiScore}) > human(${h.aiScore})`);
  assert.ok(a.aiScore >= 60, `AI sample should read robotic, got ${a.aiScore}`);
  assert.ok(h.aiScore <= 45, `human sample should read human, got ${h.aiScore}`);
});

test('scoreText: aiScore always within 0-100 and shape is stable', () => {
  for (const s of [HUMAN, AI, '', 'x', 'a b c d e f g h i j k l m n o p']) {
    const r = scoreText(s);
    assert.ok(r.aiScore >= 0 && r.aiScore <= 100);
    assert.ok(Array.isArray(r.signals));
    assert.ok(Array.isArray(r.humanize));
    assert.ok(r.stats && typeof r.stats.words === 'number');
  }
});

test('scoreText: too-short text returns 0 with a too-short signal', () => {
  const r = scoreText('just a few words here');
  assert.equal(r.aiScore, 0);
  assert.equal(r.signals[0].key, 'too-short');
});

test('scoreText: detects stock AI cliches and surfaces them', () => {
  const r = scoreText(AI);
  const cliche = r.signals.find((s) => s.key === 'cliches');
  assert.ok(cliche);
  assert.ok(cliche.hits.length >= 3, `expected several cliche hits, got ${cliche.hits.length}`);
  assert.ok(cliche.hits.includes('delve into'));
});

test('scoreText: humanize suggestions appear for hot signals only', () => {
  const a = scoreText(AI);
  assert.ok(a.humanize.length > 0);
  const h = scoreText(HUMAN);
  assert.ok(h.humanize.length <= a.humanize.length);
});

test('scoreText: soft-fail on null/undefined/non-string', () => {
  assert.equal(scoreText(null).aiScore, 0);
  assert.equal(scoreText(undefined).aiScore, 0);
  assert.equal(scoreText(12345).aiScore, 0);
  assert.doesNotThrow(() => scoreText({ nope: 1 }));
});

test('gate: passes human-ish, blocks AI-ish at default max 60', () => {
  const gh = gate(HUMAN);
  const ga = gate(AI);
  assert.equal(gh.ok, true);
  assert.equal(ga.ok, false);
  assert.ok(ga.reasons.length > 0);
  assert.ok(ga.reasons[0].includes('exceeds max 60'));
});

test('gate: max is clamped and honored', () => {
  // With max 100 nothing is blocked; with max 0 the AI sample is blocked.
  assert.equal(gate(AI, { max: 100 }).ok, true);
  assert.equal(gate(AI, { max: 0 }).ok, false);
  // bad max falls back to 60.
  const g = gate(AI, { max: 'nonsense' });
  assert.equal(g.max, 60);
});

test('gate: carries humanize suggestions through', () => {
  const g = gate(AI);
  assert.ok(Array.isArray(g.humanize));
  assert.ok(g.humanize.length > 0);
});

test('catalogs are non-empty and lowercase-safe', () => {
  assert.ok(AI_CLICHES.length > 10);
  assert.ok(HEDGES.length > 5);
  assert.ok(AI_CLICHES.includes('delve into'));
});
