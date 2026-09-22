// session-memory.test.mjs — fully offline. No network, no disk, no model.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseTurns, extractFacts, mergeMemory, renderMemory, recall, ingestTranscript, handler, esc, KINDS,
} from './session-memory.mjs';

const T0 = 1_700_000_000_000;
const DAY = 86_400_000;

const row = (role, text) => JSON.stringify({ message: { role, content: [{ type: 'text', text }] } });

function fakeRes() {
  return {
    code: 0, body: '',
    writeHead(c) { this.code = c; },
    end(b) { this.body = b || ''; },
  };
}

test('parseTurns survives a transcript being written to', () => {
  const jsonl = [
    row('user', 'first'),
    '',
    '{"message":{"role":"assistant","content":[{"type":"thinking"}]}}',   // thinking-only → no text
    '{"not":"json"',                                                      // half-written final line
    row('assistant', 'second'),
    JSON.stringify({ message: { role: 'user', content: '[Request interrupted by user]' } }),
  ].join('\n');
  const turns = parseTurns(jsonl);
  assert.equal(turns.length, 2);
  assert.deepEqual(turns.map((t) => t.text), ['first', 'second']);
});

test('parseTurns handles string content and ignores tool rows', () => {
  const jsonl = [
    JSON.stringify({ message: { role: 'user', content: 'plain string' } }),
    JSON.stringify({ message: { role: 'assistant', content: [{ type: 'tool_use', input: {} }] } }),
  ].join('\n');
  const turns = parseTurns(jsonl);
  assert.equal(turns.length, 1);
  assert.equal(turns[0].text, 'plain string');
});

test('parseTurns never throws on garbage', () => {
  assert.deepEqual(parseTurns(null), []);
  assert.deepEqual(parseTurns(''), []);
  assert.deepEqual(parseTurns('not json at all'), []);
});

test('extractFacts keeps corrections and directives, drops chat', async () => {
  const turns = parseTurns([
    row('user', 'Do not put it in a Repo. Not somewhere Public.'),
    row('user', 'how is it going'),                                   // ordinary chat → dropped
    row('user', 'That is not what we want, you are not allowed to do that.'),
    row('assistant', 'Verified: port 111 is closed and fail2ban banned 83 sources.'),
    row('assistant', 'The send was blocked and I cannot reach the vault.'),
    row('assistant', 'Here is a summary of the options.'),             // narration → dropped
  ].join('\n'));
  const facts = await extractFacts(turns, { session: 's1', at: T0 });
  const kinds = facts.map((f) => f.kind);
  assert.ok(kinds.includes('decision'));      // the correction
  assert.ok(kinds.includes('directive'));     // "do not"
  assert.ok(kinds.includes('outcome'));       // "verified"
  assert.ok(kinds.includes('blocker'));       // "blocked"/"cannot"
  assert.equal(facts.length, 4);              // the two non-durable turns are gone
  assert.ok(facts.every((f) => KINDS.includes(f.kind)));
});

test('extractFacts dedupes a repeated instruction into one fact', async () => {
  const turns = parseTurns([
    row('user', 'Never put it in a repo.'),
    row('user', 'Never put it in a repo!'),                           // same fact, different punctuation
  ].join('\n'));
  const facts = await extractFacts(turns, { at: T0 });
  assert.equal(facts.length, 1);
});

test('refine may rewrite phrasing but never changes the fact set', async () => {
  const turns = parseTurns(row('user', 'Do not put it in a repo.'));
  const ok = await extractFacts(turns, { at: T0, refine: async (texts) => texts.map((t) => `POLISHED: ${t}`) });
  assert.equal(ok.length, 1);
  assert.match(ok[0].text, /^POLISHED:/);

  const wrongCount = await extractFacts(turns, { at: T0, refine: async () => ['a', 'b'] });
  assert.equal(wrongCount[0].text, 'Do not put it in a repo.');       // mismatched length ignored

  const threw = await extractFacts(turns, { at: T0, refine: async () => { throw new Error('model down'); } });
  assert.equal(threw.length, 1);                                       // soft-fail, fact survives
  assert.equal(threw[0].text, 'Do not put it in a repo.');
});

test('mergeMemory lets a newer statement correct an older one', () => {
  const older = [{ key: 'use gmail', kind: 'directive', text: 'Use gmail.', at: T0 }];
  const newer = [{ key: 'use gmail', kind: 'directive', text: 'Use gmail.', at: T0 + DAY }];
  const merged = mergeMemory(older, newer);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].at, T0 + DAY);                                // newest wins
});

test('mergeMemory caps newest-first and drops keyless junk', () => {
  const many = Array.from({ length: 10 }, (_, i) => ({ key: `k${i}`, kind: 'outcome', text: `f${i}`, at: T0 + i }));
  const merged = mergeMemory([{ kind: 'outcome', text: 'no key' }], many, { max: 3 });
  assert.equal(merged.length, 3);
  assert.deepEqual(merged.map((f) => f.text), ['f9', 'f8', 'f7']);
});

test('renderMemory groups by kind, escapes, and handles empty', () => {
  const md = renderMemory([
    { kind: 'decision', text: 'No <script> in a repo', at: T0 },
    { kind: 'blocker', text: 'Vault unreachable', at: T0 },
  ], { at: T0 });
  assert.match(md, /## Decisions and corrections/);
  assert.match(md, /## Open blockers/);
  assert.match(md, /&lt;script&gt;/);                                   // escaped, not raw
  assert.doesNotMatch(md, /<script>/);
  assert.match(renderMemory([], { at: T0 }), /No durable facts recorded yet/);
});

test('recall ranks by term overlap, kind weight and recency', async () => {
  const facts = [
    { kind: 'outcome', text: 'the pool has miners', at: T0 - 200 * DAY, key: 'a' },
    { kind: 'decision', text: 'the pool must never be public', at: T0, key: 'b' },
    { kind: 'outcome', text: 'unrelated thing', at: T0, key: 'c' },
  ];
  const hits = await recall('pool', facts, { k: 2, now: T0 });
  assert.equal(hits.length, 2);
  assert.equal(hits[0].key, 'b');                                       // decision + recent outranks old outcome
  assert.ok(hits.every((h) => h.key !== 'c'));                          // no term overlap → excluded
});

test('recall prefers an injected embedder but falls back when it fails', async () => {
  const facts = [{ kind: 'outcome', text: 'pool', at: T0, key: 'a' }];
  const viaEmbed = await recall('pool', facts, { embedRecall: async () => [{ key: 'from-embedder' }] });
  assert.equal(viaEmbed[0].key, 'from-embedder');

  const fell = await recall('pool', facts, { embedRecall: async () => { throw new Error('no db'); }, now: T0 });
  assert.equal(fell[0].key, 'a');                                       // deterministic floor still answers

  const empty = await recall('pool', facts, { embedRecall: async () => [], now: T0 });
  assert.equal(empty[0].key, 'a');                                      // empty result also falls through
});

test('ingestTranscript runs the whole loop end to end', async () => {
  const jsonl = [
    row('user', 'Do not put it in a repo.'),
    row('assistant', 'Verified: the snapshot is immutable.'),
  ].join('\n');
  const r = await ingestTranscript(jsonl, { session: 's1', at: T0 });
  assert.equal(r.turns, 2);
  assert.equal(r.facts.length, 2);
  assert.equal(r.memory.length, 2);
  assert.match(r.markdown, /Standing directives/);
  assert.match(r.markdown, /Verified outcomes/);

  const second = await ingestTranscript(row('user', 'Never use email.'), {
    session: 's2', at: T0 + DAY, existing: r.memory,
  });
  assert.equal(second.memory.length, 3);                                // accrues across sessions
});

test('handler: healthz, recall, unknown route, and never throwing', async () => {
  const ok = fakeRes();
  await handler({ url: '/healthz', method: 'GET', headers: {} }, ok);
  assert.equal(ok.code, 200);
  assert.equal(JSON.parse(ok.body).ok, true);

  const r = fakeRes();
  await handler({ url: '/recall?q=pool', method: 'GET', headers: {} }, r);
  assert.equal(r.code, 200);
  assert.ok(Array.isArray(JSON.parse(r.body).hits));

  const missing = fakeRes();
  await handler({ url: '/nope', method: 'GET', headers: {} }, missing);
  assert.equal(missing.code, 404);

  const bad = fakeRes();
  await handler({ url: null, method: 'GET', headers: {} }, bad);
  assert.equal(JSON.parse(bad.body).ok, false);
});

test('esc escapes every vector', () => {
  assert.equal(esc(`<&">'`), '&lt;&amp;&quot;&gt;&#39;');
  assert.equal(esc(undefined), '');
});
