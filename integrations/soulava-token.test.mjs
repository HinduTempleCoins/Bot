// soulava-token.test.mjs — offline. `node --test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SOULAVA, soulavaSpec, announcement, status, mintOp, launchBundle } from './soulava-token.mjs';

test('SOULAVA builds a VALID SCOT token spec through the engine builder', () => {
  const r = soulavaSpec();
  assert.equal(r.ok, true, r.errors && r.errors.join('; '));
  assert.equal(r.spec.symbol, SOULAVA.symbol);
  assert.equal(r.spec.precision, 3);
  assert.equal(r.spec.authorCuratorSplit.author, 65);
  assert.ok(r.spec.tags.includes('delegation'));
});

test('announcement is HONEST about status: design until minted', () => {
  const draft = announcement();
  assert.match(draft, /not minted yet|design/i);
  assert.match(draft, /SOULAVA/);
  const live = announcement({ minted: true });
  assert.match(live, /is live/i);
});

test('announcement teaches the full mechanism (delegate → mine + share + direct votes; SCOT)', () => {
  const a = announcement({ pool: 'hathor' });
  assert.match(a, /Delegate/i);
  assert.match(a, /mining SOUL/i);
  assert.match(a, /share of everything the pool earns/i);
  assert.match(a, /!vote/);
  assert.match(a, /SCOT token/);
  assert.match(a, /undelegate whenever/i);
});

test('mintOp builds a valid MELEK-Engine createTribe op (SOULAVA distributes on MELEK)', () => {
  const r = mintOp('hathor');
  assert.equal(r.ok, true, r.error);
  assert.equal(r.action, 'createTribe');
  assert.equal(r.envelope.contractName, 'scot');
  assert.equal(r.envelope.contractPayload.symbol, 'SOUL');
  assert.equal(r.envelope.contractPayload.authorBps, 6500);   // 65/35
  assert.equal(r.op[0], 'custom_json');                       // a Graphene custom_json to the engine
});

test('launchBundle assembles the mint op + announcement + status for a deploy step', () => {
  const b = launchBundle({ account: 'hathor' });
  assert.equal(b.mint.ok, true);
  assert.match(b.announcement, /SOULAVA/);
  assert.equal(b.token.chain, 'MELEK-Engine');
});

test('status: SCOT on MELEK-Engine, pairs with MWALI, design until minted', () => {
  assert.deepEqual(status(), { name: 'SOULAVA', symbol: 'SOUL', kind: 'SCOT', chain: 'MELEK-Engine', status: 'design', pairsWith: 'MWALI', role: 'delegation-mining reward' });
  assert.equal(status({ minted: true }).status, 'live');
});
