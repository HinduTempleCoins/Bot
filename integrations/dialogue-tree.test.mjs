// dialogue-tree.test.mjs — offline node:test suite for the dialogue-tree walker. Backlog b2c9f013ad.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  esc,
  validateTree,
  start,
  choose,
  currentNode,
  isTerminal,
  applyEffects,
  renderNode,
} from './dialogue-tree.mjs';

// A small, valid 'Not-a-Game' tree: gate -> (left|right) -> end.
function sampleTree() {
  return {
    id: 'gate-tree',
    start: 'gate',
    nodes: {
      gate: {
        text: 'A door. Which way?',
        choices: [
          { id: 'go-left', label: 'Left', next: 'left', effects: { karma: 1, path: 'left' } },
          { id: 'go-right', label: 'Right', next: 'right', effects: { karma: -1 } },
        ],
      },
      left: {
        text: 'A lit hall.',
        choices: [{ id: 'finish', label: 'Step through', next: 'end', effects: { path: 'left-final', blessed: true } }],
      },
      right: { text: 'A dark hall.', choices: [{ id: 'finish', label: 'Step through', next: 'end' }] },
      end: { text: 'You arrive.' }, // terminal: no choices
    },
  };
}

test('validateTree accepts a well-formed tree', () => {
  const r = validateTree(sampleTree());
  assert.equal(r.ok, true);
  assert.deepEqual(r.errors, []);
});

test('valid traversal: start -> choose -> currentNode tracks position and history', () => {
  const tree = sampleTree();
  let state = start(tree);
  assert.equal(state.treeId, 'gate-tree');
  assert.equal(state.nodeId, 'gate');
  assert.deepEqual(state.history, []);
  assert.equal(currentNode(tree, state).text, 'A door. Which way?');
  assert.equal(currentNode(tree, state).choices.length, 2);

  const next = choose(tree, state, 'go-left');
  assert.equal(next.error, undefined);
  assert.equal(next.nodeId, 'left');
  assert.deepEqual(next.history, [{ nodeId: 'gate', choiceId: 'go-left' }]);
  // immutability: original state untouched
  assert.equal(state.nodeId, 'gate');
  assert.deepEqual(state.history, []);

  state = choose(tree, next, 'finish');
  assert.equal(state.nodeId, 'end');
  assert.equal(state.history.length, 2);
});

test('terminal detection', () => {
  const tree = sampleTree();
  let state = start(tree);
  assert.equal(isTerminal(tree, state), false);
  state = choose(tree, state, 'go-right');
  assert.equal(isTerminal(tree, state), false);
  state = choose(tree, state, 'finish');
  assert.equal(isTerminal(tree, state), true);
});

test('invalid choice soft-fails: unchanged state + error', () => {
  const tree = sampleTree();
  const state = start(tree);
  const r = choose(tree, state, 'no-such-choice');
  assert.ok(r.error);
  assert.equal(r.nodeId, 'gate'); // unchanged
  assert.deepEqual(r.history, []); // unchanged
});

test('validateTree catches a dangling next', () => {
  const bad = sampleTree();
  bad.nodes.gate.choices[0].next = 'nowhere';
  const r = validateTree(bad);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('dangling')));
});

test('validateTree catches a missing/unresolvable start', () => {
  const bad = sampleTree();
  bad.start = 'ghost';
  const r = validateTree(bad);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('start')));
});

test('applyEffects flattens traversed effects, later overrides earlier', () => {
  const tree = sampleTree();
  let state = start(tree);
  state = choose(tree, state, 'go-left'); // {karma:1, path:'left'}
  state = choose(tree, state, 'finish'); // {path:'left-final', blessed:true}
  const eff = applyEffects(tree, state);
  assert.deepEqual(eff, { karma: 1, path: 'left-final', blessed: true });
});

test('applyEffects on a fresh / empty-history state is {}', () => {
  const tree = sampleTree();
  assert.deepEqual(applyEffects(tree, start(tree)), {});
});

test('renderNode escapes text and labels, emits buttons', () => {
  const tree = {
    id: 't',
    start: 'a',
    nodes: {
      a: { text: '<b>hi</b> & "x"', choices: [{ id: 'c1', label: '<go>', next: 'b' }] },
      b: { text: 'done' },
    },
  };
  const html = renderNode(tree, start(tree));
  assert.ok(html.includes('&lt;b&gt;hi&lt;/b&gt; &amp; &quot;x&quot;'));
  assert.ok(html.includes('data-choice="c1"'));
  assert.ok(html.includes('&lt;go&gt;'));
  assert.ok(!html.includes('<b>hi</b>'));
});

test('renderNode marks terminal node', () => {
  const tree = sampleTree();
  let state = start(tree);
  state = choose(tree, state, 'go-left');
  state = choose(tree, state, 'finish');
  assert.ok(renderNode(tree, state).includes('dialogue-terminal'));
});

test('soft-fail: non-object tree / state never throw', () => {
  assert.equal(validateTree(null).ok, false);
  assert.equal(validateTree(42).ok, false);
  const s = start(null);
  assert.equal(s.nodeId, null);
  assert.ok(s.error);
  assert.deepEqual(currentNode(null, s), { text: '', choices: [] });
  assert.equal(isTerminal(null, s), true);
  const r = choose(null, undefined, 'x');
  assert.ok(r.error);
  assert.deepEqual(applyEffects(undefined, undefined), {});
});

test('choose with a dangling next soft-fails without advancing', () => {
  const tree = {
    id: 't',
    start: 'a',
    nodes: { a: { text: 'x', choices: [{ id: 'go', label: 'g', next: 'gone' }] } },
  };
  const state = start(tree);
  const r = choose(tree, state, 'go');
  assert.ok(r.error);
  assert.equal(r.nodeId, 'a');
});

test('esc handles null/undefined', () => {
  assert.equal(esc(null), '');
  assert.equal(esc(undefined), '');
  assert.equal(esc('<&>'), '&lt;&amp;&gt;');
});
