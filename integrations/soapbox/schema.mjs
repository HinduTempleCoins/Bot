// schema.mjs — SoapBox's ONE normalized coin-page schema (brief §7) + normalize/validate.
// The condenser owns this shape; Tiers 1/2/3 all map INTO it; the site, Hathor, and the trade
// bots all read it. One source of truth — so the schema, not any feeder, is the contract.

// the canonical empty coin — every field the brief §7 names, with safe defaults.
export function emptyCoin() {
  return {
    id: '', symbol: '', name: '',
    source_tier: null,          // 1=third-party, 2=hive-engine, 3=native
    source: '',                 // coingecko|coinpaprika|geckoterminal|hive-engine|node:melek|node:soap
    price_usd: 0, market_cap_usd: 0, volume_24h_usd: 0,
    supply: { circulating: 0, total: 0, max: 0 },
    chains: [], contracts: [],
    links: { website: '', explorer: '', social: [] },
    team: [],
    ohlcv: [],
    clarity_score: { value: null, inputs: ['holder_dist', 'supply_locks', 'contract_behavior', 'activity'], computed_at: '' },
    comments_ref: '',
    updated_at: '',
  };
}

const num = (v, d = 0) => (Number.isFinite(+v) ? +v : d);
const str = (v, d = '') => (v == null ? d : String(v));

/**
 * Map partial raw tier data into the canonical schema. Never throws — fills defaults so a
 * thin feeder (price only) and a rich one (full metadata) both produce a valid coin object.
 * `updatedAt` is injected (schemas must be deterministic — caller stamps the time).
 */
export function normalizeCoin(raw = {}, { tier, source, updatedAt = '' } = {}) {
  const c = emptyCoin();
  c.id = str(raw.id || raw.symbol).toLowerCase();
  c.symbol = str(raw.symbol).toUpperCase();
  c.name = str(raw.name || raw.symbol);
  c.source_tier = tier ?? raw.source_tier ?? null;
  c.source = str(source || raw.source);
  c.price_usd = num(raw.price_usd ?? raw.price);
  c.market_cap_usd = num(raw.market_cap_usd ?? raw.market_cap);
  c.volume_24h_usd = num(raw.volume_24h_usd ?? raw.volume_24h);
  if (raw.supply) c.supply = { circulating: num(raw.supply.circulating), total: num(raw.supply.total), max: num(raw.supply.max) };
  c.chains = Array.isArray(raw.chains) ? raw.chains.map(str) : [];
  c.contracts = Array.isArray(raw.contracts) ? raw.contracts.map((x) => ({ chain: str(x.chain), address: str(x.address) })) : [];
  if (raw.links) c.links = { website: str(raw.links.website), explorer: str(raw.links.explorer), social: Array.isArray(raw.links.social) ? raw.links.social.map(str) : [] };
  if (Array.isArray(raw.team)) c.team = raw.team.map((t) => ({ name: str(t.name), role: str(t.role), social: str(t.social) }));
  if (Array.isArray(raw.ohlcv)) c.ohlcv = raw.ohlcv;
  if (raw.clarity_score) c.clarity_score = { ...c.clarity_score, ...raw.clarity_score };
  c.comments_ref = str(raw.comments_ref || (c.id ? `coin:${c.id}` : ''));
  c.updated_at = str(updatedAt);
  return c;
}

/** Validate a coin object against the schema contract. Returns { valid, errors }. */
export function validateCoin(coin) {
  const errors = [];
  if (!coin || typeof coin !== 'object') return { valid: false, errors: ['not an object'] };
  if (!coin.id) errors.push('id is required');
  if (!coin.symbol) errors.push('symbol is required');
  if (![1, 2, 3].includes(coin.source_tier)) errors.push('source_tier must be 1, 2, or 3');
  if (!coin.source) errors.push('source is required');
  for (const f of ['price_usd', 'market_cap_usd', 'volume_24h_usd']) {
    if (!Number.isFinite(coin[f])) errors.push(`${f} must be a number`);
  }
  if (!coin.supply || typeof coin.supply !== 'object') errors.push('supply must be an object');
  if (!Array.isArray(coin.chains)) errors.push('chains must be an array');
  return { valid: errors.length === 0, errors };
}
