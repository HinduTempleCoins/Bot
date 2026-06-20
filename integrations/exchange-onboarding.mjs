// exchange-onboarding.mjs — the trade-bot JOIN LIST. The operator asked (2026-06-20): "add other
// exchanges, get the info on other exchanges I can join, CEXs and DEXs, get some accounts on those
// for the trade bots, have them start looking at the same markets, and start sending small amounts."
//
// This turns the foundational catalog (markets-catalog.mjs) into a US-operator-actionable answer:
//   • WHICH crypto venues a US-resident operator can actually open an account on (us: full|partial),
//   • ranked by how useful they are to OUR trade bots (public API + lists the legs of our arb + low
//     KYC friction), CEX and DEX separated,
//   • each row carries WHAT TO DO to join, WHETHER it has a programmatic API the bots can drive, and
//     a START-SMALL sizing (the operator's "small amounts of money" — open tiny, prove the rail).
//
// Read-only + pure data: no live calls, no keys, never executes a trade. The bots read MARKETS for
// price/arb (public data needs no account); ACCOUNTS + funding are operator actions — this is the
// checklist that drives them. House style: ESM, soft-fail, CLI guard, handler(req,res) for tests.

import { CRYPTO_EXCHANGES, cryptoExchanges } from './soapbox/markets-catalog.mjs';

// The asset legs our bots actually trade — the SWAP.X wrappers settle against these majors/stables,
// so a venue that lists them can close a Hive-Engine ↔ external arb. (VKBT/CURE etc. are HE-native;
// their external legs are tracked in he-external-listings.mjs — this list is the COMMON denominator.)
export const OUR_LEGS = ['BTC', 'ETH', 'LTC', 'SOL', 'USDT', 'USDC', 'HIVE'];

// Default start-small ladder (USD). Tiny by design — open the account, fund the minimum, prove the
// deposit→trade→withdraw rail end-to-end before sizing up. Overridable via START_SMALL_USD.
const START_SMALL_USD = Number(process.env.START_SMALL_USD || 5);

// KYC friction → a rough "effort to join" score (lower = easier). Used only for tie-breaking.
const KYC_FRICTION = { none: 0, light: 1, standard: 2, heavy: 3, unknown: 2 };

// Does this venue plausibly list the legs our bots trade? Majors-listing CEXs and broad DEX
// aggregators do; single-asset brokers (BTC-only) only cover BTC. Heuristic, honest about it.
function listsOurLegs(e) {
  const n = e.name.toLowerCase();
  if (/swan|strike|river|cash app|coinmama/.test(n)) return ['BTC'];           // BTC-focused rails
  if (e.type === 'DEX') return ['ETH', 'USDC', 'USDT', 'SOL'].filter(Boolean);  // AMMs route majors/stables
  return OUR_LEGS;                                                              // broad CEX → assume the legs
}

// Programmatic API the bots can drive? Prefer the catalog's explicit `api` field; otherwise infer
// from what these venues are known to expose (majors have public+trade REST APIs).
function apiOf(e) {
  if (e.api) return e.api;
  const n = e.name.toLowerCase();
  if (/coinbase|kraken|gemini|crypto\.com|binance\.us|bitstamp|okx/.test(n)) return 'public+trade';
  if (e.type === 'DEX') return 'public';   // on-chain: read pools freely; "trade" = sign a tx via wallet
  return 'unknown';
}

function kycOf(e) {
  if (e.kyc) return e.kyc;
  if (e.type === 'DEX') return 'none';     // non-custodial: no account/KYC, just a wallet
  return 'standard';
}

// What the operator concretely does to bring this venue online for the bots.
function whatToDo(e, api, kyc) {
  if (e.type === 'DEX') {
    return 'No signup — fund a self-custody wallet (the bot reads pools now; swaps sign on-chain). Add an RPC + the router address to the venue adapter.';
  }
  const acct = kyc === 'none' ? 'Open an account' : `Open an account + ${kyc} KYC`;
  const key = api.includes('trade') ? ' then mint a read+trade API key (IP-allowlist it to the bot host)' : ' (API limited — manual/limited automation)';
  return `${acct}${key}.`;
}

function why(e, legs) {
  const bits = [];
  if (e.us === 'full') bits.push('US-full');
  else if (e.us === 'partial') bits.push('US-partial (verify your state)');
  if (legs.length >= OUR_LEGS.length - 1) bits.push('lists our arb legs');
  else if (legs.length) bits.push(`lists ${legs.join('/')}`);
  return bits.join('; ');
}

// Score: prefer us:full, public trade API, broad leg coverage, low KYC. Higher = join sooner.
function score(e, api, kyc, legs) {
  let s = 0;
  s += e.us === 'full' ? 40 : e.us === 'partial' ? 20 : 0;
  s += api.includes('trade') || api.includes('swap') || api.includes('order') ? 25 : api === 'public' ? 10 : 0;
  s += Math.min(legs.length, 7) * 4;
  s += (3 - (KYC_FRICTION[kyc] ?? 2)) * 5;
  return s;
}

function annotate(e) {
  const api = apiOf(e);
  const kyc = kycOf(e);
  const legs = listsOurLegs(e);
  return {
    name: e.name,
    type: e.type,            // CEX | DEX
    url: e.url,
    us: e.us,                // full | partial | no | unknown
    api,                     // public | public+trade | public+swap | limited | unknown
    kyc,                     // none | light | standard | heavy
    listsOurLegs: legs,
    startSmallUsd: START_SMALL_USD,
    whatToDo: whatToDo(e, api, kyc),
    why: why(e, legs),
    note: e.note || '',
    score: score(e, api, kyc, legs),
  };
}

/**
 * The ranked join list a US trade-bot operator should work through.
 * @param {{ includePartial?: boolean, type?: 'CEX'|'DEX' }} [opts]
 * @returns {{ asOf:string, startSmallUsd:number, cex:object[], dex:object[], summary:object }}
 */
export function joinList(opts = {}) {
  const includePartial = opts.includePartial !== false;   // default: include us:'partial'
  const usable = (e) => e.us === 'full' || (includePartial && e.us === 'partial');
  const rows = cryptoExchanges()
    .filter(usable)
    .filter((e) => (opts.type ? e.type === opts.type : true))
    .map(annotate)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  const cex = rows.filter((r) => r.type === 'CEX');
  const dex = rows.filter((r) => r.type === 'DEX');
  return {
    asOf: new Date().toISOString(),
    startSmallUsd: START_SMALL_USD,
    cex,
    dex,
    summary: {
      joinableCex: cex.length,
      joinableDex: dex.length,
      withTradeApi: rows.filter((r) => /trade|swap|order/.test(r.api)).length,
      topPicks: rows.slice(0, 5).map((r) => r.name),
      usBlockedSkipped: CRYPTO_EXCHANGES.filter((e) => e.us === 'no').length,
    },
  };
}

// Markdown the brief / Resource Center can drop in (the operator reads the brief).
export function joinListMarkdown(list = joinList()) {
  const row = (r) => `- **${r.name}** (${r.type}, ${r.us}) — ${r.why}. API: ${r.api}, KYC: ${r.kyc}. _${r.whatToDo}_`;
  return [
    `### Exchanges to join — start small ($${list.startSmallUsd} each)`,
    '',
    `**CEXs (${list.cex.length}):**`,
    ...list.cex.map(row),
    '',
    `**DEXs (${list.dex.length} — no signup, fund a wallet):**`,
    ...list.dex.map(row),
    '',
    `Skipped ${list.summary.usBlockedSkipped} US-blocked venues. Top picks: ${list.summary.topPicks.join(', ')}.`,
  ].join('\n');
}

// handler(req,res) — JSON for a page/brief; ?format=md for the markdown block; ?type=CEX|DEX to filter.
export function handler(req, res) {
  let url; try { url = new URL(req.url, 'http://x'); } catch { url = { searchParams: new Map() }; }
  const type = url.searchParams.get('type');
  const list = joinList({ type: type === 'CEX' || type === 'DEX' ? type : undefined });
  if (url.searchParams.get('format') === 'md') {
    res.writeHead(200, { 'content-type': 'text/markdown; charset=utf-8' });
    res.end(joinListMarkdown(list));
    return;
  }
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify(list, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(joinListMarkdown(joinList()));
}
