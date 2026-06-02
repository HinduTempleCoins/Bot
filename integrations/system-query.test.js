// system-query.test.js — proves the intent router classifies questions correctly and the exported
// helpers (commands / briefLine / ask) behave. Routing is PURE (routeIntent), so no network is needed
// for the classification matrix. The one ask() smoke test uses --no-llm + an empty-question path that
// also avoids the network.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const { routeIntent, commands, ask } = await import('./system-query.mjs');

test('intent router classifies the canonical questions', () => {
  const cases = [
    ['what are my best holdings opportunities?', 'holdings'],
    ['what do I hold', 'holdings'],
    ['any rotation opportunities?', 'holdings'],
    ['top hive-engine markets by volume', 'markets'],
    ['most traded tokens on tribaldex', 'markets'],
    ['price of HIVE', 'price'],
    ['how much is bitcoin worth', 'price'],
    ['gold and silver price', 'macro'],
    ['how is the dow and vix doing?', 'macro'],
    ['wheat price', 'macro'],
    ['eur/usd rate', 'forex'],
    ['where can americans trade ADA?', 'exchanges'],
    ['us exchanges for crypto', 'exchanges'],
    ["what's the state of the markets?", 'brief'],
    ['', 'empty'],
    ['tell me a story about angels', 'open'],
  ];
  for (const [q, want] of cases) {
    assert.equal(routeIntent(q), want, `"${q}" should route to ${want}`);
  }
});

test('commands() returns example-per-intent objects', () => {
  const cmds = commands();
  assert.ok(Array.isArray(cmds) && cmds.length >= 6);
  for (const c of cmds) {
    assert.equal(typeof c.intent, 'string');
    assert.equal(typeof c.example, 'string');
    // every advertised example must actually route to (at least near) its declared intent
    assert.equal(routeIntent(c.example), c.intent, `example "${c.example}" must route to ${c.intent}`);
  }
});

test('ask() never throws and always returns the shape', async () => {
  const res = await ask('', { llm: false });
  assert.equal(typeof res.answer, 'string');
  assert.ok('data' in res);
  assert.equal(res.intent, 'empty');
});
