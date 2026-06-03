// discord-ingest.test.mjs — OFFLINE proof of the Discord-as-brief-source crunch (queue #71).
// NEVER touches Discord: every test injects a canned message array via a fake client or calls the
// pure transforms directly. Asserts: normalization + soft-fail, the summary crunch, brief markdown,
// and author-id redaction (privacy).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  fetchHistory, summarizeChannel, briefNotes, redactAuthors, normalizeMessage, __setClient,
} from './discord-ingest.mjs';

// canned raw messages in a couple of the supported shapes (mix of author object + ts forms).
const RAW = [
  { id: '1', author: { id: 'alice' }, content: 'gm everyone, the new feature is awesome 🚀', createdTimestamp: 1717410000000 },
  { id: '2', author: { id: 'bob' }, content: 'love the airdrop, thanks team! bullish on MELEK', ts: '2026-06-03T10:05:00Z' },
  { id: '3', author: { id: 'alice' }, content: 'when is the next airdrop? feature looks great', ts: '2026-06-03T10:10:00Z' },
  { id: '4', author: { id: 'carol' }, content: 'found a bug in the airdrop claim, it errors out', ts: '2026-06-03T10:15:00Z' },
];

const cannedClient = (_channelId, { limit } = {}) => RAW.slice(0, limit ?? RAW.length);

test('fetchHistory normalizes via the injected client', async () => {
  const msgs = await fetchHistory('chan-1', { client: cannedClient, limit: 100 });
  assert.equal(msgs.length, 4);
  for (const m of msgs) {
    assert.ok(m.id, 'has id');
    assert.equal(typeof m.author, 'string');
    assert.equal(typeof m.content, 'string');
    assert.equal(m.channelId, 'chan-1');
    assert.ok(m.ts === null || /\d{4}-\d{2}-\d{2}T/.test(m.ts), 'ts is ISO or null');
  }
  // newest-first ordering by ts
  assert.equal(msgs[0].id, '4');
});

test('fetchHistory respects limit', async () => {
  const msgs = await fetchHistory('chan-1', { client: cannedClient, limit: 2 });
  assert.equal(msgs.length, 2);
});

test('fetchHistory soft-fails to [] when the client throws', async () => {
  const boom = () => { throw new Error('discord down'); };
  const msgs = await fetchHistory('chan-1', { client: boom });
  assert.deepEqual(msgs, []);
});

test('fetchHistory soft-fails to [] with no client and no channelId', async () => {
  __setClient(null);
  assert.deepEqual(await fetchHistory('', {}), []);
  assert.deepEqual(await fetchHistory(null, {}), []);
  // no injected/default client → []
  assert.deepEqual(await fetchHistory('chan-x', {}), []);
});

test('fetchHistory accepts a discord.js-style Collection (Map) + channels.fetch client', async () => {
  const collection = new Map(RAW.map((m) => [m.id, m]));
  const djsClient = {
    channels: {
      async fetch() {
        return { messages: { async fetch() { return collection; } } };
      },
    },
  };
  const msgs = await fetchHistory('chan-1', { client: djsClient, limit: 100 });
  assert.equal(msgs.length, 4);
});

test('normalizeMessage handles missing fields defensively', () => {
  assert.equal(normalizeMessage(null), null);
  const m = normalizeMessage({ id: 9 }, 'c');
  assert.equal(m.id, '9');
  assert.equal(m.author, '');
  assert.equal(m.content, '');
  assert.equal(m.channelId, 'c');
});

test('summarizeChannel counts messages, active authors, and top terms', () => {
  const msgs = RAW.map((m) => normalizeMessage(m, 'chan-1'));
  const s = summarizeChannel(msgs);
  assert.equal(s.count, 4);
  assert.equal(s.activeAuthors, 3); // alice, bob, carol
  assert.ok(Array.isArray(s.topTerms) && s.topTerms.length > 0);
  // "airdrop" appears in 3 messages → should be a top term
  const airdrop = s.topTerms.find((t) => t.term === 'airdrop');
  assert.ok(airdrop && airdrop.count >= 3, `airdrop term: ${JSON.stringify(s.topTerms)}`);
  // window spans the canned timestamps
  assert.ok(s.window.from && s.window.to);
  assert.ok(Date.parse(s.window.from) <= Date.parse(s.window.to));
  assert.equal(s.channelId, 'chan-1');
});

test('summarizeChannel computes a sentiment with score + label', () => {
  const msgs = RAW.map((m) => normalizeMessage(m, 'chan-1'));
  const s = summarizeChannel(msgs);
  assert.ok(s.sentiment && typeof s.sentiment.score === 'number');
  assert.ok(['positive', 'negative', 'neutral'].includes(s.sentiment.label));
});

test('summarizeChannel is pure + safe on empty/garbage input', () => {
  const s = summarizeChannel([]);
  assert.equal(s.count, 0);
  assert.equal(s.activeAuthors, 0);
  assert.deepEqual(s.topTerms, []);
  assert.equal(s.window.from, null);
  assert.deepEqual(summarizeChannel(null).count, 0);
});

test('briefNotes emits the Community (Discord) markdown block', () => {
  const s = summarizeChannel(RAW.map((m) => normalizeMessage(m, 'chan-1')));
  const md = briefNotes(s);
  assert.match(md, /### Community \(Discord\)/);
  assert.match(md, /\*\*Volume:\*\* 4 messages from 3 active members/);
  assert.match(md, /\*\*Mood:\*\*/);
  assert.match(md, /\*\*Talking about:\*\*/);
  assert.match(md, /airdrop/);
});

test('briefNotes handles an empty summary gracefully', () => {
  const md = briefNotes(summarizeChannel([]));
  assert.match(md, /### Community \(Discord\)/);
  assert.match(md, /No recent messages/);
});

test('redactAuthors removes raw author ids (hashed) and truncates content', () => {
  const msgs = RAW.map((m) => normalizeMessage(m, 'chan-1'));
  const red = redactAuthors(msgs, { contentChars: 10 });
  assert.equal(red.length, 4);
  for (const r of red) {
    assert.match(r.author, /^u_[0-9a-f]{8}$/, 'author is a short hash');
    assert.ok(r.content.length <= 10, 'content truncated');
  }
  // raw ids must NOT appear anywhere in the redacted output
  const blob = JSON.stringify(red);
  assert.ok(!blob.includes('alice') && !blob.includes('bob') && !blob.includes('carol'));
  // same raw author → same hash (stable); different author → different hash
  assert.equal(red[0].author, red[2].author); // both alice
  assert.notEqual(red[0].author, red[1].author); // alice vs bob
});

test('redactAuthors is safe on empty/garbage input', () => {
  assert.deepEqual(redactAuthors([]), []);
  assert.deepEqual(redactAuthors(null), []);
  const r = redactAuthors([{ id: '1' }]);
  assert.equal(r[0].author, 'anon');
});
