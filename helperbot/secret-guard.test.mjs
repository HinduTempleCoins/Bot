// secret-guard.test.mjs — the inbound secret guard detects keys/seeds/passwords, never flags ordinary
// chat, and — the load-bearing part — a pasted secret NEVER reaches a log line on any surface.
// Secret-shaped fixtures are GENERATED at runtime (deterministic PRNG), so no key-shaped literal lives
// in this file.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanSecrets, redactSecrets, inboundTrace, rotationWarning } from './secret-guard.mjs';
import { BIP39_ENGLISH } from './bip39-english.mjs';
import { handle } from './brain.mjs';
import { memoryStore } from './store.mjs';

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function prng(seed) { let x = seed >>> 0; return () => ((x = (x * 1664525 + 1013904223) >>> 0) / 2 ** 32); }
const pick = (r, s, n) => Array.from({ length: n }, () => s[Math.floor(r() * s.length)]).join('');
const r = prng(42);
const FAKE = {
  wif: '5K' + pick(r, B58, 49),
  wifCompressed: 'L' + pick(r, B58, 51),
  master: 'P5' + pick(r, B58, 50),
  hex: pick(r, '0123456789abcdef', 64),
  xprv: 'xprv' + pick(r, B58, 107),
  seed12: Array.from({ length: 12 }, () => BIP39_ENGLISH[Math.floor(r() * 2048)]).join(' '),
  seed24: Array.from({ length: 24 }, () => BIP39_ENGLISH[Math.floor(r() * 2048)]).join(' '),
};

test('detects every supported secret shape', () => {
  assert.deepEqual(scanSecrets(`here ${FAKE.wif} thanks`).kinds, ['wif']);
  assert.deepEqual(scanSecrets(FAKE.wifCompressed).kinds, ['wif']);
  assert.deepEqual(scanSecrets(`login ${FAKE.master}`).kinds, ['master-password']);
  assert.deepEqual(scanSecrets(FAKE.hex).kinds, ['hex-private-key']);
  assert.deepEqual(scanSecrets(`my private key 0x${FAKE.hex}`).kinds, ['hex-private-key']);
  assert.deepEqual(scanSecrets(FAKE.xprv).kinds, ['extended-private-key']);
  assert.ok(scanSecrets(FAKE.seed12).kinds.includes('seed-phrase'));
  assert.ok(scanSecrets(`is this right? ${FAKE.seed24}`).kinds.includes('seed-phrase'));
  assert.ok(scanSecrets('password: Hunter2Hunter2').hit);
  assert.ok(scanSecrets('owner key = abcdefgh1234').hit);
  assert.ok(scanSecrets('my master password is QwErTy12345').hit);
});

test('a seed phrase with one typo is still caught', () => {
  const w = FAKE.seed12.split(' ');
  w[5] = 'zzzzq';
  assert.ok(scanSecrets(w.join(' ')).hit);
});

test('Monero 25-word seeds are caught', async () => {
  const { ENGLISH_WORDS } = await import('../pool/www/walletgen/vendor/english-wordlist.mjs');
  const seed = Array.from({ length: 25 }, () => ENGLISH_WORDS[Math.floor(r() * ENGLISH_WORDS.length)]).join(' ');
  assert.ok(scanSecrets(seed).hit);
});

test('ordinary chat, public keys, addresses and tx hashes are NOT flagged', () => {
  const clean = [
    'hi there, how do i sign up for melek?',
    'I want to buy a house near the river and walk my dog every morning before work',
    'Please check the account balance and also review the recent transfer history today thanks',
    `tx 0x${FAKE.hex}`,
    `the transaction hash is ${FAKE.hex}`,
    'address 0x026d69cB54B82a805b6aaE60718C4877124D8d11',
    'MELEK' + '6' + pick(prng(7), B58, 49) + ' is my public key',
    'what is the password requirement?',
    'my password is lost, how do I recover?',
    '!tip @alice 2',
    '!faucet prana 0x026d69cB54B82a805b6aaE60718C4877124D8d11',
  ];
  for (const t of clean) assert.equal(scanSecrets(t).hit, false, t);
});

test('redactSecrets removes the secret material', () => {
  const out = redactSecrets(`key ${FAKE.wif} and ${FAKE.master}`);
  assert.ok(!out.includes(FAKE.wif) && !out.includes(FAKE.master));
  assert.match(out, /\[REDACTED\]/);
  assert.equal(redactSecrets('nothing here'), 'nothing here');
  assert.equal(redactSecrets(null), '');
});

test('inboundTrace never contains content or the raw username', () => {
  const line = inboundTrace({ platform: 'discord-guild', user: '123456789012345678', channel: '42', text: `oops ${FAKE.wif}` });
  assert.ok(!line.includes(FAKE.wif));
  assert.ok(!line.includes('oops'));
  assert.ok(!line.includes('123456789012345678'));
  assert.match(line, /guard=SECRET-BLOCKED/);
  assert.match(inboundTrace({ text: 'hello world' }), /len=11 kind=text guard=clean/);
});

test('rotationWarning never echoes the secret and tells the user to rotate', () => {
  const w = rotationWarning(['wif', 'seed-phrase'], { deleted: true, platform: 'discord' });
  assert.match(w, /deleted the message/);
  assert.match(w, /burned|change your password|fresh wallet/);
  assert.match(rotationWarning(['wif'], { platform: 'trollbox' }), /ON-CHAIN/);
});

// ── the load-bearing property: secrets never reach logs on any surface ─────────────────────────────
async function captureConsole(fn) {
  const lines = [];
  const orig = { log: console.log, error: console.error, warn: console.warn, info: console.info };
  for (const k of Object.keys(orig)) console[k] = (...a) => lines.push(a.map(String).join(' '));
  try { await fn(); } finally { Object.assign(console, orig); }
  return lines.join('\n');
}

for (const [name, secret] of Object.entries(FAKE)) {
  test(`brain refuses + does not log a pasted ${name}`, async () => {
    let out;
    const logs = await captureConsole(async () => {
      console.log(inboundTrace({ platform: 'discord-guild', user: 'u1', channel: 'c1', text: `help ${secret}` }));
      out = await handle({ platform: 'discord', userId: 'u1', text: `help ${secret}` }, { store: memoryStore(), commandsEnabled: true });
    });
    assert.equal(out.handled, true);
    assert.ok(out.secret && out.secret.kinds.length);
    assert.equal(out.deleteMessage, true);
    assert.ok(!out.reply.includes(secret), 'reply must not echo the secret');
    assert.ok(!logs.includes(secret), 'logs must not contain the secret');
  });
}

test('guard runs even when helper commands are disabled', async () => {
  const out = await handle({ platform: 'discord', userId: 'u', text: FAKE.wif }, { commandsEnabled: false });
  assert.ok(out.secret);
  const pass = await handle({ platform: 'discord', userId: 'u', text: '!tokenomics' }, { commandsEnabled: false });
  assert.equal(pass.handled, false);
});

test('Telegram: secret is refused, delete requested, nothing logged', async () => {
  const tg = await import('../integrations/telegram-bot.mjs');
  let action;
  const update = { update_id: 1, message: { message_id: 77, chat: { id: 5 }, from: { id: 9, username: 'alice' }, text: `seed ${FAKE.seed12}` } };
  const logs = await captureConsole(async () => { action = await tg.handleUpdate(update, { dispatcher: async () => ({ reply: 'SHOULD NOT RUN' }) }); });
  assert.equal(action.route, 'secret');
  assert.equal(action.deleteMessageId, 77);
  assert.ok(!logs.includes(FAKE.seed12.split(' ').slice(0, 3).join(' ')));
  // the run loop calls deleteMessage then sends the warning
  const sent = []; const deleted = [];
  await tg.run({ max: 1, transport: { getUpdates: async () => [update], sendMessage: async (m) => sent.push(m), deleteMessage: async (m) => deleted.push(m) } });
  assert.deepEqual(deleted, [{ chatId: '5', messageId: 77 }]);
  assert.ok(sent[0].text.includes('never need it'));
});

test('troll-box: secret is refused with the on-chain rotate-now warning, nothing logged', async () => {
  const tb = await import('../src/trollbox/index.mjs');
  let out;
  const logs = await captureConsole(async () => { out = await tb.handleMessage({ user: 'bob', text: `my key ${FAKE.wif}` }, {}); });
  assert.equal(out.kind, 'secret');
  assert.match(out.reply, /ON-CHAIN/);
  assert.ok(!out.reply.includes(FAKE.wif));
  assert.ok(!logs.includes(FAKE.wif));
});

test('index.js no longer logs message content (static check of the inbound trace)', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../index.js', import.meta.url), 'utf8');
  assert.ok(!/c\.slice\(0,\s*50\)/.test(src), 'the 50-char content preview must be gone');
  assert.ok(src.includes("inboundTrace({ platform: message.guild ? 'discord-guild' : 'discord-dm'"));
  // the guard hook runs before the first legacy command handler
  const guardAt = src.indexOf("await import('./helperbot/brain.mjs')");
  const legacyAt = src.indexOf("message.content.match(/^!(hathor|block|witness|account|feed)");
  assert.ok(guardAt > 0 && legacyAt > guardAt);
});
