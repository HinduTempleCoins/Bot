import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SEED_PAIRS, SET_ID, SET_KIND, PROMPTS, CONTRIBUTION_REQUIREMENTS, LENGTH_TOLERANCE,
  MAX_LENGTH_BIAS, MIN_PAIRS, validatePair, lengthBias, loadPairs, vintage, wordsIn, __setIO,
} from './human-or-model-corpus.mjs';

test('every seed pair validates: two halves, a topic, a cited human source, a dated model', () => {
  assert.ok(SEED_PAIRS.length >= MIN_PAIRS, `${SEED_PAIRS.length} pairs is under the floor of ${MIN_PAIRS}`);
  assert.equal(new Set(SEED_PAIRS.map((p) => p.id)).size, SEED_PAIRS.length, 'duplicate pair id');
  for (const p of SEED_PAIRS) {
    const v = validatePair(p);
    assert.ok(v.ok, `${p.id}: ${v.errors.join('; ')}`);
    assert.ok(p.human.author && p.human.work && p.human.year, `${p.id} has no citable human source`);
    assert.ok(p.human.year < 1929, `${p.id}: the human half must be public domain by age, got ${p.human.year}`);
    assert.match(p.model.generatedAt, /^\d{4}-\d{2}-\d{2}$/, `${p.id}: the model half needs an ISO generation date`);
    assert.ok(p.model.model, `${p.id}: the model half must name the model that wrote it`);
  }
});

test('the halves are matched for length pair by pair', () => {
  for (const p of SEED_PAIRS) {
    const h = wordsIn(p.human.text);
    const m = wordsIn(p.model.text);
    const diff = Math.abs(h - m) / Math.max(h, m);
    assert.ok(diff <= LENGTH_TOLERANCE, `${p.id}: ${h} vs ${m} words is ${Math.round(diff * 100)}% apart`);
  }
});

// ── the bug a per-pair check does not catch ──────────────────────────────────────────────────────

test('length is not a cue: the model half is not systematically the longer half', () => {
  // The first draft of this set passed the per-pair check above and was still broken — the model half
  // was longer in nine pairs out of ten, so "pick the longer one" would have scored ~90% without
  // discriminating anything. This is the assertion that catches that.
  const b = lengthBias(SEED_PAIRS);
  assert.equal(b.n, SEED_PAIRS.length);
  assert.ok(Math.abs(b.bias) <= MAX_LENGTH_BIAS,
    `the model half is longer in ${Math.round(b.modelLongerShare * 100)}% of pairs — that is a length-discrimination task`);
  assert.ok(Math.abs(b.meanSigned) < 0.02,
    `mean signed length difference is ${(b.meanSigned * 100).toFixed(1)}%, which is a usable cue`);
  assert.ok(b.worst <= LENGTH_TOLERANCE);
});

test('no pair is a paraphrase of its partner — the halves say different things', () => {
  // Matched on topic must not mean "the same sentences reworded", which would make the task a
  // detect-the-rewriting task instead.
  for (const p of SEED_PAIRS) {
    const words = (s) => new Set(String(s).toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter((w) => w.length > 4));
    const h = words(p.human.text);
    const m = words(p.model.text);
    const shared = [...h].filter((w) => m.has(w)).length;
    const jaccard = shared / (h.size + m.size - shared);
    assert.ok(jaccard < 0.35, `${p.id}: content-word overlap ${jaccard.toFixed(2)} — that is a paraphrase, not a pair`);
  }
});

test('validatePair rejects the specific ways a pair goes wrong, with a reason each', () => {
  const good = SEED_PAIRS[0];
  const bad = (patch) => validatePair({ ...good, ...patch, human: { ...good.human, ...(patch.human || {}) }, model: { ...good.model, ...(patch.model || {}) } });
  assert.match(bad({ topic: '' }).errors.join(' '), /topic/);
  assert.match(bad({ human: { author: '', source: '' } }).errors.join(' '), /provenance/);
  assert.match(bad({ model: { model: '' } }).errors.join(' '), /which model/);
  assert.match(bad({ model: { generatedAt: '' } }).errors.join(' '), /timestamp/);
  assert.match(bad({ model: { text: `${good.model.text} ${good.model.text}` } }).errors.join(' '), /differ in length/);
  assert.match(bad({ human: { text: 'short' } }).errors.join(' '), /too short/);
  assert.equal(validatePair(null).ok, false);
  assert.equal(validatePair('nope').ok, false);
});

// ── the loader ───────────────────────────────────────────────────────────────────────────────────

const pairLine = (id) => JSON.stringify({
  id,
  topic: `topic ${id}`,
  human: { author: 'A Contributor', source: 'contributed 2026-09-08', text: 'word '.repeat(40).trim() },
  model: { model: 'hathor', generatedAt: '2026-09-08', text: 'other '.repeat(40).trim() },
});

test('an operator pool replaces the seed once there are enough usable pairs', () => {
  __setIO({ read: () => Array.from({ length: MIN_PAIRS }, (_, i) => pairLine(`p${i}`)).join('\n') });
  const loaded = loadPairs({ file: 'x' });
  assert.equal(loaded.kind, 'pool');
  assert.equal(loaded.pairs.length, MIN_PAIRS);
  __setIO(null);
});

test('a thin or broken pool falls back to the seed and SAYS why, rather than serving two trials', () => {
  __setIO({ read: () => `${pairLine('only-one')}\nnot json\n${JSON.stringify({ id: 'no-topic' })}` });
  const loaded = loadPairs({ file: 'x' });
  assert.equal(loaded.kind, SET_KIND);
  assert.equal(loaded.pairs.length, SEED_PAIRS.length);
  assert.ok(loaded.rejected.some((r) => /only 1 usable pairs/.test(r)), loaded.rejected.join(' | '));
  assert.ok(loaded.rejected.some((r) => /unparseable/.test(r)));
  __setIO(null);
});

test('a missing pool file is not an error — it is the seed', () => {
  __setIO({ read: () => { throw new Error('ENOENT'); } });
  assert.doesNotThrow(() => loadPairs({ file: 'nope' }));
  __setIO({ read: () => '' });
  const loaded = loadPairs({ file: 'nope' });
  assert.equal(loaded.kind, SET_KIND);
  assert.equal(loaded.source, `${SET_ID} (built in)`);
  __setIO(null);
});

// ── the timestamp, which is the stated honest limit made into code ───────────────────────────────

test('vintage reports the generation date, the model and the age, and says the score is against that vintage', () => {
  const v = vintage(SEED_PAIRS, { now: () => new Date('2026-09-18T00:00:00Z') });
  assert.equal(v.newest, '2026-09-08');
  assert.equal(v.ageDays, 10);
  assert.deepEqual(v.models, ['Claude Opus 5']);
  assert.match(v.sentence, /2026-09-08/);
  assert.match(v.sentence, /10 days ago/);
  assert.match(v.sentence, /against that vintage of model and no other/);
  assert.match(v.sentence, /does not mean the same thing in two years/);
});

test('an undated set is reported as uninterpretable rather than given a date', () => {
  const v = vintage([{ id: 'x', human: { text: 'a' }, model: { text: 'b' } }]);
  assert.equal(v.newest, null);
  assert.match(v.sentence, /cannot be stated/);
  assert.equal(vintage('nonsense').newest, null);
});

// ── the specification for a real set ─────────────────────────────────────────────────────────────

test('the prompt set is a runnable collection spec, not a wish', () => {
  assert.ok(PROMPTS.length >= 6);
  for (const p of PROMPTS) {
    assert.ok(p.id && p.topic);
    assert.ok(Array.isArray(p.words) && p.words.length === 2 && p.words[0] < p.words[1],
      `${p.id} needs a word budget, because matched-for-length is enforced at ingest`);
  }
  assert.ok(CONTRIBUTION_REQUIREMENTS.some((r) => /consent/i.test(r)));
  assert.ok(CONTRIBUTION_REQUIREMENTS.some((r) => /no model assisted/i.test(r)));
});

test('the seed set says out loud that it is a seed', () => {
  assert.equal(SET_KIND, 'seed');
  assert.equal(loadPairs({ file: '/nonexistent/nope.jsonl' }).kind, 'seed');
});
