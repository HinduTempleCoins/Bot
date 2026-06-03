// nft-search.mjs — blockchain/NFT file search for SoapBox (queue #132). The web is drowning in
// minted spam-JPEGs; the value-add here is NOT another NFT browser, it's a CLARITY SPAM FILTER that
// ranks tokens by observable provenance so a real document/book on-chain floats above the noise.
//
// Indexing is soft-fail and key-gated (set the relevant env var to turn a provider on):
//   ALCHEMY_KEY   — Alchemy NFT API (EVM: ethereum / polygon / arbitrum / optimism / base)
//   RESERVOIR_KEY — Reservoir (EVM marketplace aggregation, collection/trade depth)
//   HELIUS_KEY    — Helius (Solana DAS)
// With no keys, searchNfts() returns an empty list (never throws) — the PURE ranking below still
// works on any token object you hand it, which is what the offline tests exercise.
//
// Flow: searchNfts() → list tokens → resolveTokenUri(token) (ipfs:// → gateway) → (caller fetches
// metadata) → clarityScore(token) / rankNfts(list) to push spam down.
//
//   import { searchNfts, resolveTokenUri, clarityScore, rankNfts } from './nft-search.mjs'
//   node integrations/soapbox/nft-search.mjs ethereum "rare book"

import { cached, TTL } from './cache.mjs';

const UA = 'Mozilla/5.0 (compatible; MELEK-Bot/1.0)';
let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

const clamp = (n, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));
const r0 = (n) => Math.round(n);

// Public IPFS gateways. ipfs:// (and the legacy /ipfs/CID form) get rewritten to the first one;
// ar:// (Arweave) too. Everything else (https/data:) is returned unchanged.
const IPFS_GATEWAY = 'https://ipfs.io/ipfs/';
const ARWEAVE_GATEWAY = 'https://arweave.net/';

/**
 * Resolve a token's content URI to something fetchable. PURE — no network. Accepts a raw URI string
 * or a token object (uses token.tokenUri || token.image || token.uri). Handles:
 *   ipfs://CID/path        → https://ipfs.io/ipfs/CID/path
 *   ipfs://ipfs/CID        → collapses the doubled prefix
 *   /ipfs/CID  ·  ipfs/CID → gateway
 *   ar://TXID              → https://arweave.net/TXID
 *   https:// · http: · data: → unchanged
 * Returns null for empty/unknown input.
 */
export function resolveTokenUri(token) {
  const raw = typeof token === 'string' ? token : (token?.tokenUri || token?.image || token?.uri || '');
  if (!raw || typeof raw !== 'string') return null;
  const uri = raw.trim();
  if (!uri) return null;

  if (uri.startsWith('ipfs://')) {
    let rest = uri.slice('ipfs://'.length);
    rest = rest.replace(/^ipfs\//, '');   // ipfs://ipfs/CID → CID
    rest = rest.replace(/^\/+/, '');
    return IPFS_GATEWAY + rest;
  }
  if (uri.startsWith('ar://')) return ARWEAVE_GATEWAY + uri.slice('ar://'.length).replace(/^\/+/, '');
  if (/^\/?ipfs\//.test(uri)) return IPFS_GATEWAY + uri.replace(/^\/?ipfs\//, '');
  if (/^(https?:|data:)/i.test(uri)) return uri;
  return uri; // bare CID or unknown scheme — hand it back untouched
}

// ── Clarity spam filter ──────────────────────────────────────────────────────────────────────────
// Five observable signals, each normalized 0–100 then weighted. Provenance (verified contract) and
// real-content-vs-spam-JPEG carry the most weight: a verified-issuer token that resolves to an actual
// document/book is exactly what we want to surface; an anonymous freshly-minted lone JPEG is the noise
// we push down. NOTHING here is bought — it's all read off the token itself.
const WEIGHTS = { provenance: 0.30, content: 0.30, holders: 0.18, trading: 0.14, creator: 0.08 };

// content kinds we treat as "real content" (a doc/book) vs spam imagery.
const DOC_EXT = /\.(pdf|epub|mobi|azw3?|txt|md|doc|docx|odt|html?)$/i;
const DOC_MIME = /(pdf|epub|msword|officedocument|ebook|text\/(plain|markdown|html)|application\/json)/i;
const IMG_ONLY_MIME = /^image\//i;
const IMG_EXT = /\.(jpe?g|png|gif|webp|bmp|svg)$/i;

/**
 * Does this token resolve to real readable content (a document/book) rather than a bare image?
 * PURE heuristic over the token's declared fields. Returns true/false.
 *   - explicit doc mime/extension on content/animation_url → yes
 *   - animation_url present alongside an image (book preview + file) → yes
 *   - metadata flags: token.isDocument / contentType 'document'|'book'|'pdf' → yes
 *   - ONLY an image url, image mime, or image extension → no (the spam-JPEG case)
 */
export function resolvesToRealContent(token) {
  if (!token || typeof token !== 'object') return false;
  if (token.isDocument === true) return true;
  const kind = String(token.contentType || token.content_type || token.category || '').toLowerCase();
  if (/(document|book|pdf|epub|ebook|text|article|manuscript)/.test(kind)) return true;

  const candidates = [token.animation_url, token.animationUrl, token.content, token.contentUri, token.file, token.tokenUri]
    .filter((x) => typeof x === 'string' && x);
  for (const c of candidates) {
    if (DOC_EXT.test(c.split('?')[0])) return true;
  }
  const mime = String(token.mimeType || token.mime || token.media?.[0]?.mimeType || '').toLowerCase();
  if (mime && DOC_MIME.test(mime)) return true;
  // animation_url that isn't itself an image is treated as a real attached file.
  for (const c of [token.animation_url, token.animationUrl].filter(Boolean)) {
    if (typeof c === 'string' && !IMG_EXT.test(c.split('?')[0])) return true;
  }
  if (mime && IMG_ONLY_MIME.test(mime)) return false;
  return false;
}

// 0–100 sub-scores from observable token facts. Each is defensive about missing data (unknown → low,
// because the whole point is that opacity sinks; it must never read as an accusation, just "unproven").
function provenanceScore(t) {
  let s = 10;
  if (t.contractVerified === true || t.verified === true || t.collection?.verified === true) s += 45;
  if (t.openseaVerified === true || t.safelistStatus === 'verified' || t.collection?.safelistRequestStatus === 'verified') s += 25;
  if (t.spamClassification === true || t.isSpam === true || t.spam === true) s -= 60;
  if (t.contractAddress || t.contract?.address) s += 10;
  return clamp(s);
}
function contentScore(t) {
  return resolvesToRealContent(t) ? 95 : 12;
}
function holdersScore(t) {
  const n = Number(t.holders ?? t.numOwners ?? t.ownerCount ?? t.collection?.ownerCount);
  if (!Number.isFinite(n) || n <= 0) return 15;
  // log-scaled: 1 holder ≈ 0, ~10 ≈ 40, ~1k ≈ 80, 100k+ ≈ 100.
  return clamp(Math.log10(n + 1) / 5 * 100);
}
function tradingScore(t) {
  const sales = Number(t.salesCount ?? t.numSales ?? t.collection?.salesCount ?? 0);
  const vol = Number(t.volume ?? t.totalVolume ?? t.collection?.volume?.allTime ?? 0);
  let s = 10;
  if (sales > 0) s += clamp(Math.log10(sales + 1) / 4 * 60, 0, 60);
  if (vol > 0) s += clamp(Math.log10(vol + 1) / 6 * 30, 0, 30);
  return clamp(s);
}
function creatorScore(t) {
  const c = t.creator || t.collection?.creator || {};
  let s = 30;
  if (c.verified === true || t.creatorVerified === true) s += 40;
  const created = Number(c.collectionsCreated ?? t.creatorCollections ?? 0);
  if (created > 0) s += clamp(Math.log10(created + 1) / 3 * 30, 0, 30);
  if (c.flagged === true || t.creatorFlagged === true) s -= 50;
  return clamp(s);
}

/**
 * Clarity score for one NFT token — 0–100, higher = more provenance/legibility. PURE, no network.
 * Returns { score, parts } so a UI can show why. A spam JPEG (anonymous, unverified, image-only,
 * no holders/trades) lands near the floor; a verified-issuer book with holders + sales lands high.
 */
export function clarityScore(token) {
  const t = token && typeof token === 'object' ? token : {};
  const parts = {
    provenance: r0(provenanceScore(t)),
    content: r0(contentScore(t)),
    holders: r0(holdersScore(t)),
    trading: r0(tradingScore(t)),
    creator: r0(creatorScore(t)),
  };
  let score = 0;
  for (const k of Object.keys(WEIGHTS)) score += parts[k] * WEIGHTS[k];
  return { score: r0(clamp(score)), parts };
}

/**
 * Rank a list of tokens by clarity, descending. PURE. Returns new array of
 * { ...token, clarity, clarityParts }; ties broken by holders then trading so the spam JPEG sinks.
 */
export function rankNfts(list) {
  if (!Array.isArray(list)) return [];
  return list
    .map((t) => { const c = clarityScore(t); return { ...t, clarity: c.score, clarityParts: c.parts }; })
    .sort((a, b) => b.clarity - a.clarity
      || (b.clarityParts.holders - a.clarityParts.holders)
      || (b.clarityParts.trading - a.clarityParts.trading));
}

// ── Indexing providers (soft-fail, key-gated) ─────────────────────────────────────────────────────
const EVM_CHAINS = {
  ethereum: 'eth-mainnet', polygon: 'polygon-mainnet', arbitrum: 'arb-mainnet',
  optimism: 'opt-mainnet', base: 'base-mainnet',
};

function normalizeAlchemy(n, chain) {
  return {
    chain, provider: 'alchemy',
    contractAddress: n?.contract?.address,
    tokenId: n?.tokenId ?? n?.id?.tokenId,
    name: n?.name || n?.title || n?.raw?.metadata?.name,
    description: n?.description || n?.raw?.metadata?.description,
    image: n?.image?.cachedUrl || n?.image?.originalUrl || n?.media?.[0]?.gateway,
    tokenUri: n?.tokenUri?.raw || n?.tokenUri || n?.raw?.tokenUri,
    animation_url: n?.raw?.metadata?.animation_url,
    contractVerified: n?.contract?.isVerified ?? undefined,
    spamClassification: (n?.contract?.isSpam === true || (n?.contract?.spamClassifications?.length > 0)) || undefined,
    mimeType: n?.image?.contentType || n?.media?.[0]?.mimeType,
  };
}

async function alchemySearch(chain, q, key) {
  const net = EVM_CHAINS[chain];
  if (!net) return [];
  // searchContractMetadata finds collections by name; then we surface their NFTs. Keyless callers
  // never reach here (key-gated by the caller). Soft-fail to [].
  try {
    const base = `https://${net}.g.alchemy.com/nft/v3/${key}`;
    const r = await _fetch(`${base}/searchContractMetadata?query=${encodeURIComponent(q)}`, { headers: { 'user-agent': UA, accept: 'application/json' } });
    if (!r.ok) return [];
    const contracts = (await r.json())?.contracts || [];
    const out = [];
    for (const c of contracts.slice(0, 5)) {
      const addr = c?.address; if (!addr) continue;
      const rr = await _fetch(`${base}/getNFTsForContract?contractAddress=${addr}&limit=10&withMetadata=true`, { headers: { 'user-agent': UA, accept: 'application/json' } });
      if (!rr.ok) continue;
      const nfts = (await rr.json())?.nfts || [];
      for (const n of nfts) out.push(normalizeAlchemy({ ...n, contract: { ...n.contract, isVerified: c.isVerified, isSpam: c.isSpam } }, chain));
    }
    return out;
  } catch { return []; }
}

async function reservoirSearch(chain, q, key) {
  if (!EVM_CHAINS[chain]) return [];
  try {
    const host = chain === 'ethereum' ? 'api.reservoir.tools' : `api-${chain}.reservoir.tools`;
    const r = await _fetch(`https://${host}/search/collections/v3?name=${encodeURIComponent(q)}&limit=10`, { headers: { 'user-agent': UA, accept: 'application/json', 'x-api-key': key } });
    if (!r.ok) return [];
    const cols = (await r.json())?.collections || [];
    return cols.map((c) => ({
      chain, provider: 'reservoir',
      contractAddress: c?.contract, name: c?.name, description: c?.description,
      image: c?.image, tokenUri: c?.image,
      collection: { verified: c?.openseaVerificationStatus === 'verified', ownerCount: c?.ownerCount, salesCount: c?.s30DayVolume, volume: { allTime: c?.allTimeVolume } },
      holders: c?.ownerCount, volume: c?.allTimeVolume,
      spamClassification: c?.isSpam === true || undefined,
    }));
  } catch { return []; }
}

async function heliusSearch(q, key) {
  try {
    const r = await _fetch(`https://mainnet.helius-rpc.com/?api-key=${key}`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': UA },
      body: JSON.stringify({ jsonrpc: '2.0', id: 'soapbox', method: 'searchAssets', params: { tokenType: 'nonFungible', page: 1, limit: 20 } }),
    });
    if (!r.ok) return [];
    const items = (await r.json())?.result?.items || [];
    const needle = String(q || '').toLowerCase();
    return items
      .map((a) => ({
        chain: 'solana', provider: 'helius',
        contractAddress: a?.id, name: a?.content?.metadata?.name, description: a?.content?.metadata?.description,
        image: a?.content?.links?.image, tokenUri: a?.content?.json_uri,
        animation_url: a?.content?.links?.animation_url,
        contractVerified: a?.creators?.some((c) => c.verified) || undefined,
        creatorVerified: a?.creators?.some((c) => c.verified) || undefined,
        mimeType: a?.content?.files?.[0]?.mime,
      }))
      .filter((x) => !needle || (x.name || '').toLowerCase().includes(needle) || (x.description || '').toLowerCase().includes(needle));
  } catch { return []; }
}

/**
 * Search NFTs across whatever providers have a key set, for { chain, q }. Soft-fail: any provider
 * error → that provider contributes nothing; no keys → []. Results are ranked by clarity so the
 * spam-JPEG noise sinks. Cached 30 min (clarity band) per chain+query. NEVER throws, NEVER logs keys.
 */
export async function searchNfts({ chain = 'ethereum', q = '' } = {}) {
  const ch = String(chain || 'ethereum').toLowerCase();
  return cached(`nft:${ch}:${q}`, TTL.clarity, async () => {
    const tasks = [];
    if (process.env.ALCHEMY_KEY && EVM_CHAINS[ch]) tasks.push(alchemySearch(ch, q, process.env.ALCHEMY_KEY));
    if (process.env.RESERVOIR_KEY && EVM_CHAINS[ch]) tasks.push(reservoirSearch(ch, q, process.env.RESERVOIR_KEY));
    if (process.env.HELIUS_KEY && ch === 'solana') tasks.push(heliusSearch(q, process.env.HELIUS_KEY));
    if (!tasks.length) return [];
    const settled = await Promise.allSettled(tasks);
    const all = settled.flatMap((s) => (s.status === 'fulfilled' && Array.isArray(s.value) ? s.value : []));
    return rankNfts(all);
  });
}

if (process.argv[1] && process.argv[1].endsWith('nft-search.mjs')) {
  const [chain = 'ethereum', ...rest] = process.argv.slice(2);
  const q = rest.join(' ');
  const enabled = ['ALCHEMY_KEY', 'RESERVOIR_KEY', 'HELIUS_KEY'].filter((k) => process.env[k]);
  console.log(`providers enabled: ${enabled.length ? enabled.join(', ').replace(/_KEY/g, '') : 'none (set ALCHEMY_KEY / RESERVOIR_KEY / HELIUS_KEY)'}`);
  const list = await searchNfts({ chain, q });
  if (!list.length) { console.log('(no results)'); }
  for (const t of list.slice(0, 20)) {
    console.log(`  [${String(t.clarity).padStart(3)}] ${(t.name || t.contractAddress || '?').slice(0, 40).padEnd(40)} ${resolveTokenUri(t) || ''}`);
  }
}
