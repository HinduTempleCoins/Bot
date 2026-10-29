// hathor-dm.test.mjs — Hathor's Pentecaust IM sender. OFFLINE. Temp stores, no network, no keys.
import { test } from 'node:test';
import assert from 'node:assert';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unlinkSync } from 'node:fs';
import { hathorDM, hathorDMAll, AS, MAX_TEXT } from './hathor-dm.mjs';
import { readDM, dmChannelId } from './messaging.mjs';
import { notificationsFor, unreadCountFor } from './notifications.mjs';

let _n = 0;
function env() {
  const chatFile = join(tmpdir(), `pent-hdm-chat-${process.pid}-${_n++}.json`);
  const seenFile = join(tmpdir(), `pent-hdm-seen-${process.pid}-${_n++}.json`);
  const chat = { file: chatFile, now: 5000 };
  return {
    chat,
    notif: { file: seenFile, chat },
    cleanup: () => { for (const f of [chatFile, seenFile]) { try { unlinkSync(f); } catch {} } },
  };
}

test('Hathor sends an IM and it lands in the thread', () => {
  const e = env();
  const r = hathorDM({ to: 'vankushfamily', text: 'the KULA bridge guide is up' }, e.chat);
  assert.equal(r.ok, true);
  assert.equal(r.to, 'vankushfamily');
  assert.equal(r.channel, dmChannelId(AS, 'vankushfamily'));
  assert.equal(r.message.from, 'hathor');
  assert.equal(r.message.surface, 'hathor', 'tagged as coming from Hathor');

  const thread = readDM('vankushfamily', AS, {}, e.chat);
  assert.equal(thread.messages.length, 1);
  assert.equal(thread.messages[0].text, 'the KULA bridge guide is up');
  e.cleanup();
});

test('the recipient gets a notification they can click through', () => {
  const e = env();
  hathorDM({ to: 'vankushfamily', text: 'your feed published' }, e.chat);
  const n = notificationsFor('vankushfamily', {}, e.notif);
  assert.equal(n.unread, 1);
  assert.equal(n.items[0].kind, 'dm');
  assert.equal(n.items[0].from, 'hathor');
  assert.equal(n.items[0].url, '/?dm=hathor');
  // and Hathor is not pinged by her own message
  assert.equal(unreadCountFor(AS, e.notif), 0);
  e.cleanup();
});

test('an @ prefix and odd casing on the recipient are normalised', () => {
  const e = env();
  const r = hathorDM({ to: '@VanKushFamily', text: 'hi' }, e.chat);
  assert.equal(r.ok, true);
  assert.equal(r.to, 'vankushfamily');
  assert.equal(unreadCountFor('vankushfamily', e.notif), 1);
  e.cleanup();
});

test('bad recipients and empty text are refused, never thrown', () => {
  const e = env();
  for (const bad of ['', null, undefined, 'A', '!!', 'ab', 'x'.repeat(80), 'a.bc']) {
    const r = hathorDM({ to: bad, text: 'hi' }, e.chat);
    assert.equal(r.ok, false, `should refuse ${JSON.stringify(bad)}`);
  }
  assert.equal(hathorDM({ to: 'vankushfamily', text: '' }, e.chat).ok, false);
  assert.equal(hathorDM({ to: 'vankushfamily', text: '   ' }, e.chat).ok, false);
  assert.equal(hathorDM({ to: AS, text: 'hi' }, e.chat).ok, false, 'no self-DM');
  e.cleanup();
});

test('an over-long message is refused rather than silently truncated', () => {
  const e = env();
  const r = hathorDM({ to: 'vankushfamily', text: 'x'.repeat(MAX_TEXT + 1) }, e.chat);
  assert.equal(r.ok, false);
  assert.match(r.reason, /too long/);
  assert.equal(hathorDM({ to: 'vankushfamily', text: 'x'.repeat(MAX_TEXT) }, e.chat).ok, true);
  e.cleanup();
});

test('hathorDMAll keeps going past a bad name', () => {
  const e = env();
  const r = hathorDMAll(['vankushfamily', '!!bad', 'kalivankush'], 'bridges are open', e.chat);
  assert.equal(r.sent, 2);
  assert.equal(r.failed, 1);
  assert.equal(unreadCountFor('vankushfamily', e.notif), 1);
  assert.equal(unreadCountFor('kalivankush', e.notif), 1);
  e.cleanup();
});

test('a URL Hathor sends is only clickable because it is on our own host', async () => {
  const { renderText } = await import('../integrations/maker-embeds.mjs');
  const ours = renderText('see https://melek.salon/@hathor/bring-vkbt-and-cure-home-kula-bridge-open');
  assert.match(ours, /<a href="https:\/\/melek\.salon\//);
  // the same lockdown applies to anything Hathor relays that is not ours
  assert.equal(renderText('see https://evil.example/x').includes('<a'), false);
});
