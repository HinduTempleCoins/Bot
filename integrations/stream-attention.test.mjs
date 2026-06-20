import { test } from 'node:test';
import assert from 'node:assert/strict';
import { notice, ackLine } from './stream-attention.mjs';

const chat = [
  { author: 'kid_42', text: 'hathor are you really an AI??' },
  { author: 'lurker', text: 'lol' },
  { author: 'newbie', text: 'first time here, hi everyone' },
  { author: 'alice', text: 'what game is this' },
];

test('she notices within a budget, not every line', () => {
  const out = notice(chat, { budget: 2 });
  assert.equal(out.noticed.length, 2);
  assert.equal(out.glanced, 4);
});

test('being named is the strongest pull', () => {
  const out = notice(chat, { budget: 1 });
  assert.equal(out.noticed[0].author, 'kid_42');
  assert.ok(out.noticed[0].reasons.includes('named-her'));
});

test('she spreads attention — at most one line per author per glance', () => {
  const spammy = [
    { author: 'x', text: 'hathor hathor hathor' },
    { author: 'x', text: 'hathor answer me' },
    { author: 'y', text: 'hi hathor' },
  ];
  const out = notice(spammy, { budget: 3 });
  const authors = out.noticed.map((n) => n.author);
  assert.equal(new Set(authors).size, authors.length); // no author twice
});

test('low-signal chatter scrolls by (noise floor)', () => {
  const out = notice([{ author: 'lurker', text: 'lol' }, { author: 'l2', text: 'k' }], { budget: 3 });
  assert.equal(out.noticed.length, 0);
});

test('first-time chatters get a novelty bump', () => {
  const seenAuthors = new Set(['regular']);
  const out = notice([
    { author: 'regular', text: 'what game is this' },
    { author: 'brand_new', text: 'what game is this' },
  ], { budget: 1, seenAuthors });
  assert.equal(out.noticed[0].author, 'brand_new');
  assert.ok(out.noticed[0].firstTime);
});

test('cooldown damps someone she just acknowledged', () => {
  const now = 1_000_000;
  const lastSeenAt = new Map([['recent', now - 1000]]); // acknowledged 1s ago
  const out = notice([
    { author: 'recent', text: 'hathor hello again' },
    { author: 'fresh', text: 'hathor hi' },
  ], { budget: 1, now, lastSeenAt, seenAuthors: new Set(['recent', 'fresh']) });
  assert.equal(out.noticed[0].author, 'fresh'); // the not-on-cooldown person wins
});

test('notice updates seen + lastSeen memory', () => {
  const seenAuthors = new Set();
  const lastSeenAt = new Map();
  const now = 5000;
  notice([{ author: 'kid_42', text: 'hathor hi' }], { budget: 1, seenAuthors, lastSeenAt, now });
  assert.ok(seenAuthors.has('kid_42'));
  assert.equal(lastSeenAt.get('kid_42'), now);
});

test('ackLine addresses the person by name, reacts to THEM (streamer feel)', () => {
  const out = notice(chat, { budget: 2 });
  for (const n of out.noticed) {
    const line = ackLine(n);
    assert.ok(line.includes(n.author) || /friend/.test(line));
  }
  assert.match(ackLine({ author: 'bob', reasons: ['named-her'] }), /I hear you/);
  assert.match(ackLine({ author: 'sue', reasons: ['first-time-chatter'] }), /Welcome in/);
});

test('soft-fails on junk input', () => {
  assert.deepEqual(notice(null).noticed, []);
  assert.deepEqual(notice([{ text: '' }, null]).noticed, []);
});

test('reasons summary counts named/questions/newcomers', () => {
  const out = notice(chat, { budget: 4, seenAuthors: new Set() });
  assert.equal(out.reasons.named, 1);
  assert.ok(out.reasons.questions >= 1);
  assert.ok(out.reasons.newcomers >= 1);
});
