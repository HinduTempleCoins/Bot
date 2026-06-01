// free-apis.mjs — live clients for the KEYLESS / no-auth public APIs from the bot-fleet
// catalog (.local/APIS_300_BOT_FLEET.md). No secrets here; these need no signup. Keyed APIs
// are provisioned separately (keys → vault, never this file).
//
// Run a live smoke test of everything:   node integrations/free-apis.mjs smoke
// Use a single client:                   import { crypto } from './integrations/free-apis.mjs'
//
// Each client returns parsed data (or throws). The smoke runner reports which endpoints are live.

const UA = 'MELEK-Bot/1.0 (+https://github.com/HinduTempleCoins/Bot)';

async function http(url, { json = true, timeout = 12000, headers = {} } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const r = await fetch(url, { headers: { 'user-agent': UA, accept: json ? 'application/json' : '*/*', ...headers }, signal: ctrl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return json ? await r.json() : await r.text();
  } finally { clearTimeout(t); }
}
async function rpc(url, method, params = []) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 12000);
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': UA },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: ctrl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    if (j.error) throw new Error(j.error.message || 'rpc error');
    return j.result;
  } finally { clearTimeout(t); }
}

// ── Crypto market data (token-scanner, portfolio, witness price feed, Discord prices) ──
export const crypto = {
  coingecko: (ids = 'bitcoin,hive', vs = 'usd') =>
    http(`https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=${vs}`),
  kraken: (pair = 'XBTUSD') => http(`https://api.kraken.com/0/public/Ticker?pair=${pair}`),
  coinbase: (pair = 'BTC-USD') => http(`https://api.coinbase.com/v2/prices/${pair}/spot`),
  coinpaprika: (id = 'btc-bitcoin') => http(`https://api.coinpaprika.com/v1/tickers/${id}`),
  defillama: (coin = 'coingecko:hive') => http(`https://coins.llama.fi/prices/current/${coin}`),
  dexscreener: (q = 'hive') => http(`https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(q)}`),
  geckoterminal: () => http('https://api.geckoterminal.com/api/v2/networks', { headers: { accept: 'application/json;version=20230302' } }),
  frankfurter: (from = 'USD', to = 'EUR') => http(`https://api.frankfurter.app/latest?from=${from}&to=${to}`),
  mempoolFees: () => http('https://mempool.space/api/v1/fees/recommended'),
  // exchange public tickers (no key) — redundancy for the price feed
  okx: (inst = 'BTC-USDT') => http(`https://www.okx.com/api/v5/market/ticker?instId=${inst}`),
  bitfinex: (sym = 'tBTCUSD') => http(`https://api-pub.bitfinex.com/v2/ticker/${sym}`, { json: true }),
  kucoin: (sym = 'BTC-USDT') => http(`https://api.kucoin.com/api/v1/market/orderbook/level1?symbol=${sym}`),
  gate: (pair = 'BTC_USDT') => http(`https://api.gateio.ws/api/v4/spot/tickers?currency_pair=${pair}`),
  bitstamp: (pair = 'btcusd') => http(`https://www.bitstamp.net/api/v2/ticker/${pair}/`),
  gemini: (sym = 'btcusd') => http(`https://api.gemini.com/v1/pubticker/${sym}`),
  coincap: (asset = 'bitcoin') => http(`https://api.coincap.io/v2/assets/${asset}`),
};

// ── HIVE / Graphene (the witness's home chain + Hive-Engine for the token scanner) ──
const HIVE_NODES = ['https://api.hive.blog', 'https://api.deathwing.me', 'https://api.openhive.network'];
export const hive = {
  globalProps: (node = HIVE_NODES[0]) => rpc(node, 'condenser_api.get_dynamic_global_properties'),
  account: (name = 'hiveio', node = HIVE_NODES[0]) => rpc(node, 'condenser_api.get_accounts', [[name]]),
  witness: (name = 'blocktrades', node = HIVE_NODES[0]) => rpc(node, 'condenser_api.get_witness_by_account', [name]),
  rewardFund: (node = HIVE_NODES[0]) => rpc(node, 'condenser_api.get_reward_fund', ['post']),
  priceFeed: (node = HIVE_NODES[0]) => rpc(node, 'condenser_api.get_current_median_history_price'),
  engineTokens: (limit = 3) =>
    fetch('https://api.hive-engine.com/rpc/contracts', { method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': UA },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'find', params: { contract: 'tokens', table: 'tokens', query: {}, limit } }) })
      .then(r => r.json()).then(j => j.result),
  engineBalance: (account = 'hiveio') =>
    fetch('https://api.hive-engine.com/rpc/contracts', { method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': UA },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'find', params: { contract: 'tokens', table: 'balances', query: { account }, limit: 5 } }) })
      .then(r => r.json()).then(j => j.result),
  beaconNodes: () => http('https://beacon.peakd.com/api/nodes'),
};

// ── Knowledge / reference (Discord KB, wiki generator) ──
export const knowledge = {
  wikipedia: (title = 'Hathor') => http(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`),
  wikidata: (q = 'Hathor') => http(`https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(q)}&language=en&format=json`),
  mediawiki: (q = 'Graphene blockchain') => http(`https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(q)}&format=json&srlimit=1`),
  arxiv: (q = 'large language models') => http(`http://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(q)}&max_results=1`, { json: false }),
  crossref: (q = 'blockchain consensus') => http(`https://api.crossref.org/works?query=${encodeURIComponent(q)}&rows=1&mailto=mahatmajapa@gmail.com`),
  openlibrary: (q = 'mastering bitcoin') => http(`https://openlibrary.org/search.json?q=${encodeURIComponent(q)}&limit=1`),
  semanticScholar: (q = 'transformer architecture') => http(`https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(q)}&limit=1&fields=title,year`),
  restCountries: (name = 'egypt') => http(`https://restcountries.com/v3.1/name/${name}?fields=name,capital,population`),
  openMeteo: (lat = 30.05, lon = 31.23) => http(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true`),
  timeNow: (tz = 'UTC') => http(`https://timeapi.io/api/Time/current/zone?timeZone=${tz}`),
  holidays: (year = 2026, country = 'US') => http(`https://date.nager.at/api/v3/PublicHolidays/${year}/${country}`),
  geocode: (q = 'Cairo Egypt') => http(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=1`),
};

// ── Content / media / search (Discord assistant, wiki ingest) ──
export const content = {
  pollinationsURL: (prompt = 'an angelic Hathor-Mehit witness, golden') =>
    `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=512&height=512&nologo=true`,
  pollinationsCheck: async (prompt) => {
    const r = await fetch(content.pollinationsURL(prompt), { method: 'GET', headers: { 'user-agent': UA } });
    return { ok: r.ok, status: r.status, type: r.headers.get('content-type') };
  },
  jinaReader: (target = 'https://example.com') => http(`https://r.jina.ai/${target}`, { json: false, timeout: 20000 }),
  duckduckgo: (q = 'Ethereum') => http(`https://api.duckduckgo.com/?q=${encodeURIComponent(q)}&format=json&no_html=1`),
  wikipediaImages: (title = 'Hathor') => http(`https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(title)}&prop=pageimages&format=json&pithumbsize=300`),
  microlink: (url = 'https://github.com/HinduTempleCoins/Bot') => http(`https://api.microlink.io/?url=${encodeURIComponent(url)}`),
  qrCode: (data = 'https://github.com/HinduTempleCoins/Bot') => `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(data)}`,
};

export const all = { crypto, hive, knowledge, content };

// ── Live smoke test ──
const CHECKS = [
  ['crypto.coingecko', () => crypto.coingecko().then(d => `BTC $${d.bitcoin?.usd}, HIVE $${d.hive?.usd}`)],
  ['crypto.kraken', () => crypto.kraken().then(d => `pairs: ${Object.keys(d.result || {}).join(',')}`)],
  ['crypto.coinbase', () => crypto.coinbase().then(d => `BTC $${d.data?.amount}`)],
  ['crypto.coinpaprika', () => crypto.coinpaprika().then(d => `${d.symbol} $${d.quotes?.USD?.price?.toFixed(0)}`)],
  ['crypto.defillama', () => crypto.defillama().then(d => `HIVE $${Object.values(d.coins || {})[0]?.price}`)],
  ['crypto.dexscreener', () => crypto.dexscreener().then(d => `${d.pairs?.length || 0} pairs`)],
  ['crypto.geckoterminal', () => crypto.geckoterminal().then(d => `${d.data?.length} networks`)],
  ['crypto.frankfurter', () => crypto.frankfurter().then(d => `1 USD = ${d.rates?.EUR} EUR`)],
  ['crypto.mempoolFees', () => crypto.mempoolFees().then(d => `fast ${d.fastestFee} sat/vB`)],
  ['crypto.okx', () => crypto.okx().then(d => `BTC $${d.data?.[0]?.last}`)],
  ['crypto.bitfinex', () => crypto.bitfinex().then(d => `BTC $${d[6]}`)],
  ['crypto.kucoin', () => crypto.kucoin().then(d => `BTC $${d.data?.price}`)],
  ['crypto.gate', () => crypto.gate().then(d => `BTC $${d[0]?.last}`)],
  ['crypto.bitstamp', () => crypto.bitstamp().then(d => `BTC $${d.last}`)],
  ['crypto.gemini', () => crypto.gemini().then(d => `BTC $${d.last}`)],
  ['crypto.coincap', () => crypto.coincap().then(d => `${d.data?.symbol} $${(+d.data?.priceUsd).toFixed(0)}`)],
  ['hive.globalProps', () => hive.globalProps().then(d => `head block ${d.head_block_number}`)],
  ['hive.account', () => hive.account().then(d => `@${d[0]?.name} loaded`)],
  ['hive.witness', () => hive.witness().then(d => `witness @${d?.owner} rank loaded`)],
  ['hive.rewardFund', () => hive.rewardFund().then(d => `reward balance ${d?.reward_balance}`)],
  ['hive.priceFeed', () => hive.priceFeed().then(d => `feed ${d?.base} / ${d?.quote}`)],
  ['hive.engineTokens', () => hive.engineTokens().then(d => `${d?.length || 0} HE tokens`)],
  ['hive.engineBalance', () => hive.engineBalance().then(d => `${d?.length || 0} balances`)],
  ['hive.beaconNodes', () => hive.beaconNodes().then(d => `${d?.length || 0} nodes ranked`)],
  ['knowledge.wikipedia', () => knowledge.wikipedia().then(d => `"${(d.extract || '').slice(0, 36)}…"`)],
  ['knowledge.wikidata', () => knowledge.wikidata().then(d => `${d.search?.length} entities`)],
  ['knowledge.mediawiki', () => knowledge.mediawiki().then(d => `${d.query?.search?.length} hit`)],
  ['knowledge.arxiv', () => knowledge.arxiv().then(t => `${t.includes('<entry>') ? 'entry returned' : 'no entry'}`)],
  ['knowledge.crossref', () => knowledge.crossref().then(d => `${d.message?.items?.length} work`)],
  ['knowledge.openlibrary', () => knowledge.openlibrary().then(d => `${d.numFound} books`)],
  ['knowledge.semanticScholar', () => knowledge.semanticScholar().then(d => `${d.total ?? d.data?.length} papers`)],
  ['knowledge.restCountries', () => knowledge.restCountries().then(d => `${d[0]?.name?.common}, cap ${d[0]?.capital?.[0]}`)],
  ['knowledge.openMeteo', () => knowledge.openMeteo().then(d => `${d.current_weather?.temperature}°C`)],
  ['knowledge.timeNow', () => knowledge.timeNow().then(d => `${d.dateTime?.slice(0, 19)}`)],
  ['knowledge.holidays', () => knowledge.holidays().then(d => `${d?.length} US holidays 2026`)],
  ['knowledge.geocode', () => knowledge.geocode().then(d => `${(+d[0]?.lat).toFixed(2)},${(+d[0]?.lon).toFixed(2)}`)],
  ['content.pollinations', () => content.pollinationsCheck().then(d => `${d.status} ${d.type}`)],
  ['content.jinaReader', () => content.jinaReader().then(t => `${t.length} chars`)],
  ['content.duckduckgo', () => content.duckduckgo().then(d => `${d.AbstractSource || 'instant-answer ok'}`)],
  ['content.wikipediaImages', () => content.wikipediaImages().then(d => `thumb ${Object.values(d.query?.pages || {})[0]?.thumbnail ? 'yes' : 'no'}`)],
  ['content.microlink', () => content.microlink().then(d => `${d.status} "${(d.data?.title || '').slice(0, 24)}"`)],
  ['content.qrCode', () => fetch(content.qrCode(), { method: 'GET' }).then(r => `${r.status} ${r.headers.get('content-type')}`)],
];

async function smoke() {
  console.log(`\nMELEK free-API smoke test — ${CHECKS.length} keyless endpoints\n${'─'.repeat(66)}`);
  let ok = 0;
  const results = await Promise.allSettled(CHECKS.map(async ([name, fn]) => {
    try { return { name, ok: true, sample: await fn() }; }
    catch (e) { return { name, ok: false, sample: e.message }; }
  }));
  for (const r of results) {
    const v = r.value;
    if (v.ok) ok++;
    console.log(`${v.ok ? '✅' : '❌'} ${v.name.padEnd(28)} ${String(v.sample).slice(0, 58)}`);
  }
  console.log('─'.repeat(66));
  console.log(`${ok}/${CHECKS.length} live\n`);
}

if (process.argv[2] === 'smoke') smoke();
