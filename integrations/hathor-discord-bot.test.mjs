// hathor-discord-bot.test.mjs — offline; no gateway, no network. Exercises the pure handleMessage seam.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleMessage, addressed, INTENTS } from './hathor-discord-bot.mjs';

const BOT = '999';
function sink() { const sent = []; return { send: async (ch, txt) => sent.push({ ch, txt }), sent }; }

test('addressed(): mention, name, or ! command — else quiet', () => {
  assert.ok(addressed('<@999> hi', BOT));
  assert.ok(addressed('hey hathor', BOT));
  assert.ok(addressed('!price', BOT));
  assert.ok(!addressed('just chatting with friends', BOT));
});

test('intents bitmask includes MESSAGE_CONTENT (1<<15)', () => {
  assert.ok((INTENTS & (1 << 15)) !== 0);
});

test('ignores bots and its own messages', async () => {
  const s = sink();
  const r1 = await handleMessage({ author: { bot: true }, content: 'hathor hi', channel_id: 'c' }, { botUserId: BOT, send: s.send });
  const r2 = await handleMessage({ author: { id: BOT }, content: 'hathor hi', channel_id: 'c' }, { botUserId: BOT, send: s.send });
  assert.equal(r1, null); assert.equal(r2, null); assert.equal(s.sent.length, 0);
});

test('stays silent when not addressed', async () => {
  const s = sink();
  const r = await handleMessage({ author: { id: '1', username: 'x' }, content: 'nice weather', channel_id: 'c' },
    { botUserId: BOT, send: s.send, ask: async () => 'should not be called' });
  assert.equal(r, null); assert.equal(s.sent.length, 0);
});

test('!command routes to the commands engine (not the brain)', async () => {
  const s = sink();
  const r = await handleMessage({ author: { id: '1', username: 'ryan' }, content: '!price', channel_id: 'c' }, {
    botUserId: BOT, send: s.send,
    runCommand: async (body) => ({ handled: true, reply: `price for ${body}`, command: 'price' }),
    ask: async () => { throw new Error('brain should not be called for a handled command'); },
  });
  assert.equal(r.kind, 'command');
  assert.equal(s.sent[0].txt, 'price for !price');
});

test('conversation routes to the one brain (/perceive) and speaks the reply', async () => {
  const s = sink();
  let asked = null;
  const r = await handleMessage({ author: { id: '1', username: 'ryan' }, content: 'hathor, what is a witness?', channel_id: 'c' }, {
    botUserId: BOT, send: s.send,
    ask: async (q, o) => { asked = { q, from: o.from }; return 'A witness produces the blocks.'; },
  });
  assert.equal(r.kind, 'brain');
  assert.equal(asked.q, 'what is a witness?');   // name stripped
  assert.equal(asked.from, 'ryan');
  assert.equal(s.sent[0].txt, 'A witness produces the blocks.');
});

test('silent result when neither command nor brain has anything', async () => {
  const s = sink();
  const r = await handleMessage({ author: { id: '1', username: 'x' }, content: 'hathor ?????', channel_id: 'c' },
    { botUserId: BOT, send: s.send, ask: async () => '' });
  assert.equal(r.kind, 'silent'); assert.equal(s.sent.length, 0);
});
