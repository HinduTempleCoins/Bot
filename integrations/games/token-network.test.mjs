// token-network.test.mjs — offline. `node --test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildNetwork, nodeKind, nodesByKind, sinksFor, produces, burn, burnLedger, networkStats,
} from './token-network.mjs';

test('the network aggregates the whole economy into nodes + edges', () => {
  const { nodes, edges } = buildNetwork();
  assert.ok(nodes.size >= 50, `only ${nodes.size} nodes`);
  assert.ok(edges.length >= 40);
  for (const n of nodes.values()) assert.ok(['token', 'nft'].includes(n.kind));
});

test('kind split: bulk commodities are tokens; unique/rare/high-craft are NFTs', () => {
  assert.equal(nodeKind('grain'), 'token');
  assert.equal(nodeKind('fiber'), 'token');
  assert.equal(nodeKind('talisman_verdant'), 'nft');
  assert.equal(nodeKind('spagyric_elixir'), 'nft');
  assert.equal(nodeKind('pearl'), 'nft');
  assert.equal(nodeKind('perfume'), 'nft');
  assert.equal(nodeKind('anything', { rarity: 'legendary' }), 'nft');
});

test('nodes carry both crafting edges and game-sink edges', () => {
  // paper is produced by a recipe (craft edge in)
  assert.ok(produces('paper').length >= 1);
  // grain is burned by games (sink edges out)
  const gs = sinksFor('grain');
  assert.ok(gs.length >= 1 && gs.includes('ranch'));
});

test('networkStats: tokens + nfts = nodes, and items PLUG INTO GAMES to be burned', () => {
  const s = networkStats();
  assert.equal(s.tokens + s.nfts, s.nodes);
  assert.ok(s.nfts > 0, 'there should be NFT nodes');
  assert.ok(s.craftable > 0, 'many nodes are craftable');
  assert.ok(s.plugIntoAGame > 0, 'some nodes are burned by a game (the sink)');
  assert.ok(s.craftEdges > 0 && s.sinkEdges > 0);
});

test('burn is the terminal sink — a game destroys an item, logged', () => {
  const before = burnLedger().length;
  const r = burn('grain', 'ranch', 3);
  assert.equal(r.item, 'grain');
  assert.equal(r.game, 'ranch');
  assert.equal(r.qty, 3);
  assert.equal(r.kind, 'token');
  assert.equal(burnLedger().length, before + 1);
  assert.equal(burn('talisman_verdant', 'kush-farm').kind, 'nft');
});
