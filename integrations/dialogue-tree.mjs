// dialogue-tree.mjs — PURE, deterministic, NO-LLM dialogue-tree walker. Backlog b2c9f013ad.
// No network, no chain calls, no keys, no I/O, no LLM.
//
// PURPOSE:
//   The Crypt-ology 'Not-a-Game' button dialogues are 50+ hand-authored trees. Each tree is plain
//   JSON the operator can write/version without code changes. This module is the deterministic
//   walker for those trees: validate, start, walk by choice id, render the current node as safe
//   HTML. It carries NO semantics for effects — it only collects choice.effects into a flat object
//   for the caller (karma/, cryptology/, etc.) to interpret. Pure data-in / data-out.
//
// TREE SHAPE (plain JSON):
//   {
//     id: 'tree-id',
//     start: 'nodeId',
//     nodes: {
//       nodeId: {
//         text: 'shown to the user',
//         choices: [ { id, label, next, effects? }, ... ]   // omit/empty choices => terminal node
//       },
//       ...
//     }
//   }
//
// STATE SHAPE (immutable; choose() returns a NEW state, never mutates):
//   { treeId, nodeId, history: [ { nodeId, choiceId } , ... ] }
//
// SOFT-FAIL, NEVER THROW: bad tree / bad state / unknown choice id => the functions return a
//   well-formed value (often the unchanged state) plus an { error } string. No exceptions escape.
//
//   import { validateTree, start, choose, currentNode, isTerminal, applyEffects, renderNode }
//     from './integrations/dialogue-tree.mjs';
//
// CLI:  node integrations/dialogue-tree.mjs <tree.json> <choiceId,choiceId,...>
//         # walks the tree along the comma list and prints each step + the final effects.

// ── HTML escape: used by renderNode for any interpolated value ──────────────────────────────────
export function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── helpers ─────────────────────────────────────────────────────────────────────────────────────
function isObj(x) {
  return x != null && typeof x === 'object' && !Array.isArray(x);
}

function nodesOf(tree) {
  return isObj(tree) && isObj(tree.nodes) ? tree.nodes : {};
}

function nodeChoices(node) {
  return isObj(node) && Array.isArray(node.choices) ? node.choices : [];
}

// ── validateTree(tree) -> { ok, errors } ────────────────────────────────────────────────────────
// Structural validation, no throw. Checks: tree is an object; has a string `start`; `nodes` is an
// object; `start` resolves to a node; every choice has a string id and its `next` resolves to a
// node. (Orphan-only-loop detection is intentionally out of scope per spec.)
export function validateTree(tree) {
  const errors = [];
  if (!isObj(tree)) return { ok: false, errors: ['tree is not an object'] };

  const nodes = nodesOf(tree);
  const nodeIds = Object.keys(nodes);
  if (!isObj(tree.nodes)) errors.push('tree.nodes is missing or not an object');
  if (nodeIds.length === 0) errors.push('tree has no nodes');

  if (typeof tree.start !== 'string' || tree.start === '') {
    errors.push('tree.start is missing or not a non-empty string');
  } else if (!Object.prototype.hasOwnProperty.call(nodes, tree.start)) {
    errors.push(`start node "${tree.start}" does not resolve to a node`);
  }

  const seenChoiceIds = new Set();
  for (const nid of nodeIds) {
    const node = nodes[nid];
    if (!isObj(node)) {
      errors.push(`node "${nid}" is not an object`);
      continue;
    }
    if (node.text != null && typeof node.text !== 'string') {
      errors.push(`node "${nid}" has non-string text`);
    }
    if (node.choices != null && !Array.isArray(node.choices)) {
      errors.push(`node "${nid}" has non-array choices`);
    }
    for (const [i, ch] of nodeChoices(node).entries()) {
      if (!isObj(ch)) {
        errors.push(`node "${nid}" choice[${i}] is not an object`);
        continue;
      }
      if (typeof ch.id !== 'string' || ch.id === '') {
        errors.push(`node "${nid}" choice[${i}] has missing/empty id`);
      } else {
        const key = `${nid}::${ch.id}`;
        if (seenChoiceIds.has(key)) errors.push(`node "${nid}" has duplicate choice id "${ch.id}"`);
        seenChoiceIds.add(key);
      }
      if (typeof ch.next !== 'string' || ch.next === '') {
        errors.push(`node "${nid}" choice "${ch.id ?? i}" has missing/empty next`);
      } else if (!Object.prototype.hasOwnProperty.call(nodes, ch.next)) {
        errors.push(`node "${nid}" choice "${ch.id ?? i}" next "${ch.next}" is dangling`);
      }
      if (ch.effects != null && !isObj(ch.effects)) {
        errors.push(`node "${nid}" choice "${ch.id ?? i}" effects is not an object`);
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

// ── start(tree) -> state ─────────────────────────────────────────────────────────────────────────
// Begins a walk at tree.start. Soft-fail: if the tree is unusable the returned state still has the
// shape { treeId, nodeId, history } with an attached { error } and nodeId === null.
export function start(tree) {
  const treeId = isObj(tree) && typeof tree.id === 'string' ? tree.id : null;
  const startId = isObj(tree) && typeof tree.start === 'string' ? tree.start : null;
  const nodes = nodesOf(tree);
  if (startId == null || !Object.prototype.hasOwnProperty.call(nodes, startId)) {
    return { treeId, nodeId: null, history: [], error: 'tree has no resolvable start node' };
  }
  return { treeId, nodeId: startId, history: [] };
}

// ── currentNode(tree, state) -> { text, choices } ────────────────────────────────────────────────
// Returns the node the state points at, normalized. Soft-fail: unknown/empty node => safe empty.
export function currentNode(tree, state) {
  const nodes = nodesOf(tree);
  const nid = isObj(state) ? state.nodeId : null;
  const node = nid != null && Object.prototype.hasOwnProperty.call(nodes, nid) ? nodes[nid] : null;
  if (!isObj(node)) return { text: '', choices: [] };
  return {
    text: typeof node.text === 'string' ? node.text : '',
    choices: nodeChoices(node).map((c) => ({
      id: c.id,
      label: typeof c.label === 'string' ? c.label : c.id,
      next: c.next,
      ...(isObj(c.effects) ? { effects: c.effects } : {}),
    })),
  };
}

// ── isTerminal(tree, state) -> bool ──────────────────────────────────────────────────────────────
// A node is terminal when it has no choices (or is unresolvable).
export function isTerminal(tree, state) {
  return currentNode(tree, state).choices.length === 0;
}

// ── choose(tree, state, choiceId) -> new state ──────────────────────────────────────────────────
// Immutable advance. Pushes { nodeId, choiceId } onto history and moves to choice.next.
// Soft-fail: an invalid choiceId (or unresolvable next) returns the UNCHANGED state plus { error }.
export function choose(tree, state, choiceId) {
  if (!isObj(state)) return { treeId: null, nodeId: null, history: [], error: 'state is not an object' };
  const safe = {
    treeId: state.treeId ?? null,
    nodeId: state.nodeId ?? null,
    history: Array.isArray(state.history) ? state.history.slice() : [],
  };

  const nodes = nodesOf(tree);
  const node = safe.nodeId != null && Object.prototype.hasOwnProperty.call(nodes, safe.nodeId)
    ? nodes[safe.nodeId]
    : null;
  if (!isObj(node)) return { ...safe, error: `current node "${safe.nodeId}" is unresolvable` };

  const choice = nodeChoices(node).find((c) => isObj(c) && c.id === choiceId);
  if (!choice) return { ...safe, error: `choice "${choiceId}" not available at node "${safe.nodeId}"` };

  if (typeof choice.next !== 'string' || !Object.prototype.hasOwnProperty.call(nodes, choice.next)) {
    return { ...safe, error: `choice "${choiceId}" next "${choice.next}" is dangling` };
  }

  return {
    treeId: safe.treeId,
    nodeId: choice.next,
    history: [...safe.history, { nodeId: safe.nodeId, choiceId }],
  };
}

// ── applyEffects(tree, state) -> flat effects object ─────────────────────────────────────────────
// Replays the state's history and shallow-merges every traversed choice.effects into one flat
// object (later choices override earlier keys). Does NOT interpret effects — that is the caller's
// job. Soft-fail: missing/odd history yields {}.
export function applyEffects(tree, state) {
  const out = {};
  if (!isObj(state) || !Array.isArray(state.history)) return out;
  const nodes = nodesOf(tree);
  for (const step of state.history) {
    if (!isObj(step)) continue;
    const node = Object.prototype.hasOwnProperty.call(nodes, step.nodeId) ? nodes[step.nodeId] : null;
    if (!isObj(node)) continue;
    const choice = nodeChoices(node).find((c) => isObj(c) && c.id === step.choiceId);
    if (choice && isObj(choice.effects)) Object.assign(out, choice.effects);
  }
  return out;
}

// ── renderNode(tree, state) -> safe HTML string ──────────────────────────────────────────────────
// Render helper: all text/labels esc()'d. Choices become buttons carrying data-choice.
export function renderNode(tree, state) {
  const { text, choices } = currentNode(tree, state);
  const body = `<p class="dialogue-text">${esc(text)}</p>`;
  if (choices.length === 0) return `<div class="dialogue-node dialogue-terminal">${body}</div>`;
  const buttons = choices
    .map((c) => `<button class="dialogue-choice" data-choice="${esc(c.id)}">${esc(c.label)}</button>`)
    .join('');
  return `<div class="dialogue-node">${body}<div class="dialogue-choices">${buttons}</div></div>`;
}

// ── CLI demo (guarded; stdout only) ─────────────────────────────────────────────────────────────
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const run = async () => {
    const [treePath, choiceList] = process.argv.slice(2);
    if (!treePath) {
      console.log('usage: node integrations/dialogue-tree.mjs <tree.json> <choiceId,choiceId,...>');
      return;
    }
    let tree;
    try {
      const { readFile } = await import('node:fs/promises');
      tree = JSON.parse(await readFile(treePath, 'utf8'));
    } catch (e) {
      console.log(`could not read/parse tree: ${e && e.message ? e.message : e}`);
      return;
    }
    const v = validateTree(tree);
    console.log(`validateTree: ok=${v.ok}${v.ok ? '' : ' errors=' + JSON.stringify(v.errors)}`);

    let state = start(tree);
    const ids = (choiceList || '').split(',').map((s) => s.trim()).filter(Boolean);
    console.log(`[start] node=${state.nodeId} :: ${currentNode(tree, state).text}`);
    for (const id of ids) {
      const next = choose(tree, state, id);
      if (next.error) {
        console.log(`[choose ${id}] soft-fail: ${next.error}`);
        continue;
      }
      state = next;
      console.log(`[choose ${id}] -> node=${state.nodeId} :: ${currentNode(tree, state).text}`);
    }
    console.log(`terminal=${isTerminal(tree, state)} effects=${JSON.stringify(applyEffects(tree, state))}`);
  };
  run();
}
