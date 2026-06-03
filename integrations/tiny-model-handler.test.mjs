// tiny-model-handler.test.mjs — OFFLINE unit tests for the tiny/small local-model selection tier.
// No real inference: the runtime is always a stub, and selection is pure.
import { test } from 'node:test';
import assert from 'node:assert';
import { MODELS, pickModel, run } from './tiny-model-handler.mjs';

// ── pickModel: routing ──────────────────────────────────────────────────────────────────────────
test('pickModel routes bounded classify/route/anomaly to an ultra-tiny model', () => {
  for (const t of ['classify', 'route', 'routing', 'anomaly', 'detect']) {
    const id = pickModel(t);
    assert.ok(MODELS[id], `${t} → known model`);
    assert.equal(MODELS[id].tier, 'ultra-tiny', `${t} should go ultra-tiny`);
  }
});

test('pickModel routes generative/parsing tasks to the 3B general model', () => {
  for (const t of ['generate', 'parse', 'language', 'summarize', 'reason']) {
    const id = pickModel(t);
    assert.ok(MODELS[id], `${t} → known model`);
    assert.equal(MODELS[id].tier, 'general', `${t} should go general`);
    assert.equal(MODELS[id].params, '3B');
  }
});

test('pickModel respects the 1-3B floor: classify→ultra-tiny, generate→3B', () => {
  assert.equal(MODELS[pickModel('classify')].tier, 'ultra-tiny');
  assert.equal(MODELS[pickModel('generate')].tier, 'general');
});

test('pickModel is case/whitespace-insensitive and defaults unknown/empty to general', () => {
  assert.equal(MODELS[pickModel('  CLASSIFY ')].tier, 'ultra-tiny');
  assert.equal(MODELS[pickModel('something-weird')].tier, 'general');
  assert.equal(MODELS[pickModel('')].tier, 'general');
  assert.equal(MODELS[pickModel(undefined)].tier, 'general');
  assert.equal(MODELS[pickModel(42)].tier, 'general');
});

// ── MODELS shape ─────────────────────────────────────────────────────────────────────────────────
test('MODELS catalog has the expected entries and shape', () => {
  assert.ok(MODELS['smollm3-3b'], 'has smollm3-3b general model');
  assert.ok(MODELS['qwen-0.5b'], 'has qwen-0.5b ultra-tiny');
  assert.ok(MODELS.mobilellm, 'has mobilellm ultra-tiny');

  for (const [key, m] of Object.entries(MODELS)) {
    assert.equal(m.id, key, `${key} id matches key`);
    assert.ok(['general', 'ultra-tiny'].includes(m.tier), `${key} tier valid`);
    assert.equal(typeof m.params, 'string', `${key} params is string`);
    assert.equal(typeof m.ramGB, 'number', `${key} ramGB is number`);
    assert.ok(Array.isArray(m.useCases) && m.useCases.length > 0, `${key} has use-cases`);
    assert.equal(typeof m.note, 'string', `${key} has a note`);
  }
});

test('the general model is 3B and ultra-tiny models are sub-1B', () => {
  assert.equal(MODELS['smollm3-3b'].tier, 'general');
  assert.ok(MODELS['qwen-0.5b'].ramGB < 1);
  assert.ok(MODELS.mobilellm.ramGB < 1);
});

// ── run: dispatch + soft-fail ────────────────────────────────────────────────────────────────────
test('run calls the injected runtime with the chosen model', async () => {
  const seen = [];
  const runtime = async (args) => {
    seen.push(args);
    return 'spam';
  };
  const r = await run({ task: 'classify', prompt: 'buy now!!!' }, { runtime });
  assert.equal(r.ok, true);
  assert.equal(r.model, 'qwen-0.5b');
  assert.equal(r.output, 'spam');
  assert.equal(seen.length, 1);
  assert.equal(seen[0].model, 'qwen-0.5b');
  assert.equal(seen[0].task, 'classify');
  assert.equal(seen[0].prompt, 'buy now!!!');
});

test('run uses the 3B model for generative tasks', async () => {
  const runtime = async ({ model }) => model;
  const r = await run({ task: 'generate', prompt: 'hi' }, { runtime });
  assert.equal(r.ok, true);
  assert.equal(r.model, 'smollm3-3b');
  assert.equal(r.output, 'smollm3-3b');
});

test('run soft-fails (no throw) when no runtime is provided', async () => {
  const r = await run({ task: 'generate', prompt: 'hi' });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'no-runtime');
  assert.equal(r.model, 'smollm3-3b');
});

test('run soft-fails when the runtime is not a function', async () => {
  const r = await run({ task: 'classify', prompt: 'x' }, { runtime: 'nope' });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'no-runtime');
  assert.equal(r.model, 'qwen-0.5b');
});

test('run catches a throwing runtime and surfaces the error', async () => {
  const runtime = async () => {
    throw new Error('endpoint down');
  };
  const r = await run({ task: 'classify', prompt: 'x' }, { runtime });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'endpoint down');
  assert.equal(r.model, 'qwen-0.5b');
});
