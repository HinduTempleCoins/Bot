// dataset-curate.test.mjs — OFFLINE unit tests for classify(), the KEEP/SKIP knowledge filter.
// Private markers are injected as the 3rd arg (default reads .local), so every test passes an explicit
// list and never touches the gitignored .local/curate-exclude.txt or the network.
//
//   node --test tools/dataset-curate.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify } from './dataset-curate.mjs';

// inject empty private markers so the test is hermetic (no .local read).
const NO_MARKERS = [];

test('KEEP: text hitting a knowledge theme is kept', () => {
  const r = classify('A study of egregore and collective consciousness.', '', NO_MARKERS);
  assert.equal(r.decision, 'KEEP');
  assert.match(r.reason, /knowledge/);
  assert.ok(r.theme >= 1);
});

test('KEEP: name field alone can satisfy a theme', () => {
  const r = classify('plain body with nothing on topic', 'the witness charter.md', NO_MARKERS);
  assert.equal(r.decision, 'KEEP');
});

test('KEEP: theme count reflects multiple matched themes', () => {
  const r = classify('The angelic witness studies ancient egypt and egregore theology.', '', NO_MARKERS);
  assert.equal(r.decision, 'KEEP');
  assert.ok(r.theme >= 2, `expected >=2 themes, got ${r.theme}`);
});

test('SKIP: private marker vetoes even with knowledge present', () => {
  const r = classify('My wife and I discuss egregore and ancient egypt at length.', '', NO_MARKERS);
  assert.equal(r.decision, 'SKIP');
  assert.equal(r.reason, 'private/personal marker');
  assert.equal(r.theme, null);
});

test('SKIP: SSN-shaped string is a hard veto', () => {
  const r = classify('reference egregore but also 123-45-6789 appears here', '', NO_MARKERS);
  assert.equal(r.decision, 'SKIP');
  assert.equal(r.reason, 'private/personal marker');
});

test('SKIP: injected operator private marker vetoes', () => {
  const markers = [/acme corp/i];
  const r = classify('egregore research conducted at Acme Corp headquarters', '', markers);
  assert.equal(r.decision, 'SKIP');
  assert.equal(r.reason, 'private/personal marker');
});

test('SKIP: deferred game content (knowledge absent)', () => {
  const r = classify('a runescape gameplay speedrun guide', '', NO_MARKERS);
  assert.equal(r.decision, 'SKIP');
  assert.equal(r.reason, 'games/deferred (later, not now)');
  assert.equal(r.theme, null);
});

test('SKIP: off-topic with no knowledge theme', () => {
  const r = classify('just a grocery list of apples and bread', '', NO_MARKERS);
  assert.equal(r.decision, 'SKIP');
  assert.equal(r.reason, 'no knowledge theme (off-topic)');
  assert.equal(r.theme, null);
});

test('edge: empty text and empty name -> SKIP off-topic, no throw', () => {
  let r;
  assert.doesNotThrow(() => { r = classify('', '', NO_MARKERS); });
  assert.equal(r.decision, 'SKIP');
  assert.equal(r.reason, 'no knowledge theme (off-topic)');
});

test('precedence: private veto beats deferred and knowledge', () => {
  const r = classify('runescape minecraft egregore, and my family tree here', '', NO_MARKERS);
  assert.equal(r.decision, 'SKIP');
  assert.equal(r.reason, 'private/personal marker');
});
