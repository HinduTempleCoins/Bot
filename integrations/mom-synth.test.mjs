// mom-synth.test.mjs — offline. The deterministic floor works with NO model; the polish path is used
// when a model is injected and ONLY replaces the floor when it returns substantive minutes. No network.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  summarizeAsks,
  extractiveMinutes,
  classifyAsk,
  rankAsks,
  __setComplete,
  __setFetch,
} from './mom-synth.mjs';

const ASKS = [
  'We decided to wire the MoM synth into the brief pipeline.',
  'Build the deterministic extractive summarizer first.',
  'owner: Qwen — summarize the 12-and-12 conference to minutes nightly',
  'Should we let brief-writers see attendee attribution?',
  'TODO: add the BM25 salience ranking.',
  'Agreed: the deterministic floor must always produce real minutes, never a template.',
];

// ── classification ────────────────────────────────────────────────────────────────────────────
test('classifyAsk routes decision / action / ask by cue phrases', () => {
  assert.equal(classifyAsk('We decided to use BM25 over cosine.'), 'decision');
  assert.equal(classifyAsk('Agreed: the floor is always real.'), 'decision');
  assert.equal(classifyAsk('Build the summarizer.'), 'action');
  assert.equal(classifyAsk('TODO: add ranking.'), 'action');
  assert.equal(classifyAsk('we will deploy nightly'), 'action');
  assert.equal(classifyAsk('Should we let writers see attribution?'), 'ask');
  assert.equal(classifyAsk('Open question: which model?'), 'ask');
  assert.equal(classifyAsk('The convergence framework as temple technology'), 'ask');
});

test('classifyAsk honours an explicit kind on the object', () => {
  assert.equal(classifyAsk({ text: 'whatever', kind: 'decision' }), 'decision');
  assert.equal(classifyAsk({ text: 'Build it', kind: 'ask' }), 'ask');
});

test('classifyAsk soft-fails on junk input', () => {
  assert.equal(classifyAsk(null), 'ask');
  assert.equal(classifyAsk(''), 'ask');
  assert.equal(classifyAsk(undefined), 'ask');
});

// ── ranking ───────────────────────────────────────────────────────────────────────────────────
test('rankAsks is deterministic and sorts by salience (stable on ties)', () => {
  const norm = [
    { text: 'the the the' },                    // all-common terms → low salience
    { text: 'BM25 salience ranking headline' },  // distinctive terms → high salience
    { text: 'the the the' },                    // dup of #0 path (kept here since rankAsks does not dedup)
  ];
  const r1 = rankAsks(norm);
  const r2 = rankAsks(norm);
  assert.deepEqual(r1.map((x) => x.order), r2.map((x) => x.order), 'deterministic across runs');
  assert.equal(r1[0].ask.text, 'BM25 salience ranking headline', 'distinctive ask ranks first');
});

test('rankAsks soft-fails on empty / junk', () => {
  assert.deepEqual(rankAsks([]), []);
  assert.deepEqual(rankAsks(null), []);
  assert.deepEqual(rankAsks([null, { text: '' }]), []);
});

// ── deterministic floor (NO model) ──────────────────────────────────────────────────────────────
test('extractiveMinutes produces REAL structured minutes with no model', () => {
  const md = extractiveMinutes(ASKS, { title: 'Test conference' });
  assert.match(md, /^# Test conference/);
  assert.match(md, /\*\*Summary:\*\*/);
  assert.match(md, /## Decisions/);
  assert.match(md, /## Action items/);
  assert.match(md, /## Asks raised/);
  // the decided/agreed lines land under Decisions.
  assert.match(md, /- .*wire the MoM synth into the brief pipeline/);
  assert.match(md, /- .*deterministic floor must always produce real minutes/);
  // an action carries a checkbox.
  assert.match(md, /- \[ \] Build the deterministic extractive summarizer/);
  // the owner is surfaced.
  assert.match(md, /_\(owner: Qwen\)_/);
  // the question lands under Asks.
  assert.match(md, /- Should we let brief-writers see attendee attribution\?/);
  // NEVER a template / placeholder.
  assert.doesNotMatch(md, /TODO_FILL|PLACEHOLDER|<.*>|lorem ipsum/i);
});

test('extractiveMinutes splits a multi-line string ask into separate items', () => {
  const md = extractiveMinutes('Build the thing\nTest the thing\nShip the thing');
  assert.match(md, /- \[ \] Build the thing/);
  assert.match(md, /- \[ \] Test the thing/);
  assert.match(md, /- \[ \] Ship the thing/);
});

test('extractiveMinutes empty input yields a valid no-asks doc, not a throw', () => {
  const md = extractiveMinutes([]);
  assert.match(md, /^# Meeting minutes/);
  assert.match(md, /_No asks were raised this session\._/);
});

// ── summarizeAsks: floor when complete:null ───────────────────────────────────────────────────
test('summarizeAsks with complete:null returns the deterministic floor verbatim', async () => {
  const floor = extractiveMinutes(ASKS, { title: 'X' });
  const out = await summarizeAsks(ASKS, { title: 'X', complete: null });
  assert.equal(out, floor, 'forced floor equals the deterministic extractive output');
});

test('summarizeAsks is async and deterministic on the floor path', async () => {
  const a = await summarizeAsks(ASKS, { complete: null });
  const b = await summarizeAsks(ASKS, { complete: null });
  assert.equal(a, b);
});

// ── summarizeAsks: model path used when injected and substantive ─────────────────────────────────
test('summarizeAsks uses an injected model that returns substantive minutes', async () => {
  let sawPrompt = null;
  const fakeModel = (prompt) => {
    sawPrompt = prompt;
    // a clean, substantive rewrite: heading + summary + sections, long enough to pass the gate.
    return [
      '# Polished minutes',
      '',
      '**Summary:** 2 decisions, 2 action items, 1 ask. Top item: wire the MoM synth.',
      '',
      '## Decisions',
      '- Wire the MoM synth into the brief pipeline.',
      '- The deterministic floor must always produce real minutes, never a template.',
      '',
      '## Action items',
      '- [ ] Build the deterministic extractive summarizer first.',
      '- [ ] Add the BM25 salience ranking. (owner: Qwen)',
      '',
      '## Asks raised',
      '- Should brief-writers see attendee attribution?',
      '',
      '*Distilled minutes.*',
    ].join('\n');
  };
  const out = await summarizeAsks(ASKS, { title: 'X', complete: fakeModel });
  assert.match(out, /# Polished minutes/, 'the polished output replaced the floor');
  // the model was handed the EXACT deterministic floor in a tightly-scoped prompt.
  assert.match(sawPrompt, /DRAFT MINUTES/);
  assert.match(sawPrompt, /Do NOT invent/);
  assert.match(sawPrompt, /Build the deterministic extractive summarizer/);
});

test('summarizeAsks accepts a model that returns an object {text}', async () => {
  const floor = extractiveMinutes(ASKS);
  const model = () => ({ text: `# Tidy minutes\n\n${floor}\n\nextra line to clear the length gate.` });
  const out = await summarizeAsks(ASKS, { complete: model });
  assert.match(out, /# Tidy minutes/);
});

// ── summarizeAsks: floor kept when the model adds nothing / refuses / throws ──────────────────────
test('summarizeAsks keeps the floor when the model returns blank', async () => {
  const floor = extractiveMinutes(ASKS, { title: 'X' });
  const out = await summarizeAsks(ASKS, { title: 'X', complete: () => '' });
  assert.equal(out, floor);
});

test('summarizeAsks keeps the floor when the model refuses', async () => {
  const floor = extractiveMinutes(ASKS, { title: 'X' });
  const out = await summarizeAsks(ASKS, { title: 'X', complete: () => 'I am sorry, I cannot help with that.' });
  assert.equal(out, floor);
});

test('summarizeAsks keeps the floor when the model returns a tiny stub', async () => {
  const floor = extractiveMinutes(ASKS, { title: 'X' });
  const out = await summarizeAsks(ASKS, { title: 'X', complete: () => '# ok' });
  assert.equal(out, floor, 'a stub shorter than 60% of the floor is rejected');
});

test('summarizeAsks keeps the floor when the model echoes the prompt scaffolding', async () => {
  const floor = extractiveMinutes(ASKS, { title: 'X' });
  const echo = `# minutes\n--- DRAFT MINUTES ---\n${floor}\n--- END DRAFT ---`;
  const out = await summarizeAsks(ASKS, { title: 'X', complete: () => echo });
  assert.equal(out, floor);
});

test('summarizeAsks keeps the floor when the model THROWS', async () => {
  const floor = extractiveMinutes(ASKS, { title: 'X' });
  const out = await summarizeAsks(ASKS, { title: 'X', complete: () => { throw new Error('model down'); } });
  assert.equal(out, floor);
});

// ── default ollama path: soft-fails offline via injected fetch ───────────────────────────────────
test('default polish path soft-fails to the floor when ollama fetch rejects (offline)', async () => {
  __setComplete(null);                       // use the default ollama caller
  __setFetch(async () => { throw new Error('ECONNREFUSED'); }); // no ollama running
  const floor = extractiveMinutes(ASKS, { title: 'X' });
  const out = await summarizeAsks(ASKS, { title: 'X' });        // no complete in opts → default path
  assert.equal(out, floor, 'unreachable ollama → deterministic floor stands');
  __setFetch(null);
});

test('default polish path uses the module-injected complete when set', async () => {
  __setComplete(() => `# Injected\n\n${extractiveMinutes(ASKS)}\n\npadding to pass the length gate here.`);
  const out = await summarizeAsks(ASKS);     // no complete in opts → module injection used
  assert.match(out, /# Injected/);
  __setComplete(null);
});

test('default polish path: a real ollama-shaped response is accepted', async () => {
  __setComplete(null);
  const body = `# From ollama\n\n${extractiveMinutes(ASKS)}\n\npadding line to clear the gate.`;
  __setFetch(async () => ({ ok: true, json: async () => ({ response: body }) }));
  const out = await summarizeAsks(ASKS);
  assert.match(out, /# From ollama/);
  __setFetch(null);
});

// ── empty input never calls the model ────────────────────────────────────────────────────────────
test('summarizeAsks on empty input returns the no-asks floor without calling the model', async () => {
  let called = false;
  const out = await summarizeAsks([], { complete: () => { called = true; return '# x'.repeat(50); } });
  assert.equal(called, false, 'model not invoked on empty input');
  assert.match(out, /_No asks were raised this session\._/);
});
