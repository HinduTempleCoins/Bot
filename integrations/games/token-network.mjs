// token-network.mjs — the extensive NFT/token network that ties the whole economy together and
// eventually PLUGS INTO GAMES TO BE BURNED.
//
// Every material and product across the economy (plant-catalog, plant-products, botanica,
// industrial-alchemical, aquatic-farm) becomes a NODE in one network:
//   • kind — 'token' (fungible bulk commodity/intermediate; ERC-20 / engine token) or
//            'nft' (unique / rare / trait-bearing / high-craft; ERC-1155). Same two-kind split as
//            seed-tokens.mjs, extended across the entire catalog.
//   • edges — the RECIPE graph (what produces/consumes it) + the GAME SINKS (which games burn it).
//
// The network's whole point: assets flow up the crafting chains, then DOWN into games where they are
// BURNED (the sink). This is the "recipe graph IS the economy" + "cross-game NFT portability" made
// concrete — one interconnected web of ~100 tokenized items feeding a portfolio of games.
//
// PURE aggregation over the other modules; burn() is a pure sink event (+ an optional in-mem ledger).
// Offline-tested.
//
//   import { buildNetwork, nodeKind, nodesByKind, sinksFor, produces, burn, networkStats } from './games/token-network.mjs'

import * as catalog from './plant-catalog.mjs';
import * as products from './plant-products.mjs';
import * as botanica from './botanica.mjs';
import * as ind from './industrial-alchemical.mjs';
import * as aqua from './aquatic-farm.mjs';
import { STRAINS as GENE_STRAINS } from './plant-genetics.mjs';
import { registerBuiltIns as loadDemands, gamesForMaterial } from './material-demand.mjs';

loadDemands(); // ensure the game-demand graph is populated

// ---------------------------------------------------------------------------
// Which items are NFTs (unique / rare / high-craft) vs tokens (fungible bulk). Rarity-aware.
// ---------------------------------------------------------------------------
const NFT_ITEMS = new Set([
  // botanica talismans/charms + any epic/legendary item
  ...botanica.ITEMS.filter((i) => ['talisman', 'charm'].includes(i.type) || ['epic', 'legendary'].includes(i.rarity)).map((i) => i.id),
  // unique / high-craft alchemical & premium goods
  'spagyric_elixir', 'perfume', 'essence', 'pearl',
  // strain lines (unique genetics) + a strain-nft slot (boost cards)
  ...Object.keys(GENE_STRAINS), 'strain-nft',
]);
export function nodeKind(item, meta = {}) {
  if (NFT_ITEMS.has(item)) return 'nft';
  if (['rare', 'epic', 'legendary', 'mythic'].includes(meta.rarity)) return 'nft';
  return 'token';
}

// ---------------------------------------------------------------------------
// Gather every item + its recipes across the modules.
// ---------------------------------------------------------------------------
function allRecipes() {
  return [
    ...products.RECIPES.map((r) => ({ ...r, source: 'plant-products' })),
    ...ind.RECIPES.map((r) => ({ ...r, source: 'industrial-alchemical' })),
    ...botanica.ITEM_RECIPES.map((r) => ({ ...r, source: 'botanica' })),
  ];
}

function allItems() {
  const items = new Map(); // item -> meta {domains?, rarity?}
  const add = (item, meta = {}) => { if (!items.has(item)) items.set(item, {}); Object.assign(items.get(item), meta); };
  for (const m of catalog.MATERIALS) add(m.item, { domains: m.domains, cls: 'plant-material' });
  for (const m of products.MATERIALS) add(m.item, { cls: 'material' });
  for (const p of products.PRODUCTS) add(p.item, { cls: 'product' });
  for (const k of Object.keys(ind.MATERIALS)) add(k, { domains: ind.MATERIALS[k], cls: 'industrial-alchemical' });
  for (const m of aqua.AQUATIC_MATERIALS) add(m.item, { domains: m.domains, cls: 'aquatic' });
  for (const i of botanica.ITEMS) add(i.id, { rarity: i.rarity, cls: 'botanica-item', itemType: i.type });
  for (const s of Object.keys(GENE_STRAINS)) add(s, { cls: 'strain', rarity: 'rare' });
  add('strain-nft', { cls: 'strain-nft', rarity: 'legendary' });
  return items;
}

// ---------------------------------------------------------------------------
// buildNetwork — nodes (item, kind, class, producedBy, consumedBy, burnedByGames) + edges.
// ---------------------------------------------------------------------------
export function buildNetwork() {
  const items = allItems();
  const recipes = allRecipes();
  const nodes = new Map();
  for (const [item, meta] of items) {
    nodes.set(item, {
      item, kind: nodeKind(item, meta), cls: meta.cls || 'item', domains: meta.domains || [],
      producedBy: [], consumedBy: [], burnedByGames: [],
    });
  }
  const ensure = (item) => { if (!nodes.has(item)) nodes.set(item, { item, kind: nodeKind(item), cls: 'external', domains: [], producedBy: [], consumedBy: [], burnedByGames: [] }); return nodes.get(item); };
  const edges = [];
  for (const r of recipes) {
    ensure(r.output.item).producedBy.push(r.id);
    for (const inp of r.inputs) {
      ensure(inp.item).consumedBy.push(r.id);
      edges.push({ type: 'craft', from: inp.item, to: r.output.item, recipe: r.id, source: r.source });
    }
  }
  // game sinks — where items get BURNED
  for (const [item, node] of nodes) {
    const games = gamesForMaterial(item);
    node.burnedByGames = games;
    for (const g of games) edges.push({ type: 'sink', from: item, to: g });
  }
  return { nodes, edges };
}

export const nodesByKind = (kind) => [...buildNetwork().nodes.values()].filter((n) => n.kind === kind);
export const sinksFor = (item) => buildNetwork().nodes.get(item)?.burnedByGames || [];
export const produces = (item) => buildNetwork().nodes.get(item)?.producedBy || [];

// ---------------------------------------------------------------------------
// burn — a game consumes/destroys an item (the terminal sink). PURE event + optional ledger.
// ---------------------------------------------------------------------------
const LEDGER = [];
export function burn(item, byGame, qty = 1) {
  const rec = { item, game: byGame, qty: Math.max(1, Math.round(qty)), kind: nodeKind(item) };
  LEDGER.push(rec);
  return rec;
}
export const burnLedger = () => [...LEDGER];

// ---------------------------------------------------------------------------
// networkStats — the shape of the web: node/edge counts, token vs NFT, and sink coverage
// (how many items actually plug into a game to be burned).
// ---------------------------------------------------------------------------
export function networkStats() {
  const { nodes, edges } = buildNetwork();
  const all = [...nodes.values()];
  const withSink = all.filter((n) => n.burnedByGames.length > 0);
  const craftable = all.filter((n) => n.producedBy.length > 0);
  return {
    nodes: all.length,
    tokens: all.filter((n) => n.kind === 'token').length,
    nfts: all.filter((n) => n.kind === 'nft').length,
    edges: edges.length,
    craftEdges: edges.filter((e) => e.type === 'craft').length,
    sinkEdges: edges.filter((e) => e.type === 'sink').length,
    craftable: craftable.length,
    plugIntoAGame: withSink.length,
    sinkCoverage: +(withSink.length / all.length).toFixed(2),
  };
}

if (process.argv[1] && process.argv[1].endsWith('token-network.mjs')) {
  console.log('NETWORK STATS:', networkStats());
  console.log('\nsample NFT nodes:', nodesByKind('nft').slice(0, 8).map((n) => n.item));
  console.log('items burned by Mushroom Warrior would include grain →', sinksFor('grain'));
  console.log('burn 3 grain in the ranch:', burn('grain', 'ranch', 3));
}
