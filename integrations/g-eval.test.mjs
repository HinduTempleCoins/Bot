import { test } from 'node:test';
import assert from 'node:assert';
import {
  evaluate, scoreBrief, batchEvaluate, RUBRICS, DEFAULT_PASS_THRESHOLD, __setJudge,
} from './g-eval.mjs';

const GOOD_BRIEF = [
  '## FOR RYAN',
  'In short: the Discord bot needs its news feed wired up so it can answer market questions.',
  'Next decision for you: approve restarting the service so the change can go live.',
  '',
  '## FOR CLAUDE CODE',
  'Build the news adapter, add a failover source, and merge it into the !sb command.',
  '',
  '## DRAFTED CODE',
  '```js',
  'export async function fetchNews() { const r = await getFeed(); return dedupCap(r, 10); }',
  '```',
].join('\n');

const BAD_BRIEF = 'done';

test('RUBRICS registry has the required named rubrics with steps + 1..5 scale', () => {
  for (const name of ['brief-quality', 'coherence', 'relevance', 'groundedness']) {
    const r = RUBRICS[name];
    assert.ok(r, `rubric ${name} exists`);
    assert.equal(r.name, name);
    assert.ok(Array.isArray(r.steps) && r.steps.length >= 1, `${name} has steps`);
    assert.equal(r.scale.min, 1);
    assert.equal(r.scale.max, 5);
    for (const s of r.steps) {
      assert.ok(s.key && s.instruction && typeof s.proxy === 'function', `${name} step well-formed`);
    }
  }
});

test('well-formed brief scores higher than empty/one-line and passes; bad fails', async () => {
  const good = await scoreBrief(GOOD_BRIEF);
  const bad = await scoreBrief(BAD_BRIEF);
  assert.ok(good.score > bad.score, `good ${good.score} > bad ${bad.score}`);
  assert.equal(good.pass, true, 'good brief passes');
  assert.equal(bad.pass, false, 'bad brief fails');
});

test('score is on the 1..5 scale and normalized is in 0..1', async () => {
  for (const t of [GOOD_BRIEF, BAD_BRIEF, '']) {
    const r = await scoreBrief(t);
    assert.ok(r.score >= 1 && r.score <= 5, `score ${r.score} in range`);
    assert.ok(r.normalized >= 0 && r.normalized <= 1, `normalized ${r.normalized} in range`);
  }
});

test('reasoning is an array of step sub-scores', async () => {
  const r = await scoreBrief(GOOD_BRIEF);
  assert.ok(Array.isArray(r.reasoning));
  assert.equal(r.reasoning.length, RUBRICS['brief-quality'].steps.length);
  for (const step of r.reasoning) {
    assert.ok(step.key && step.instruction);
    assert.ok(step.score >= 1 && step.score <= 5);
    assert.equal(step.source, 'heuristic'); // no judge injected
  }
});

test('unknown rubric soft-fails to a safe, non-passing result (no throw)', async () => {
  const r = await evaluate({ text: GOOD_BRIEF, rubric: 'does-not-exist' });
  assert.equal(r.pass, false);
  assert.equal(r.normalized, 0);
  assert.ok(r.error && /unknown rubric/i.test(r.error));
  assert.deepEqual(r.reasoning, []);
});

test('injected judge is used and its numeric score is parsed', async () => {
  let calls = 0;
  __setJudge(async (prompt) => {
    calls++;
    assert.ok(/Evaluation step:/.test(prompt), 'prompt carries the CoT step');
    return 'I rate this a 5 out of 5.'; // judge returns prose with a number
  });
  try {
    const r = await scoreBrief(BAD_BRIEF); // bad text, but judge forces top score
    assert.ok(calls >= 1, 'judge was called');
    assert.equal(r.score, 5, 'parsed the judge score');
    assert.equal(r.normalized, 1);
    assert.equal(r.pass, true);
    for (const step of r.reasoning) assert.equal(step.source, 'judge');
  } finally {
    __setJudge(null); // restore offline mode
  }
});

test('judge that throws soft-falls back to the heuristic', async () => {
  __setJudge(async () => { throw new Error('judge offline'); });
  try {
    const r = await scoreBrief(GOOD_BRIEF);
    assert.ok(r.score >= 1 && r.score <= 5);
    for (const step of r.reasoning) assert.equal(step.source, 'heuristic');
  } finally {
    __setJudge(null);
  }
});

test('groundedness rewards text supported by context', async () => {
  const ctx = 'Alexander Shulgin was an American chemist who authored PiHKAL and TiHKAL.';
  const grounded = await evaluate({ text: 'Shulgin authored PiHKAL and TiHKAL.', rubric: 'groundedness', context: ctx });
  const fabricated = await evaluate({ text: 'Napoleon piloted a spaceship to Jupiter in 1820.', rubric: 'groundedness', context: ctx });
  assert.ok(grounded.score > fabricated.score, `grounded ${grounded.score} > fabricated ${fabricated.score}`);
});

test('batchEvaluate aggregates mean score, normalized, and pass rate', async () => {
  const batch = await batchEvaluate([GOOD_BRIEF, BAD_BRIEF], 'brief-quality');
  assert.equal(batch.count, 2);
  assert.equal(batch.results.length, 2);
  assert.ok(batch.aggregate.meanScore >= 1 && batch.aggregate.meanScore <= 5);
  assert.ok(batch.aggregate.meanNormalized >= 0 && batch.aggregate.meanNormalized <= 1);
  assert.equal(batch.aggregate.passed, 1, 'only the good brief passes');
  assert.equal(batch.aggregate.passRate, 0.5);
});

test('batchEvaluate accepts {text,context} objects', async () => {
  const batch = await batchEvaluate([
    { text: 'Shulgin wrote PiHKAL.', context: 'Shulgin wrote PiHKAL and TiHKAL.' },
  ], 'groundedness');
  assert.equal(batch.count, 1);
  assert.ok(batch.results[0].score >= 1);
});

test('custom threshold flips pass/fail', async () => {
  const lax = await evaluate({ text: 'A short but on-topic note about briefs.', rubric: 'coherence' }, { threshold: 0 });
  assert.equal(lax.pass, true, 'threshold 0 always passes a scored item');
  const strict = await evaluate({ text: BAD_BRIEF, rubric: 'brief-quality' }, { threshold: 0.99 });
  assert.equal(strict.pass, false);
});

test('DEFAULT_PASS_THRESHOLD is the documented 0.6', () => {
  assert.equal(DEFAULT_PASS_THRESHOLD, 0.6);
});
