import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as G from './brain-head-grammar.mjs';
import * as E from './brain-head-emoji.mjs';

test('grammar head: injected net classifies, normalizes CoLA labels', async () => {
  G.__setPipelineFactory(async () => async (txt) => [{ label: /go to store/.test(txt) ? 'LABEL_0' : 'LABEL_1', score: 0.91 }]);
  const g = G.createGrammarHead();
  const ok = await g.grammaticality('she walks to the store');
  assert.equal(ok.backend, 'net'); assert.equal(ok.label, 'acceptable'); assert.ok(ok.score > 0.9);
  const bad = await g.grammaticality('he go to store');
  assert.equal(bad.label, 'unacceptable');
  G.__setPipelineFactory(null);
});

test('grammar head: soft-falls to heuristic when the net cannot load', async () => {
  G.__setPipelineFactory(async () => null); // loader yields no pipe
  const g = G.createGrammarHead();
  const r = await g.grammaticality('the the cat sat');
  assert.equal(r.backend, 'heuristic');
  assert.ok(r.score < 1);
  G.__setPipelineFactory(null);
});

test('grammar heuristic flags agreement + fragments without any model', () => {
  assert.equal(G.heuristicGrammar('he go to the market').label, 'unacceptable');
  assert.equal(G.heuristicGrammar('she walks home every morning').label, 'acceptable');
  assert.equal(G.heuristicGrammar('').label, 'unacceptable');
});

test('emoji head: injected net returns ranked emoji', async () => {
  E.__setPipelineFactory(async () => async () => [{ label: '🙏', score: 0.8 }, { label: '😇', score: 0.6 }]);
  const e = E.createEmojiHead();
  const out = await e.suggestEmoji('thank you, truly blessed', 2);
  assert.equal(out[0].emoji, '🙏'); assert.equal(out[0].backend, 'net');
  assert.equal((await e.topEmoji('x')).emoji, '🙏');
  E.__setPipelineFactory(null);
});

test('emoji head: soft-falls to keyword floor offline', async () => {
  E.__setPipelineFactory(async () => null);
  const e = E.createEmojiHead();
  const out = await e.suggestEmoji('I am so grateful and blessed');
  assert.ok(out.length >= 1);
  assert.ok(out.some((o) => o.emoji === '🙏' || o.emoji === '😇'));
  assert.equal(out[0].backend, 'heuristic');
  E.__setPipelineFactory(null);
});

test('emoji heuristic maps money/news/law without a model', () => {
  assert.equal(E.heuristicEmoji('show me the revenue and profit')[0].emoji, '💰');
  assert.ok(E.heuristicEmoji('a press release and news').some((h) => h.emoji === '📰'));
});
