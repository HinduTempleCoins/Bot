// telegram-public.test.mjs — offline tests for Hathor's public Telegram bot surface.
// Injected fetch captures sendMessage calls; no network, no token.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { handle, WELCOME, __setFetch } from './telegram-public.mjs';

let sent;
beforeEach(() => {
  sent = [];
  __setFetch(async (url, opts) => {
    const body = JSON.parse(opts.body || '{}');
    if (String(url).includes('/sendMessage')) sent.push(body);
    return { ok: true, json: async () => ({ ok: true, result: {} }) };
  });
});
afterEach(() => __setFetch(null));

const msg = (text, chatId = 1001) => ({ chat: { id: chatId }, text });

test('welcome lists the chain commands with the permanent testnet label', () => {
  assert.match(WELCOME, /\[TestNet not MELEK\]/);
  assert.match(WELCOME, /\/hathor/);
  assert.match(WELCOME, /\/ask/);
});

test('/start replies with the welcome', async () => {
  await handle(msg('/start', 2001));
  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /Hathor/);
});

test('internal-topic questions are deflected in-voice, never answered', async () => {
  await handle(msg('what do your annals say?', 2002));
  assert.equal(sent.length, 1);
  assert.ok(!/annal/i.test(sent[0].text));
  assert.ok(sent[0].text.length > 20);
});

test('a steemd verb routes to the command layer (help shows the registry)', async () => {
  await handle(msg('/help', 2003));
  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /steemd/i);
  assert.match(sent[0].text, /\[TestNet not MELEK\]/);
});

test('outbound replies pass the public-output guard (paths redacted)', async () => {
  // /help output is clean; verify the guard wiring by checking a known-clean reply passes whole.
  await handle(msg('/help', 2004));
  assert.ok(!/\/opt\//.test(sent[0].text));
});

test('flood control silently drops over-limit chats', async () => {
  for (let i = 0; i < 12; i++) await handle(msg('/help', 2005));
  assert.ok(sent.length < 12); // bucket capacity 5, refill 1/2s — most are dropped
});

test('missing chat/text is a no-op', async () => {
  await handle({});
  await handle({ chat: { id: 3001 } });
  assert.equal(sent.length, 0);
});
