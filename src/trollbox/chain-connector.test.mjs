// chain-connector.test.mjs — offline. Run: node --test src/trollbox/chain-connector.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CHAT_ID, encodeLine, decodeOp, pollInbound, replyOp, runOnce,
} from './chain-connector.mjs';

const lineOp = (user, text, ts = 0) =>
  ['custom_json', { id: CHAT_ID, json: JSON.stringify({ v: 1, user, text, ts }) }];

test('encodeLine validates, caps, and tags the payload', () => {
  const p = encodeLine({ user: 'x'.repeat(99), text: '  hi   there  ', ts: 5 });
  assert.equal(p.v, 1);
  assert.equal(p.user.length, 32);
  assert.equal(p.text, 'hi there');     // sanitized + collapsed
  assert.equal(p.ts, 5);
  assert.equal(encodeLine({}).text, '');
});

test('decodeOp parses a valid troll-box op and rejects others', () => {
  assert.deepEqual(decodeOp(lineOp('bob', 'hello')), { user: 'bob', text: 'hello', ts: 0 });
  // wrong id
  assert.equal(decodeOp(['custom_json', { id: 'other', json: '{}' }]), null);
  // not custom_json
  assert.equal(decodeOp(['vote', {}]), null);
  // empty text
  assert.equal(decodeOp(lineOp('bob', '   ')), null);
  // garbage json soft-fails
  assert.equal(decodeOp(['custom_json', { id: CHAT_ID, json: '{not json' }]), null);
  // history-row shape { op: [...] }
  assert.deepEqual(decodeOp({ op: lineOp('al', 'yo') }), { user: 'al', text: 'yo', ts: 0 });
});

test('pollInbound decodes, skips the bot’s own lines, soft-fails on a bad client', async () => {
  const client = {
    async customJsonHistory() {
      return [
        { seq: 1, op: lineOp('newbie', 'how do i sign up?') },
        { seq: 2, op: lineOp('hathor', 'our own line — must be skipped') },
        { seq: 3, op: lineOp('al', 'what is a key?') },
      ];
    },
  };
  const lines = await pollInbound(client, { since: 0 });
  assert.equal(lines.length, 2, 'bot line filtered out');
  assert.deepEqual(lines.map((l) => l.user), ['newbie', 'al']);
  assert.equal(lines[0].id, 1);
  // bad/empty client → []
  assert.deepEqual(await pollInbound(null), []);
  assert.deepEqual(await pollInbound({}), []);
  assert.deepEqual(await pollInbound({ customJsonHistory: async () => { throw new Error('rpc down'); } }), []);
});

test('replyOp is a posting-auth custom_json op tagged from the bot', () => {
  const op = replyOp({ user: 'newbie', text: 'welcome!' });
  assert.equal(op[0], 'custom_json');
  assert.equal(op[1].id, CHAT_ID);
  assert.deepEqual(op[1].required_posting_auths, ['hathor']);
  assert.deepEqual(op[1].required_auths, []);
  const j = JSON.parse(op[1].json);
  assert.equal(j.user, 'hathor');
  assert.equal(j.text, 'welcome!');
});

test('runOnce: routes a signup question, replies via injected broadcaster, advances cursor', async () => {
  const client = { async customJsonHistory() { return [{ seq: 7, op: lineOp('newbie', 'how do i sign up?') }]; } };
  const sent = [];
  const broadcaster = async ({ op, redactedLog }) => { sent.push({ op, redactedLog }); return { ok: true, id: 'tx1' }; };
  const r = await runOnce({ client, broadcaster });
  assert.equal(r.answered.length, 1);
  assert.equal(r.answered[0].to, 'newbie');
  assert.match(r.answered[0].reply, /sign up|signup|account/i);
  assert.equal(r.answered[0].broadcast.ok, true);
  assert.equal(r.cursor, 7);
  assert.equal(sent.length, 1, 'one reply broadcast through the signer');
  assert.equal(sent[0].op[0], 'custom_json');
  // custody-safe: the answer may reassure ("we never ask for your keys") but must never
  // INSTRUCT sharing one. Check the dangerous shapes, not the benign safety phrasing.
  assert.ok(!/(send|paste|share|give|type|enter)\b[^.]{0,40}\b(private key|wif|master password)/i.test(r.answered[0].reply),
    'never instructs sharing a key');
});

test('runOnce: no broadcaster → dry-run (nothing signed), still routes', async () => {
  const client = { async customJsonHistory() { return [{ seq: 9, op: lineOp('al', 'what is a key?') }]; } };
  const r = await runOnce({ client });
  assert.equal(r.dryRun, true);
  assert.equal(r.answered.length, 1);
  assert.equal(r.answered[0].broadcast.dryRun, true);
});

test('runOnce: idempotent — a seen line is not answered twice', async () => {
  const client = { async customJsonHistory() { return [{ seq: 5, op: lineOp('newbie', 'how do i sign up?') }]; } };
  const seen = new Set();
  const r1 = await runOnce({ client, seen });
  assert.equal(r1.answered.length, 1);
  const r2 = await runOnce({ client, seen });        // same seen set, same line
  assert.equal(r2.answered.length, 0, 'already answered → skipped');
});

test('runOnce soft-fails to empty on a broken client', async () => {
  const r = await runOnce({ client: { customJsonHistory: async () => { throw new Error('x'); } } });
  assert.deepEqual(r.answered, []);
});
