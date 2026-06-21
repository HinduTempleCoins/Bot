// minecraft-bridge.test.mjs — OFFLINE. A fake Pentecaust channel + stub AI brain. The bridge is the
// general MELEK PM/DM system under test against its first consumer (the Minecraft AI). Never throws.
import { test } from 'node:test';
import assert from 'node:assert';
import { createBridge, pump } from './minecraft-bridge.mjs';

// a tiny in-memory Pentecaust thread shared by the AI and humans
function fakeChannel(seed = []) {
  let seq = 0; const msgs = [];
  const push = (from, text, extra = {}) => { msgs.push({ seq: ++seq, from, text, ...extra }); };
  for (const [f, t] of seed) push(f, t);
  return {
    msgs, push,
    client: {
      read: async ({ since }) => ({ messages: msgs.filter((m) => m.seq > (since || 0)), cursor: seq }),
      send: async (text) => push('hathor', text),
    },
  };
}
const echoBrain = async ({ text }) => `you said: ${text}`;

test('answers a human line and posts the reply back into the thread (as the AI)', async () => {
  const ch = fakeChannel([['ryan', 'hello there']]);
  const bridge = createBridge({ chat: ch.client, brain: echoBrain, options: { aiName: 'hathor' } });
  const r = await pump(bridge);
  assert.equal(r.read, 1);
  assert.equal(r.answered, 1);
  assert.equal(ch.msgs.at(-1).from, 'hathor');
  assert.equal(ch.msgs.at(-1).text, 'you said: hello there');
});

test('loop guard: never replies to its own (AI) messages', async () => {
  const ch = fakeChannel([['hathor', 'I am the AI talking']]);
  const bridge = createBridge({ chat: ch.client, brain: echoBrain, options: { aiName: 'hathor' } });
  const r = await pump(bridge);
  assert.equal(r.answered, 0);
  assert.equal(ch.msgs.length, 1);            // nothing added — no echo storm
});

test('cursor advances: a second pump answers nothing new (no double-replies)', async () => {
  const ch = fakeChannel([['ryan', 'first']]);
  const bridge = createBridge({ chat: ch.client, brain: echoBrain, options: { aiName: 'hathor' } });
  await pump(bridge);
  const r2 = await pump(bridge);
  assert.equal(r2.answered, 0);               // the invariant: no double-replies (it may re-read its own posted line, but won't answer it)
  // a new human line IS picked up on the next pump
  ch.push('ryan', 'second');
  const r3 = await pump(bridge);
  assert.equal(r3.answered, 1);
  assert.equal(ch.msgs.at(-1).text, 'you said: second');
});

test('respondTo allow-list: answers only listed accounts', async () => {
  const ch = fakeChannel([['stranger', 'hi'], ['ryan', 'hi']]);
  const bridge = createBridge({ chat: ch.client, brain: echoBrain, options: { aiName: 'hathor', respondTo: ['ryan'] } });
  const r = await pump(bridge);
  assert.equal(r.answered, 1);
  assert.deepEqual(r.replies.map((x) => x.to), ['ryan']);   // stranger ignored
});

test('blank/whitespace lines are skipped', async () => {
  const ch = fakeChannel([['ryan', '   ']]);
  const bridge = createBridge({ chat: ch.client, brain: echoBrain, options: { aiName: 'hathor' } });
  assert.equal((await pump(bridge)).answered, 0);
});

test('a silent brain (null reply) posts nothing but still advances', async () => {
  const ch = fakeChannel([['ryan', 'mumble']]);
  const bridge = createBridge({ chat: ch.client, brain: async () => null, options: { aiName: 'hathor' } });
  const r = await pump(bridge);
  assert.equal(r.answered, 0);
  assert.equal(ch.msgs.length, 1);
  assert.ok(bridge.cursor >= 1);              // cursor still moved so we don't re-see it
});

test('soft-fail: a throwing brain skips that line, never crashes the pump', async () => {
  const ch = fakeChannel([['ryan', 'boom'], ['ryan', 'ok']]);
  let calls = 0;
  const brain = async ({ text }) => { calls++; if (text === 'boom') throw new Error('AI exploded'); return 'fine'; };
  const bridge = createBridge({ chat: ch.client, brain, options: { aiName: 'hathor' } });
  const r = await pump(bridge);                // must not throw
  assert.equal(calls, 2);
  assert.equal(r.answered, 1);                 // only the non-throwing line answered
  assert.equal(ch.msgs.at(-1).text, 'fine');
});

test('maxPerPump caps replies per cycle', async () => {
  const ch = fakeChannel([['ryan', 'a'], ['ryan', 'b'], ['ryan', 'c']]);
  const bridge = createBridge({ chat: ch.client, brain: echoBrain, options: { aiName: 'hathor', maxPerPump: 2 } });
  const r = await pump(bridge);
  assert.equal(r.answered, 2);                 // capped
  assert.equal((await pump(bridge)).answered, 1); // the rest next cycle
});

test('passes the game/surface tag through to the brain (cross-surface context)', async () => {
  const ch = fakeChannel(); ch.push('ryan', 'where are you?', { game: 'minecraft', surface: 'game' });
  let seen = null;
  const bridge = createBridge({ chat: ch.client, brain: async (ctx) => { seen = ctx; return 'here'; }, options: { aiName: 'hathor' } });
  await pump(bridge);
  assert.equal(seen.game, 'minecraft');
  assert.equal(seen.surface, 'game');
});

test('createBridge validates its injected deps', () => {
  assert.throws(() => createBridge({ chat: {}, brain: () => {} }), /read\(\) and send\(\)/);
  assert.throws(() => createBridge({ chat: { read() {}, send() {} } }), /brain/);
});
