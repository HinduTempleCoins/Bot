// notifications.test.mjs — Pentecaust Notifications. OFFLINE. Temp stores, no network, no keys.
import { test } from 'node:test';
import assert from 'node:assert';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unlinkSync } from 'node:fs';
import { postDM, dmChannelId } from './messaging.mjs';
import {
  notificationsFor, unreadCountFor, markRead, markReadWith, markAllRead, lastSeen, MAX_ITEMS,
} from './notifications.mjs';

let _n = 0;
/** A fresh chat store + a fresh read-marker store, wired together. */
function env() {
  const chatFile = join(tmpdir(), `pent-notif-chat-${process.pid}-${_n++}.json`);
  const seenFile = join(tmpdir(), `pent-notif-seen-${process.pid}-${_n++}.json`);
  const chat = { file: chatFile, now: 5000 };
  return {
    chat,
    opts: { file: seenFile, chat },
    cleanup: () => { for (const f of [chatFile, seenFile]) { try { unlinkSync(f); } catch {} } },
  };
}

test('no messages means an empty badge', () => {
  const e = env();
  const r = notificationsFor('ryan', {}, e.opts);
  assert.equal(r.ok, true);
  assert.equal(r.unread, 0);
  assert.equal(r.threads, 0);
  assert.deepEqual(r.items, []);
  assert.equal(unreadCountFor('ryan', e.opts), 0);
  e.cleanup();
});

test('incoming DMs count toward the badge; your own sent messages do not', () => {
  const e = env();
  postDM({ from: 'hathor', to: 'ryan', text: 'bridge guide is up' }, e.chat);
  postDM({ from: 'hathor', to: 'ryan', text: 'and your feed published' }, e.chat);
  postDM({ from: 'ryan', to: 'hathor', text: 'thanks' }, e.chat);

  const r = notificationsFor('ryan', {}, e.opts);
  assert.equal(r.unread, 2, 'only the two from hathor');
  assert.equal(r.threads, 1);
  assert.equal(r.items[0].with, 'hathor');
  assert.equal(r.items[0].count, 2);
  assert.equal(r.items[0].text, 'and your feed published', 'carries the latest line');

  // The sender sees nothing for their own messages — only ryan's reply is unread for hathor.
  assert.equal(unreadCountFor('hathor', e.opts), 1);
  e.cleanup();
});

test('each item deep-links into the messenger thread', () => {
  const e = env();
  postDM({ from: 'steve', to: 'ryan', text: 'raid at 8?', game: 'minecraft', surface: 'game' }, e.chat);
  const it = notificationsFor('ryan', {}, e.opts).items[0];
  assert.equal(it.url, '/?dm=steve');
  assert.equal(it.game, 'minecraft');
  assert.equal(it.surface, 'game');
  assert.equal(it.channel, dmChannelId('ryan', 'steve'));
  e.cleanup();
});

test('dotted and hyphenated account names are URL-encoded in the link', () => {
  const e = env();
  // valid MELEK names allow dots (3+ char segments) and hyphens — neither may break the query string
  postDM({ from: 'melek.dao', to: 'ryan', text: 'hello' }, e.chat);
  postDM({ from: 'x-y-z', to: 'ryan', text: 'hi' }, e.chat);
  const items = notificationsFor('ryan', {}, e.opts).items;
  const urls = items.map((i) => i.url).sort();
  assert.deepEqual(urls, [`/?dm=${encodeURIComponent('melek.dao')}`, '/?dm=x-y-z'].sort());
  assert.ok(urls[0].includes('melek.dao') || urls[1].includes('melek.dao'));
  e.cleanup();
});

test('opening one thread clears only that thread', () => {
  const e = env();
  postDM({ from: 'hathor', to: 'ryan', text: 'one' }, e.chat);
  postDM({ from: 'hathor', to: 'ryan', text: 'two' }, e.chat);
  postDM({ from: 'steve', to: 'ryan', text: 'raid?' }, e.chat);
  assert.equal(notificationsFor('ryan', {}, e.opts).unread, 3);

  assert.equal(markReadWith('ryan', 'hathor', e.opts).ok, true);
  const r = notificationsFor('ryan', {}, e.opts);
  assert.equal(r.unread, 1);
  assert.equal(r.threads, 1);
  assert.equal(r.items[0].with, 'steve');
  e.cleanup();
});

test('new messages after a read re-arm the badge', () => {
  const e = env();
  postDM({ from: 'hathor', to: 'ryan', text: 'first' }, e.chat);
  markReadWith('ryan', 'hathor', e.opts);
  assert.equal(unreadCountFor('ryan', e.opts), 0);

  postDM({ from: 'hathor', to: 'ryan', text: 'second' }, e.chat);
  const r = notificationsFor('ryan', {}, e.opts);
  assert.equal(r.unread, 1);
  assert.equal(r.items[0].text, 'second');
  e.cleanup();
});

test('read markers only move forward — a replayed or stale mark cannot un-read', () => {
  const e = env();
  postDM({ from: 'hathor', to: 'ryan', text: 'one' }, e.chat);
  postDM({ from: 'hathor', to: 'ryan', text: 'two' }, e.chat);
  const ch = dmChannelId('ryan', 'hathor');

  markRead('ryan', ch, 2, e.opts);
  assert.equal(lastSeen('ryan', ch, e.opts), 2);
  markRead('ryan', ch, 1, e.opts);           // stale replay
  assert.equal(lastSeen('ryan', ch, e.opts), 2, 'marker did not go backwards');
  assert.equal(unreadCountFor('ryan', e.opts), 0);
  e.cleanup();
});

test('markAllRead clears the whole badge', () => {
  const e = env();
  postDM({ from: 'hathor', to: 'ryan', text: 'a' }, e.chat);
  postDM({ from: 'steve', to: 'ryan', text: 'b' }, e.chat);
  postDM({ from: 'alex', to: 'ryan', text: 'c' }, e.chat);
  assert.equal(notificationsFor('ryan', {}, e.opts).unread, 3);

  const r = markAllRead('ryan', e.opts);
  assert.equal(r.ok, true);
  assert.equal(r.cleared, 3);
  assert.equal(unreadCountFor('ryan', e.opts), 0);
  e.cleanup();
});

test('invalid account names are refused, never thrown', () => {
  const e = env();
  for (const bad of ['', null, undefined, 'A', '!!', 'x'.repeat(80)]) {
    const r = notificationsFor(bad, {}, e.opts);
    assert.equal(r.ok, false);
    assert.equal(r.unread, 0);
    assert.equal(unreadCountFor(bad, e.opts), 0);
  }
  assert.equal(markRead('!!', 'dm:a__b', 1, e.opts).ok, false);
  assert.equal(markReadWith('ryan', '!!', e.opts).ok, false);
  assert.equal(markAllRead('!!', e.opts).ok, false);
  e.cleanup();
});

test('markRead requires a channel', () => {
  const e = env();
  assert.equal(markRead('ryan', '', 1, e.opts).ok, false);
  e.cleanup();
});

test('a corrupt read-marker store degrades to "everything unread", never throws', () => {
  const e = env();
  const bad = { read: () => '{{{not json', write: () => {} };
  postDM({ from: 'hathor', to: 'ryan', text: 'hi' }, e.chat);
  const r = notificationsFor('ryan', {}, { ...e.opts, fs: bad });
  assert.equal(r.ok, true);
  assert.equal(r.unread, 1);
  e.cleanup();
});

test('an unwritable read-marker store does not throw', () => {
  const e = env();
  const ro = { read: () => null, write: () => { throw new Error('read-only fs'); } };
  postDM({ from: 'hathor', to: 'ryan', text: 'hi' }, e.chat);
  const r = markReadWith('ryan', 'hathor', { ...e.opts, fs: ro });
  assert.equal(r.ok, true, 'soft-fails rather than throwing');
  e.cleanup();
});

test('the item list is capped so a flooded inbox cannot make an unbounded page', () => {
  const e = env();
  for (let i = 0; i < MAX_ITEMS + 15; i += 1) {
    postDM({ from: `sender${i}`, to: 'ryan', text: `m${i}` }, e.chat);
  }
  const r = notificationsFor('ryan', {}, e.opts);
  assert.equal(r.items.length, MAX_ITEMS);
  assert.ok(r.unread >= MAX_ITEMS, 'the count still reflects everything');
  const few = notificationsFor('ryan', { limit: 5 }, e.opts);
  assert.equal(few.items.length, 5);
  e.cleanup();
});

test('threads are ordered newest first', () => {
  const e = env();
  postDM({ from: 'alex', to: 'ryan', text: 'oldest' }, e.chat);
  postDM({ from: 'steve', to: 'ryan', text: 'middle' }, e.chat);
  postDM({ from: 'hathor', to: 'ryan', text: 'newest' }, e.chat);
  const items = notificationsFor('ryan', {}, e.opts).items;
  assert.deepEqual(items.map((i) => i.with), ['hathor', 'steve', 'alex']);
  e.cleanup();
});
