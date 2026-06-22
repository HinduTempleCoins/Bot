/**
 * nft.mjs — the Melek-Engine NFT contract (semi-fungible, ERC-1155-style).
 *
 * The engine had only fungible `tokens`; this adds NFTs so the Seed Mint (see seeds.mjs) can mint the scarce,
 * trait-bearing seeds. Design mirrors the tokens contract's hardening:
 *   - issuer auth comes ONLY from the L1 op's signer (ctx.sender), never the payload.   [tokens §6 A item 1]
 *   - mint/define are issuer-restricted; an optional immutable per-type edition cap.      [§6 F item 14]
 *   - all counts are BigInt integers (NFTs are whole editions — no fractional supply).    [§6 B item 6]
 *   - an append-only issuance log per collection.                                          [§6 F item 14]
 *
 * Model (semi-fungible, the same shape as PRANA's SeasonalFarm ERC-1155):
 *   - a COLLECTION (symbol, e.g. KUSHSEED) has an issuer.
 *   - within it, each TYPE (tokenId, e.g. VANKUSH) carries traits + an edition supply/cap.
 *   - an account holds a COUNT of a given (collection, tokenId) — "you own ×3 Van Kush".
 *
 * Every action returns { ok:true, ... } or { ok:false, error }. Mutations only on ok:true. Never throws on
 * user error (returns ok:false); throws only on internal invariant violation.
 */

const SYMBOL_RE = /^[A-Z]{1,10}$/;

function err(error) { return { ok: false, error }; }
function ok(data = {}) { return { ok: true, ...data }; }

/** Parse a positive-integer edition count string into BigInt (NFTs are whole). null on bad input. */
function toCount(q) {
  const s = String(q == null ? '' : q).trim();
  if (!/^\d+$/.test(s)) return null;
  const n = BigInt(s);
  return n > 0n ? n : null;
}

const getCollection = (state, collection) => state.findOne('nftCollections', { collection });
const getType = (state, collection, tokenId) => state.findOne('nftTypes', { collection, tokenId });
const getNftBal = (state, account, collection, tokenId) => state.findOne('nftBalances', { account, collection, tokenId });

function setNftCount(state, account, collection, tokenId, count) {
  let row = getNftBal(state, account, collection, tokenId);
  if (!row) {
    row = { account, collection, tokenId, count: '0' };
    state.insert('nftBalances', row);
  }
  row.count = count.toString();
  return row;
}

/** Strip a traits object down to JSON-safe scalars (deterministic, no functions/nested refs surprises). */
function safeTraits(traits) {
  if (!traits || typeof traits !== 'object') return {};
  const out = {};
  for (const [k, v] of Object.entries(traits)) {
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' || v === null) out[String(k)] = v;
  }
  return out;
}

export const nft = {
  /**
   * createCollection — register an NFT collection. issuer = the L1 signer.
   * payload: { collection, name?, url? }
   */
  createCollection(state, ctx, p) {
    const { sender } = ctx;
    const collection = String(p.collection || '').toUpperCase();
    if (!SYMBOL_RE.test(collection)) return err(`invalid collection "${p.collection}" (1-10 uppercase A-Z)`);
    if (getCollection(state, collection)) return err(`collection ${collection} already exists`);
    state.insert('nftCollections', {
      collection,
      name: String(p.name || collection).slice(0, 50),
      issuer: sender,
      url: typeof p.url === 'string' ? p.url.slice(0, 255) : '',
      createdBlock: ctx.blockNum,
    });
    return ok({ createdCollection: collection });
  },

  /**
   * defineType — register one NFT TYPE (token id) within a collection, with traits + an optional edition cap.
   * Issuer-only. maxSupply '0' (default) = uncapped; a positive integer caps editions forever.
   * payload: { collection, tokenId, name?, traits?, maxSupply?, capImmutable? }
   */
  defineType(state, ctx, p) {
    const { sender } = ctx;
    const collection = String(p.collection || '').toUpperCase();
    const col = getCollection(state, collection);
    if (!col) return err(`no such collection ${collection}`);
    if (col.issuer !== sender) return err(`only issuer (${col.issuer}) can define types in ${collection}`);
    const tokenId = String(p.tokenId || '').toUpperCase();
    if (!SYMBOL_RE.test(tokenId)) return err(`invalid tokenId "${p.tokenId}" (1-10 uppercase A-Z)`);
    if (getType(state, collection, tokenId)) return err(`type ${collection}:${tokenId} already exists`);

    let maxSupply = 0n;
    if (p.maxSupply != null && String(p.maxSupply) !== '0') {
      const m = toCount(p.maxSupply);
      if (m == null) return err(`bad maxSupply "${p.maxSupply}" (positive integer or 0 for uncapped)`);
      maxSupply = m;
    }
    state.insert('nftTypes', {
      collection,
      tokenId,
      name: String(p.name || tokenId).slice(0, 50),
      traits: safeTraits(p.traits),
      maxSupply: maxSupply.toString(),
      capImmutable: p.capImmutable === true,
      supply: '0',
      createdBlock: ctx.blockNum,
    });
    return ok({ definedType: tokenId, collection });
  },

  /**
   * mint — issue `quantity` editions of a type to `to`. Issuer-only. Respects an edition cap if set.
   * payload: { collection, tokenId, to, quantity }
   */
  mint(state, ctx, p) {
    const { sender } = ctx;
    const collection = String(p.collection || '').toUpperCase();
    const col = getCollection(state, collection);
    if (!col) return err(`no such collection ${collection}`);
    if (col.issuer !== sender) return err(`only issuer (${col.issuer}) can mint ${collection}`);
    const tokenId = String(p.tokenId || '').toUpperCase();
    const type = getType(state, collection, tokenId);
    if (!type) return err(`no such type ${collection}:${tokenId}`);
    const to = String(p.to || '');
    if (!to) return err('missing recipient');
    const amount = toCount(p.quantity);
    if (amount == null) return err(`quantity must be a positive integer (editions)`);

    const cap = BigInt(type.maxSupply);
    const newSupply = BigInt(type.supply) + amount;
    if (cap > 0n && newSupply > cap) {
      return err(`mint would exceed edition cap${type.capImmutable ? ' (immutable)' : ''} of ${type.maxSupply}`);
    }
    type.supply = newSupply.toString();
    const row = getNftBal(state, to, collection, tokenId);
    setNftCount(state, to, collection, tokenId, (row ? BigInt(row.count) : 0n) + amount);
    state.insert('nftIssuanceLog', {
      collection, tokenId, to, quantity: amount.toString(), issuer: sender, block: ctx.blockNum, txId: ctx.txId,
    });
    return ok({ minted: amount.toString(), collection, tokenId, to });
  },

  /**
   * transfer — move editions between accounts.
   * payload: { collection, tokenId, to, quantity }
   */
  transfer(state, ctx, p) {
    const { sender } = ctx;
    const collection = String(p.collection || '').toUpperCase();
    const tokenId = String(p.tokenId || '').toUpperCase();
    if (!getType(state, collection, tokenId)) return err(`no such type ${collection}:${tokenId}`);
    const to = String(p.to || '');
    if (!to) return err('missing recipient');
    if (to === sender) return err('cannot transfer to self');
    const amount = toCount(p.quantity);
    if (amount == null) return err('quantity must be a positive integer (editions)');
    const fromRow = getNftBal(state, sender, collection, tokenId);
    if (!fromRow || BigInt(fromRow.count) < amount) return err('insufficient editions');
    setNftCount(state, sender, collection, tokenId, BigInt(fromRow.count) - amount);
    const toRow = getNftBal(state, to, collection, tokenId);
    setNftCount(state, to, collection, tokenId, (toRow ? BigInt(toRow.count) : 0n) + amount);
    return ok({ transferred: amount.toString(), collection, tokenId, from: sender, to });
  },

  /**
   * burn — destroy editions the sender holds (reduces the type's live supply). This is what "plant a seed"
   * resolves to for NFT-kind seeds (seeds.plant → nft.burn).
   * payload: { collection, tokenId, quantity }
   */
  burn(state, ctx, p) {
    const { sender } = ctx;
    const collection = String(p.collection || '').toUpperCase();
    const tokenId = String(p.tokenId || '').toUpperCase();
    const type = getType(state, collection, tokenId);
    if (!type) return err(`no such type ${collection}:${tokenId}`);
    const amount = toCount(p.quantity);
    if (amount == null) return err('quantity must be a positive integer (editions)');
    const row = getNftBal(state, sender, collection, tokenId);
    if (!row || BigInt(row.count) < amount) return err('insufficient editions to burn');
    setNftCount(state, sender, collection, tokenId, BigInt(row.count) - amount);
    type.supply = (BigInt(type.supply) - amount).toString();
    state.insert('nftBurnLog', { collection, tokenId, account: sender, quantity: amount.toString(), block: ctx.blockNum, txId: ctx.txId });
    return ok({ burned: amount.toString(), collection, tokenId });
  },
};
