// credential-anchor.test.mjs — offline tests for the on-chain credential anchor. No network, no keys.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ANCHOR_ID, anchorPayload, anchorOp, anchorRef, applyAnchor, parseAnchorRecord, verifyAnchor, broadcastAnchor,
} from './credential-anchor.mjs';
import { issueCredential } from './credentials-issuer.mjs';

const cred = () => issueCredential({ programId: 'angelic-ai-foundations', recipientName: 'Sam', now: new Date('2026-08-28') }).credential;

test('anchorPayload carries id+hash+issuer+program+issuedAt — and NEVER the recipient name (privacy)', () => {
  const c = cred();
  const p = anchorPayload(c);
  assert.equal(p.id, c.id);
  assert.equal(p.hash, c.verification.hash);
  assert.equal(p.issuer, 'academy');
  assert.equal(p.program, 'angelic-ai-foundations');
  const s = JSON.stringify(p);
  assert.doesNotMatch(s, /Sam/);           // recipient name must not be on-chain
  assert.doesNotMatch(s, /recipient/i);
});

test('anchorOp is a valid posting-auth custom_json op', () => {
  const op = anchorOp(cred(), { anchorer: 'hathor' });
  assert.equal(op[0], 'custom_json');
  assert.deepEqual(op[1].required_auths, []);
  assert.deepEqual(op[1].required_posting_auths, ['hathor']);
  assert.equal(op[1].id, ANCHOR_ID);
  const j = JSON.parse(op[1].json);
  assert.equal(j.v, 1);
});

test('anchorOp/anchorPayload soft-fail on a non-credential', () => {
  assert.equal(anchorOp(null), null);
  assert.equal(anchorPayload({}), null);
});

test('applyAnchor records the tx reference in verification.anchor', () => {
  const a = applyAnchor(cred(), { tx: 'abc123', block: 784500 });
  assert.equal(a.verification.anchor, `melek:${ANCHOR_ID}:abc123@784500`);
  assert.equal(a.verification.anchorTx, 'abc123');
  assert.equal(a.verification.anchorBlock, 784500);
});

test('verifyAnchor: a matching on-chain record confirms the credential', () => {
  const c = cred();
  const record = JSON.stringify(anchorPayload(c));
  assert.equal(verifyAnchor(c, record).anchored, true);
  assert.equal(verifyAnchor(c, anchorPayload(c)).anchored, true);  // object form too
});

test('verifyAnchor: tampering (hash change) is caught', () => {
  const c = cred();
  const record = JSON.stringify(anchorPayload(c));
  const forged = { ...c, verification: { ...c.verification, hash: 'other' } };
  const v = verifyAnchor(forged, record);
  assert.equal(v.anchored, false);
  assert.match(v.reason, /hash-mismatch/);
});

test('verifyAnchor: wrong id / missing record / non-credential all soft-fail', () => {
  const c = cred();
  assert.equal(verifyAnchor(c, JSON.stringify({ id: 'OTHER', hash: c.verification.hash })).anchored, false);
  assert.equal(verifyAnchor(c, 'not-json').anchored, false);
  assert.equal(verifyAnchor(c, null).anchored, false);
  assert.equal(verifyAnchor({}, JSON.stringify(anchorPayload(c))).anchored, false);
});

test('parseAnchorRecord handles string, object, and garbage', () => {
  const c = cred();
  assert.ok(parseAnchorRecord(JSON.stringify(anchorPayload(c))));
  assert.ok(parseAnchorRecord(anchorPayload(c)));
  assert.equal(parseAnchorRecord('{'), null);
  assert.equal(parseAnchorRecord({ nope: 1 }), null);
});

test('broadcastAnchor is GATED: no broadcaster -> refuses, no throw', async () => {
  const r = await broadcastAnchor(cred(), {});
  assert.equal(r.ok, false);
  assert.match(r.reason, /gated/);
});

test('broadcastAnchor: an injected broadcaster anchors + returns the updated credential', async () => {
  const c = cred();
  const broadcaster = async (ops) => { assert.equal(ops[0][0], 'custom_json'); return { id: 'txhash123', block_num: 784600 }; };
  const r = await broadcastAnchor(c, { broadcaster });
  assert.equal(r.ok, true);
  assert.equal(r.tx, 'txhash123');
  assert.equal(r.credential.verification.anchorTx, 'txhash123');
  // and it verifies against its own on-chain payload
  assert.equal(verifyAnchor(r.credential, JSON.stringify(anchorPayload(c))).anchored, true);
});

test('broadcastAnchor: a throwing broadcaster soft-fails', async () => {
  const r = await broadcastAnchor(cred(), { broadcaster: async () => { throw new Error('rpc down'); } });
  assert.equal(r.ok, false);
  assert.match(r.reason, /broadcast-failed:rpc down/);
});
