/**
 * seeds.mjs — THE SEED MINT. The Melek-Engine contract that mints the Kush Farm seeds, which are PRANA assets
 * that mint THROUGH the engine. A seed is one of two kinds (operator 2026-06-22):
 *   - kind 'token' — a FUNGIBLE engine token (abundant strains, the daily "milk"): trade it, plant = burn it.
 *   - kind 'nft'   — a semi-fungible NFT (scarce rare/legendary strains): collectable, trait-bearing.
 *
 * This is a thin, deterministic FACADE over the `tokens` and `nft` contracts — it doesn't reimplement supply
 * math; it routes by the seed's registered kind. One mint surface mints both kinds:
 *   - register(symbol, kind, …) — bootstrap a seed: creates the underlying token OR defines the NFT type
 *     (creating the collection on first use). Only the configured seed `minter` (or genesis) may register.
 *   - mint(to, symbol, quantity) — issue seeds to a grower. Only the seed's minter. Routes token↔nft.
 *   - plant(symbol, quantity)    — the grower plants = BURNS the seed (the deflation sink). Routes token↔nft
 *     and records a plantLog the grow game reads.
 *
 * Auth (engine.mjs ACTIVE_REQUIRED): register/mint/plant all move supply or value → ACTIVE. Issuer auth flows
 * through the underlying contracts (ctx.sender must be the token/collection issuer), which holds because the
 * minter created them at register time.
 *
 * Returns { ok:true, … } / { ok:false, error }; never throws on user error.
 */

import { tokens } from './tokens.mjs';
import { nft } from './nft.mjs';
import { config } from '../config.mjs';

const SYMBOL_RE = /^[A-Z]{1,10}$/;
function err(error) { return { ok: false, error }; }
function ok(data = {}) { return { ok: true, ...data }; }

const getSeed = (state, symbol) => state.findOne('seeds', { symbol });

export const seeds = {
  /**
   * register — bootstrap one seed as an engine asset. Minter-gated.
   * payload: { symbol, kind?, name?, maxSupply, precision?, collection?, traits?, rarity?, growTier?, season?, capImmutable? }
   *   kind 'token' (default) → tokens.create(symbol, precision=config.seeds.tokenPrecision, maxSupply)
   *   kind 'nft'             → nft.createCollection (first use) + nft.defineType(tokenId=symbol, traits, maxSupply)
   */
  register(state, ctx, p) {
    const { sender } = ctx;
    if (!(ctx.genesis === true || sender === config.seeds.minter)) {
      return err(`only the seed minter (${config.seeds.minter}) may register seeds`);
    }
    const symbol = String(p.symbol || '').toUpperCase();
    if (!SYMBOL_RE.test(symbol)) return err(`invalid seed symbol "${p.symbol}" (1-10 uppercase A-Z)`);
    if (getSeed(state, symbol)) return err(`seed ${symbol} already registered`);

    const kind = p.kind === 'nft' ? 'nft' : 'token';
    const name = String(p.name || symbol).slice(0, 50);
    let collection = null;

    if (kind === 'token') {
      const precision = p.precision != null ? Number(p.precision) : config.seeds.tokenPrecision;
      const r = tokens.create(state, ctx, { symbol, name, precision, maxSupply: p.maxSupply, url: p.url });
      if (!r.ok) return r;
    } else {
      collection = String(p.collection || config.seeds.collection).toUpperCase();
      if (!state.findOne('nftCollections', { collection })) {
        const cr = nft.createCollection(state, ctx, { collection, name: `${collection} seeds`, url: p.url });
        if (!cr.ok) return cr;
      }
      const dr = nft.defineType(state, ctx, {
        collection, tokenId: symbol, name, traits: p.traits, maxSupply: p.maxSupply, capImmutable: p.capImmutable,
      });
      if (!dr.ok) return dr;
    }

    state.insert('seeds', {
      symbol, kind, name, minter: sender, collection,
      rarity: p.rarity || null, growTier: p.growTier || null, season: p.season || null,
      registeredBlock: ctx.blockNum,
    });
    return ok({ registered: symbol, kind, collection });
  },

  /**
   * mint — issue `quantity` of a seed to a grower. Minter-only. Routes by the seed's kind.
   * payload: { to, symbol, quantity }
   */
  mint(state, ctx, p) {
    const symbol = String(p.symbol || '').toUpperCase();
    const seed = getSeed(state, symbol);
    if (!seed) return err(`seed ${symbol || p.symbol} not registered`);
    if (ctx.sender !== seed.minter) return err(`only the seed minter (${seed.minter}) may mint ${symbol}`);
    const to = String(p.to || '');
    if (!to) return err('missing recipient');

    if (seed.kind === 'token') {
      const r = tokens.issue(state, ctx, { symbol, to, quantity: p.quantity });
      return r.ok ? ok({ minted: r.issued, symbol, kind: 'token', to }) : r;
    }
    const r = nft.mint(state, ctx, { collection: seed.collection, tokenId: symbol, to, quantity: p.quantity });
    return r.ok ? ok({ minted: r.minted, symbol, kind: 'nft', to, collection: seed.collection }) : r;
  },

  /**
   * plant — the grower plants a seed = BURNS it (the deflation sink). Routes token↔nft and records a plantLog
   * (the grow game / SeasonalFarm reads it to start the grow). Anyone may plant the seeds THEY hold.
   * payload: { symbol, quantity }
   */
  plant(state, ctx, p) {
    const { sender } = ctx;
    const symbol = String(p.symbol || '').toUpperCase();
    const seed = getSeed(state, symbol);
    if (!seed) return err(`seed ${symbol || p.symbol} not registered`);

    if (seed.kind === 'token') {
      const r = tokens.burn(state, ctx, { symbol, quantity: p.quantity });
      if (!r.ok) return r;
    } else {
      const r = nft.burn(state, ctx, { collection: seed.collection, tokenId: symbol, quantity: p.quantity });
      if (!r.ok) return r;
    }
    state.insert('plantLog', {
      account: sender, symbol, kind: seed.kind, quantity: String(p.quantity),
      block: ctx.blockNum, txId: ctx.txId,
    });
    return ok({ planted: String(p.quantity), symbol, kind: seed.kind });
  },
};
