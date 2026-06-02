// adapters/defillama.mjs — TVL / protocol metrics (spec §5, keyless). Powers the DappRadar-style
// side of the directory: a live "top protocols by TVL" table alongside our own ecosystem dApps, and
// a per-protocol TVL lookup for any dApp that declares a llama slug. Cached — DeFiLlama is generous
// but the table is heavy.

import { cached, TTL } from '../cache.mjs';

const UA = 'MELEK-SoapBox/1.0 (+https://github.com/HinduTempleCoins/Bot)';
let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

async function jget(url, timeout = 15000) {
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), timeout);
  try { const r = await _fetch(url, { headers: { 'user-agent': UA }, signal: ctrl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`); return await r.json(); }
  finally { clearTimeout(t); }
}

export const id = 'defillama';

/** Top DeFi protocols by TVL (excludes CEX entries — those aren't dApps). */
export async function topProtocols({ limit = 15 } = {}) {
  return cached(`llama:top:${limit}`, TTL.metadata, async () => {
    const all = await jget('https://api.llama.fi/protocols');
    return (Array.isArray(all) ? all : [])
      .filter((p) => p.category && p.category !== 'CEX' && Number.isFinite(p.tvl))
      .sort((a, b) => b.tvl - a.tvl)
      .slice(0, limit)
      .map((p) => ({ name: p.name, category: p.category, chain: p.chain || 'Multi-Chain', tvl: p.tvl, change_1d: p.change_1d ?? null, slug: p.slug }));
  });
}

/** TVL for one protocol slug — for a dApp listing that maps to a llama protocol. */
export async function protocolTVL(slug) {
  if (!slug) return null;
  return cached(`llama:tvl:${slug}`, TTL.metadata, async () => {
    const d = await jget(`https://api.llama.fi/tvl/${encodeURIComponent(slug)}`).catch(() => null);
    return Number.isFinite(+d) ? +d : null;
  });
}

if (process.argv[1] && process.argv[1].endsWith('defillama.mjs')) {
  const top = await topProtocols({ limit: 5 });
  for (const p of top) console.log(`${p.name.padEnd(20)} ${p.category.padEnd(14)} $${(p.tvl / 1e9).toFixed(2)}B`);
}
