// moderation-adapter.test.mjs — OFFLINE proof of the pluggable moderation interface (task #286).
// Covers: lexicon soft-fallback when DETOXIFY_URL is unset; the hosted Detoxify path via an INJECTED
// fetch; soft-fail back to the lexicon when the hosted call errors; and the always-returns-a-score
// contract. No real network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { moderate, lexiconModerate, __setFetch } from './moderation-adapter.mjs';

const SHAPE = ['toxicity', 'severe', 'insult', 'threat'];
function assertShape(r) {
  for (const k of SHAPE) assert.ok(typeof r[k] === 'number' && r[k] >= 0 && r[k] <= 1, `${k}=${r[k]}`);
  assert.ok(typeof r.label === 'string');
  assert.ok(r.source === 'detoxify' || r.source === 'lexicon');
}

// ── lexicon fallback (DETOXIFY_URL unset) ───────────────────────────────────────────────────────────
test('soft-falls to the lexicon when DETOXIFY_URL is unset, always returns a score', async () => {
  delete process.env.DETOXIFY_URL;
  __setFetch(null);
  const clean = await moderate('thanks so much, this is a lovely afternoon');
  assertShape(clean);
  assert.equal(clean.source, 'lexicon');
  assert.equal(clean.label, 'ok');
  assert.ok(clean.toxicity < 0.5);

  const insult = await moderate('you are an idiot and totally useless');
  assertShape(insult);
  assert.equal(insult.source, 'lexicon');
  assert.ok(insult.insult > 0, `insult=${insult.insult}`);
  assert.ok(insult.toxicity >= 0.5);
});

test('lexiconModerate flags threats high and is pure/deterministic', () => {
  const a = lexiconModerate('I will find you and I will hurt you');
  const b = lexiconModerate('I will find you and I will hurt you');
  assert.deepEqual(a, b);
  assert.ok(a.threat >= 0.5, `threat=${a.threat}`);
  assert.ok(a.toxicity >= 0.5);
  assert.ok(['threat', 'severe'].includes(a.label));
});

test('empty text → zeroed score, no throw', async () => {
  delete process.env.DETOXIFY_URL;
  const r = await moderate('');
  assert.deepEqual({ toxicity: r.toxicity, severe: r.severe, insult: r.insult, threat: r.threat }, { toxicity: 0, severe: 0, insult: 0, threat: 0 });
  assert.equal(r.label, 'ok');
});

// ── hosted Detoxify path (injected fetch) ───────────────────────────────────────────────────────────
test('uses the hosted Detoxify endpoint when DETOXIFY_URL is set (injected fetch)', async () => {
  process.env.DETOXIFY_URL = 'http://detoxify.local/predict';
  let seenUrl = null, seenBody = null;
  __setFetch(async (url, opts) => {
    seenUrl = url; seenBody = JSON.parse(opts.body);
    return {
      ok: true,
      json: async () => ({ toxicity: 0.92, severe_toxicity: 0.1, insult: 0.81, threat: 0.05, obscene: 0.4 }),
    };
  });
  const r = await moderate('some flagged text');
  __setFetch(null);
  delete process.env.DETOXIFY_URL;

  assertShape(r);
  assert.equal(r.source, 'detoxify');
  assert.equal(r.toxicity, 0.92);
  assert.equal(r.insult, 0.81);
  assert.equal(r.label, 'insult');          // insult >= 0.5 outranks the generic toxic label
  assert.equal(seenUrl, 'http://detoxify.local/predict');
  assert.equal(seenBody.text, 'some flagged text');
});

test('hosted path maps severe_toxicity → severe label', async () => {
  process.env.DETOXIFY_URL = 'http://detoxify.local/predict';
  __setFetch(async () => ({ ok: true, json: async () => ({ toxicity: 0.95, severe_toxicity: 0.88, insult: 0.3, threat: 0.2 }) }));
  const r = await moderate('x');
  __setFetch(null);
  delete process.env.DETOXIFY_URL;
  assert.equal(r.label, 'severe');
  assert.equal(r.severe, 0.88);
});

test('per-call fetchImpl override is honored', async () => {
  process.env.DETOXIFY_URL = 'http://detoxify.local/predict';
  let called = false;
  const r = await moderate('hello', {
    fetchImpl: async () => { called = true; return { ok: true, json: async () => ({ toxicity: 0.1, insult: 0, threat: 0, severe_toxicity: 0 }) }; },
  });
  delete process.env.DETOXIFY_URL;
  assert.ok(called, 'used the injected per-call fetch');
  assert.equal(r.source, 'detoxify');
  assert.equal(r.label, 'ok');
});

// ── soft-fail of the hosted path → lexicon ──────────────────────────────────────────────────────────
test('soft-fails to the lexicon when the hosted call throws', async () => {
  process.env.DETOXIFY_URL = 'http://detoxify.local/predict';
  __setFetch(async () => { throw new Error('connection refused'); });
  const r = await moderate('you are an idiot');
  __setFetch(null);
  delete process.env.DETOXIFY_URL;
  assert.equal(r.source, 'lexicon', 'fell back to lexicon on network error');
  assert.ok(r.insult > 0);
});

test('soft-fails to the lexicon on non-ok / unrecognizable response', async () => {
  process.env.DETOXIFY_URL = 'http://detoxify.local/predict';
  __setFetch(async () => ({ ok: false, json: async () => ({}) }));
  let r = await moderate('garbage in');
  assert.equal(r.source, 'lexicon', 'non-ok → lexicon');

  __setFetch(async () => ({ ok: true, json: async () => ({ unrelated: 'shape' }) }));
  r = await moderate('garbage in');
  assert.equal(r.source, 'lexicon', 'unrecognizable body → lexicon');

  __setFetch(null);
  delete process.env.DETOXIFY_URL;
});
