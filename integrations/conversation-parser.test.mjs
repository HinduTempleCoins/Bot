// conversation-parser.test.mjs — OFFLINE proof of the conversation → MoM/action-item pipeline (#227).
// Pure transforms + injected deps (an injected comms-parser, an injected clock, an offline store).
// Asserts: parseConversation produces summary + actionItems + decisions reusing the injected
// comms-parser; toActionItems pulls "I'll X"/"can you Y"/"we need Z" with attribution;
// toConversationFile writes an operator-tier record through an injected store; redactForAiTier removes
// an email/key/server-path (asserted ABSENT); renderSummary emits MoM markdown.
import { test } from 'node:test';
const FAKE_KEY = 'sk-' + 'ABCDEF0123456789abcdef0123';  // assembled, not a literal
import assert from 'node:assert/strict';
import {
  parseConversation, toActionItems, toConversationFile, redactForAiTier, renderSummary,
} from './conversation-parser.mjs';

// an INJECTED comms-parser — deterministic, records that it was called (proves reuse, not duplication).
function makeFakeCommsParser() {
  const calls = { sentiment: 0, extractEntities: 0 };
  return {
    calls,
    sentiment(text) {
      calls.sentiment++;
      const t = String(text || '').toLowerCase();
      const score = t.includes('good') || t.includes('great') ? 0.5 : 0;
      return { score, label: score > 0.15 ? 'positive' : 'neutral', hits: [] };
    },
    extractEntities(text) {
      calls.extractEntities++;
      const tickers = [...String(text || '').matchAll(/\$([A-Za-z]{1,8})/g)].map((m) => m[1].toUpperCase());
      const mentions = [...String(text || '').matchAll(/@([A-Za-z0-9_]{2,30})/g)].map((m) => m[1]);
      return { tickers: [...new Set(tickers)], mentions: [...new Set(mentions)], urls: [], hashtags: [], orgs: [] };
    },
  };
}

const CONVO = {
  source: 'telegram',
  messages: [
    { from: 'operator', text: "I'll set up DNS tonight. Can you draft the Caddy config? We need TLS before launch.", ts: '2026-06-04T10:00:00Z' },
    { from: 'hathor', text: "Sounds good, let's go with Caddy. I will draft $BTC pricing for @operator now.", ts: '2026-06-04T10:01:00Z' },
    { from: 'operator', text: 'Great. Should we use staging first?', ts: '2026-06-04T10:02:00Z' },
  ],
};

const DETERMINISTIC = { now: () => '2026-06-04T12:00:00.000Z' };

test('parseConversation produces summary + actionItems + decisions, reusing the injected comms-parser', () => {
  const cp = makeFakeCommsParser();
  const parsed = parseConversation(CONVO, { commsParser: cp, ...DETERMINISTIC });

  assert.equal(typeof parsed.id, 'string');
  assert.equal(parsed.source, 'telegram');
  assert.ok(parsed.summary.length > 0, 'has a summary');
  assert.ok(Array.isArray(parsed.actionItems) && parsed.actionItems.length >= 2, 'has action items');
  assert.ok(Array.isArray(parsed.decisions) && parsed.decisions.length >= 1, 'has a decision ("let\'s go with")');
  assert.equal(parsed.parsedAt, '2026-06-04T12:00:00.000Z', 'uses the injected clock');

  // PROOF of reuse: the injected comms-parser was actually called for sentiment + entities.
  assert.ok(cp.calls.sentiment >= 1, 'reused injected comms-parser sentiment');
  assert.ok(cp.calls.extractEntities >= 1, 'reused injected comms-parser extractEntities');
  // entities flowed through (the $BTC ticker + @operator mention the fake extracted).
  assert.ok(parsed.entities.tickers.includes('BTC'), 'merged tickers from comms-parser');
  assert.ok(parsed.entities.mentions.includes('operator'), 'merged mentions from comms-parser');
  // sentiment came from the injected scorer.
  assert.equal(parsed.sentiment.label, 'positive');
});

test('parseConversation is deterministic (same input → same id + output)', () => {
  const a = parseConversation(CONVO, { commsParser: makeFakeCommsParser(), ...DETERMINISTIC });
  const b = parseConversation(CONVO, { commsParser: makeFakeCommsParser(), ...DETERMINISTIC });
  assert.equal(a.id, b.id);
  assert.deepEqual(a.actionItems, b.actionItems);
  assert.equal(a.summary, b.summary);
});

test('toActionItems pulls "I\'ll X" / "can you Y" / "we need Z" with attribution', () => {
  const items = toActionItems(CONVO.messages);
  const texts = items.map((i) => i.text.toLowerCase());

  assert.ok(texts.some((t) => t.includes("i'll set up dns")), 'caught "I\'ll X"');
  assert.ok(texts.some((t) => t.includes('can you draft')), 'caught "can you Y"');
  assert.ok(texts.some((t) => t.includes('we need tls')), 'caught "we need Z"');
  assert.ok(texts.some((t) => t.includes('i will draft')), 'caught "I will X"');

  // attribution: every item carries who said it + when.
  for (const it of items) {
    assert.ok(it.from && typeof it.from === 'string', 'has from');
    assert.ok(it.ts === null || /\d{4}-\d{2}-\d{2}T/.test(it.ts), 'has ISO ts or null');
  }
  const dns = items.find((i) => i.text.toLowerCase().includes("i'll set up dns"));
  assert.equal(dns.from, 'operator');
  assert.equal(dns.ts, '2026-06-04T10:00:00Z');
});

test('toActionItems soft-handles junk input', () => {
  assert.deepEqual(toActionItems(null), []);
  assert.deepEqual(toActionItems([{}, { text: '' }, { from: 'x', text: 'just chatting, no asks here' }]), []);
});

test('toConversationFile writes an operator-tier record through the injected store', () => {
  const written = [];
  const store = { write(record) { written.push(record); return { ok: true, stored: true }; } };
  const parsed = parseConversation(CONVO, { commsParser: makeFakeCommsParser(), ...DETERMINISTIC });

  const res = toConversationFile(parsed, { store, ...DETERMINISTIC });
  assert.equal(res.ok, true);
  assert.equal(res.tier, 'operator');
  assert.equal(written.length, 1, 'wrote exactly one record');

  const rec = written[0];
  assert.equal(rec.tier, 'operator', 'record is operator-tier');
  assert.equal(rec.audience, 'operator');
  assert.equal(rec.kind, 'conversation');
  assert.equal(rec.id, parsed.id);
  assert.ok(rec.actionItems.length >= 2);
  assert.equal(rec.storedAt, '2026-06-04T12:00:00.000Z', 'used injected clock');
  assert.ok(typeof rec.markdown === 'string' && rec.markdown.includes('Action items'));
});

test('toConversationFile soft-fails (no throw) when no store is injected', () => {
  const parsed = parseConversation(CONVO, { commsParser: makeFakeCommsParser(), ...DETERMINISTIC });
  const res = toConversationFile(parsed, DETERMINISTIC);
  assert.equal(res.tier, 'operator');
  assert.ok('ok' in res);  // returns a receipt, does not throw
});

test('redactForAiTier removes an email / key / server-path (asserted ABSENT)', () => {
  const secrets = {
    source: 'chat',
    messages: [
      { from: 'operator', text: `We need to email user@example.com the key ${FAKE_KEY} before deploy.`, ts: '2026-06-04T10:00:00Z' },
      { from: 'operator', text: 'Can you copy the config at /etc/app/secrets/app.env on 5.252.53.79 first?', ts: '2026-06-04T10:01:00Z' },
    ],
  };
  const parsed = parseConversation(secrets, { commsParser: makeFakeCommsParser(), ...DETERMINISTIC });
  const safe = redactForAiTier(parsed);
  const blob = JSON.stringify(safe);

  assert.equal(safe.tier, 'ai');
  assert.equal(safe.redacted, true);
  assert.ok(!blob.includes('user@example.com'), 'email removed');
  assert.ok(!blob.includes(FAKE_KEY), 'key removed');
  assert.ok(!blob.includes('/etc/app/secrets'), 'server path removed');
  assert.ok(!blob.includes('5.252.53.79'), 'IP removed');
  assert.ok(blob.includes('[redacted]'), 'redaction marker present');

  // the original parsed object is NOT mutated (operator tier keeps the real text).
  assert.ok(JSON.stringify(parsed).includes('user@example.com'), 'operator-tier copy unchanged');
});

test('renderSummary emits MoM-shaped markdown', () => {
  const parsed = parseConversation(CONVO, { commsParser: makeFakeCommsParser(), ...DETERMINISTIC });
  const md = renderSummary(parsed);
  assert.ok(md.includes('## Conversation MoM'), 'has MoM heading');
  assert.ok(md.includes('### Decisions'), 'has Decisions section');
  assert.ok(md.includes('### Action items'), 'has Action items section');
  assert.ok(md.includes('### Open questions'), 'has Open questions section');
  assert.ok(md.includes('operator —'), 'action item attributed to operator');
});

test('works with the REAL comms-parser (defensive import, no injection)', () => {
  // no commsParser dep — exercises the defensive import of ./comms-parser.mjs (or the fallback).
  const parsed = parseConversation(CONVO, DETERMINISTIC);
  assert.ok(parsed.sentiment && typeof parsed.sentiment.score === 'number');
  assert.ok(parsed.entities && Array.isArray(parsed.entities.tickers));
  assert.ok(parsed.actionItems.length >= 2);
});
