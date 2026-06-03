// walletconnect-broker.test.mjs — OFFLINE tests. No network, no relay, no keys.
// Run: node --test integrations/walletconnect-broker.test.mjs

import { test } from 'node:test';
import assert from 'node:assert';

import {
  connect,
  approve,
  reject,
  disconnect,
  grantScope,
  getSession,
  listSessions,
  sessionAllows,
  BrokerError,
  SESSION_PENDING,
  SESSION_ACTIVE,
  SESSION_REJECTED,
  SESSION_DISCONNECTED,
} from './walletconnect-broker.mjs';

// ---- connect / CAIP-25 session-request shape -------------------------------

test('connect builds a CAIP-25 session request grouped by namespace', () => {
  const req = connect({ chains: ['eip155:1', 'eip155:137', 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'] });
  assert.equal(req.state, SESSION_PENDING);
  assert.match(req.id, /^wcreq_/);
  assert.ok(typeof req.createdAt === 'number');

  // namespaces grouped by CAIP namespace, with chains/methods/events arrays
  assert.ok(req.requiredNamespaces.eip155, 'has eip155 namespace');
  assert.deepEqual(req.requiredNamespaces.eip155.chains, ['eip155:1', 'eip155:137']);
  assert.ok(Array.isArray(req.requiredNamespaces.eip155.methods));
  assert.ok(req.requiredNamespaces.eip155.methods.includes('eth_sendTransaction'));
  assert.ok(Array.isArray(req.requiredNamespaces.eip155.events));
  assert.ok(req.requiredNamespaces.solana, 'has solana namespace');
});

test('connect honors explicit methods across chains', () => {
  const req = connect({ chains: ['eip155:1'], methods: ['personal_sign'] });
  assert.deepEqual(req.requiredNamespaces.eip155.methods, ['personal_sign']);
});

test('connect records transport per chain and supports optionalNamespaces', () => {
  const req = connect({ chains: ['eip155:1'], optionalChains: ['hive:melek'] });
  assert.equal(req.transports['eip155:1'], 'walletconnect');
  assert.equal(req.transports['hive:melek'], 'graphene');
  assert.ok(req.optionalNamespaces.hive, 'optional graphene namespace present');
});

test('connect rejects empty or invalid chains', () => {
  assert.throws(() => connect({ chains: [] }), BrokerError);
  assert.throws(() => connect({ chains: ['not a chain id'] }), BrokerError);
  assert.throws(() => connect({}), BrokerError);
});

// ---- Graphene namespace supported ------------------------------------------

test('Graphene namespace is a first-class supported namespace with Graphene ops', () => {
  const req = connect({ chains: ['hive:melek'] });
  assert.ok(req.requiredNamespaces.hive, 'graphene/hive namespace supported');
  const methods = req.requiredNamespaces.hive.methods;
  // standard Graphene ops only
  for (const op of ['comment', 'vote', 'transfer']) {
    assert.ok(methods.includes(op), `graphene methods include ${op}`);
  }
  assert.equal(req.transports['hive:melek'], 'graphene');
});

test('EVM and Graphene can be requested in one session', () => {
  const req = connect({ chains: ['eip155:1', 'hive:melek'] });
  assert.ok(req.requiredNamespaces.eip155);
  assert.ok(req.requiredNamespaces.hive);
});

// ---- approve / reject lifecycle --------------------------------------------

test('approve transitions request to an active session', () => {
  const req = connect({ chains: ['eip155:1'] });
  const ses = approve(req.id, { accounts: { 'eip155:1': ['0xabc0000000000000000000000000000000000abc'] } });
  assert.equal(ses.state, SESSION_ACTIVE);
  assert.match(ses.id, /^wcses_/);
  assert.deepEqual(ses.accounts['eip155:1'], ['0xabc0000000000000000000000000000000000abc']);
  assert.equal(getSession(ses.id).state, SESSION_ACTIVE);
});

test('approve narrows methods to wallet-granted subset', () => {
  const req = connect({ chains: ['eip155:1'], methods: ['eth_sendTransaction', 'personal_sign'] });
  const ses = approve(req.id, {
    accounts: { 'eip155:1': ['0xabc0000000000000000000000000000000000abc'] },
    methods: { 'eip155:1': ['personal_sign'] },
  });
  assert.deepEqual(ses.scopes['eip155:1'].methods, ['personal_sign']);
});

test('approve only grants chains the wallet supplied accounts for', () => {
  const req = connect({ chains: ['eip155:1', 'eip155:137'] });
  const ses = approve(req.id, { accounts: { 'eip155:1': ['0xabc0000000000000000000000000000000000abc'] } });
  assert.ok(ses.scopes['eip155:1']);
  assert.ok(!ses.scopes['eip155:137'], 'declined chain not in scope');
});

test('approve throws when no chains are granted accounts', () => {
  const req = connect({ chains: ['eip155:1'] });
  assert.throws(() => approve(req.id, { accounts: {} }), BrokerError);
});

test('reject marks the request rejected and consumes it', () => {
  const req = connect({ chains: ['eip155:1'] });
  const res = reject(req.id, 'user_rejected');
  assert.equal(res.state, SESSION_REJECTED);
  // request consumed: cannot approve or reject again
  assert.throws(() => approve(req.id, { accounts: { 'eip155:1': ['0xabc'] } }), BrokerError);
  assert.throws(() => reject(req.id), BrokerError);
});

test('cannot approve an unknown request', () => {
  assert.throws(() => approve('wcreq_nope', { accounts: { 'eip155:1': ['0xabc'] } }), BrokerError);
});

test('disconnect closes an active session', () => {
  const req = connect({ chains: ['eip155:1'] });
  const ses = approve(req.id, { accounts: { 'eip155:1': ['0xabc0000000000000000000000000000000000abc'] } });
  const closed = disconnect(ses.id);
  assert.equal(closed.state, SESSION_DISCONNECTED);
  assert.ok(typeof closed.closedAt === 'number');
  assert.throws(() => disconnect('wcses_nope'), BrokerError);
});

test('listSessions filters by state', () => {
  const before = listSessions({ state: SESSION_ACTIVE }).length;
  const req = connect({ chains: ['eip155:1'] });
  const ses = approve(req.id, { accounts: { 'eip155:1': ['0xabc0000000000000000000000000000000000abc'] } });
  assert.equal(listSessions({ state: SESSION_ACTIVE }).length, before + 1);
  disconnect(ses.id);
  assert.ok(listSessions({ state: SESSION_DISCONNECTED }).some((s) => s.id === ses.id));
});

// ---- grantScope returns capabilities, NEVER keys ---------------------------

test('grantScope returns per-chain capabilities, not keys', () => {
  const req = connect({ chains: ['eip155:1', 'hive:melek'] });
  const ses = approve(req.id, {
    accounts: {
      'eip155:1': ['0xabc0000000000000000000000000000000000abc'],
      'hive:melek': ['hathor'],
    },
  });
  const caps = grantScope(ses);

  // EVM capability
  assert.ok(caps['eip155:1']);
  assert.equal(caps['eip155:1'].transport, 'walletconnect');
  assert.equal(caps['eip155:1'].isEvm, true);
  assert.ok(Array.isArray(caps['eip155:1'].methods) && caps['eip155:1'].methods.length > 0);
  assert.deepEqual(caps['eip155:1'].accounts, ['0xabc0000000000000000000000000000000000abc']);

  // Graphene capability routes to the graphene signer boundary
  assert.ok(caps['hive:melek']);
  assert.equal(caps['hive:melek'].transport, 'graphene');
  assert.equal(caps['hive:melek'].isGraphene, true);
  assert.match(caps['hive:melek'].signsVia, /graphene-signer/);

  // No key/seed/secret material anywhere in the capability descriptor.
  const blob = JSON.stringify(caps).toLowerCase();
  for (const forbidden of ['privatekey', 'private_key', 'wif', 'seed', 'mnemonic', 'secret']) {
    assert.ok(!blob.includes(forbidden), `capability blob must not contain "${forbidden}"`);
  }
});

test('grantScope refuses non-active sessions', () => {
  const req = connect({ chains: ['eip155:1'] });
  const ses = approve(req.id, { accounts: { 'eip155:1': ['0xabc0000000000000000000000000000000000abc'] } });
  disconnect(ses.id);
  assert.throws(() => grantScope(ses), BrokerError);
  assert.throws(() => grantScope(null), BrokerError);
});

// ---- sessionAllows guard ---------------------------------------------------

test('sessionAllows reflects granted methods', () => {
  const req = connect({ chains: ['hive:melek'], methods: ['comment', 'vote'] });
  const ses = approve(req.id, { accounts: { 'hive:melek': ['hathor'] } });
  assert.equal(sessionAllows(ses, 'hive:melek', 'comment'), true);
  assert.equal(sessionAllows(ses, 'hive:melek', 'transfer'), false);
  disconnect(ses.id);
  assert.equal(sessionAllows(ses, 'hive:melek', 'comment'), false, 'closed session allows nothing');
});
