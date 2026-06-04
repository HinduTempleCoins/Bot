// resource-center-chat.mjs — make the Resource Center conversationally queryable (Task #2 / #188).
//
// A THIN natural-language → Resource-Center query layer. Newcomers (or the Smols/ML/BRE, or a
// Telegram/Discord user) type a question; we route it to the 24/7 market-intelligence engine
// (integrations/resource-center.mjs) and return a chat-friendly, CITED answer. The rule is:
// never an unsourced claim — every answer carries its sources, and if nothing matches we say so
// honestly rather than inventing.
//
// Conventions (shared with the rest of the Bot repo): ESM `.mjs`; the resource-center function is
// INJECTABLE via __setResourceCenter(fn) so tests run fully OFFLINE; every public path soft-fails
// (no throw) at the edge; the CLI is guarded behind an argv check; NO secrets.
//
// Exports:
//   ask(query, { topK })                 -> { answer, sources:[{title,url,snippet}], confidence }
//   handleChat({ user, text }, { now })  -> { reply, kind }
//   formatForChat(result)                -> compact cited reply for Telegram/Discord
//   toBrief(result)                      -> brief-ready snippet (for the BRE/Smols)
//   RateLimiter                          -> per-user token bucket (injectable clock)
//   __setResourceCenter(fn)              -> inject the snapshot source (tests / custom wiring)

// ---- resource-center wiring (defensive, injectable) ------------------------
// By default we read the LAST snapshot the engine wrote (cheap, no network). Tests inject a
// canned snapshot via __setResourceCenter so nothing here ever touches the network or disk.
let _rc = null;
async function defaultRc() {
  // Import defensively: if the engine module is missing/broken the chat layer must still answer
  // "nothing found" honestly rather than throw.
  try {
    const mod = await import('./resource-center.mjs');
    if (typeof mod.latest === 'function') {
      const snap = await mod.latest();
      if (snap) return snap;
    }
    // No persisted snapshot yet — run a fresh pass as a fallback (best-effort).
    if (typeof mod.runPass === 'function') return await mod.runPass();
  } catch { /* engine absent — soft-fail to null below */ }
  return null;
}

/**
 * Inject the resource-center source. The fn is called as `fn(query, { topK })` and may return
 * either a snapshot object (the engine's shape) OR a pre-built result `{ answer, sources, confidence }`.
 * Pass null to reset to the default (read the engine's latest snapshot).
 * @param {((query: string, opts: { topK: number }) => any) | null} fn
 */
export function __setResourceCenter(fn) {
  _rc = typeof fn === 'function' ? fn : null;
}

async function callRc(query, topK) {
  const fn = _rc || defaultRc;
  return await fn(query, { topK });
}

// ---- snapshot → candidate sources ------------------------------------------
// Turn the engine's snapshot into a flat list of cited "facts" we can match a query against.
// Each candidate: { title, url, snippet, text } where `text` is the searchable haystack.

const num = (n, d = 2) => (n == null || !Number.isFinite(+n) ? '—' : (+n).toLocaleString(undefined, { maximumFractionDigits: d }));
const pct = (n) => (n == null || !Number.isFinite(+n) ? '—' : `${+n >= 0 ? '+' : ''}${(+n).toFixed(2)}%`);

// datum-type → OUR OWN canonical page (#275). The clickable `url` always points to our record on
// *.soapbox.community; the big-site upstream is named honestly in `attribution`/`via`, never linked.
const OUR_PAGE = {
  hiveEngine: 'https://data.soapbox.community/coins',
  crypto: 'https://data.soapbox.community/coins',
  chain: 'https://data.soapbox.community/coins',
  metals: 'https://data.soapbox.community/commodities',
  commodities: 'https://data.soapbox.community/commodities',
  indices: 'https://data.soapbox.community/macro',
  macro: 'https://data.soapbox.community/macro',
  stocks: 'https://stocks.soapbox.community',
  forex: 'https://data.soapbox.community/fx',
  fx: 'https://data.soapbox.community/fx',
  dxy: 'https://data.soapbox.community/fx',
  sentiment: 'https://data.soapbox.community/macro',
  marketEntry: 'https://data.soapbox.community/coins',
  firstTrade: 'https://data.soapbox.community/coins',
  news: 'https://data.soapbox.community/macro',
};
const ourPage = (type, slug) => {
  const base = OUR_PAGE[type] || 'https://data.soapbox.community';
  return slug ? `${base}/${String(slug).toLowerCase()}` : base;
};

function snapshotCandidates(snap) {
  const out = [];
  if (!snap || typeof snap !== 'object') return out;
  const ts = typeof snap.ts === 'string' ? snap.ts.slice(0, 16).replace('T', ' ') + ' UTC' : 'latest pass';
  const m = snap.metrics || {};

  // Hive-Engine universe
  const he = m.hiveEngine;
  if (he) {
    const top = (he.topVolume || []).slice(0, 5).map((r) => `${r.symbol} (${num(r.volume, 0)})`).join(', ');
    out.push({
      title: 'Hive-Engine / TribalDEX',
      url: ourPage('hiveEngine'),
      attribution: 'TribalDEX / Hive-Engine',
      via: 'TribalDEX / Hive-Engine',
      snippet: `${num(he.totalTokens, 0)} tokens, ${num(he.activeMarkets, 0)} active markets, ${num(he.totalVolumeHive, 0)} HIVE 24h volume. Top volume: ${top}.`,
      text: `hive-engine tribaldex token tokens market markets volume hive ${(he.topVolume || []).map((r) => r.symbol).join(' ')} ${(he.topGainers || []).map((r) => r.symbol).join(' ')} ${(he.topLosers || []).map((r) => r.symbol).join(' ')}`.toLowerCase(),
    });
  }
  // Metals
  for (const [k, v] of Object.entries(m.metals || {})) {
    if (!v) continue;
    out.push({
      title: `${k[0].toUpperCase()}${k.slice(1)} (spot)`,
      url: ourPage('metals'),
      attribution: 'Kitco (spot metals)',
      via: 'Kitco',
      snippet: `${k}: $${num(v.price)} (${pct(v.change)}) as of ${ts}.`,
      text: `${k} metal metals gold silver platinum copper spot price bullion`.toLowerCase(),
    });
  }
  // Indices
  for (const [k, v] of Object.entries(m.indices || {})) {
    if (!v) continue;
    out.push({
      title: `${k.toUpperCase()} index`,
      url: ourPage('indices'),
      attribution: 'Yahoo Finance',
      via: 'Yahoo Finance',
      snippet: `${k.toUpperCase()}: ${v.price != null ? num(v.price) : '—'} (${pct(v.change)}) as of ${ts}.`,
      text: `${k} index indices stock stocks dow s&p sp500 nasdaq vix market equities ${m.riskOn || ''}`.toLowerCase(),
    });
  }
  // Forex
  for (const p of (m.forex || [])) {
    out.push({
      title: `${p.pair} (forex)`,
      url: ourPage('forex'),
      attribution: 'OANDA',
      via: 'OANDA',
      snippet: `${p.pair}: ${num(p.rate, 4)} (${pct(p.change)}) as of ${ts}.`,
      text: `${p.pair} forex fx currency currencies exchange rate dollar euro yen pound`.toLowerCase(),
    });
  }
  if (m.dxy) {
    out.push({
      title: 'Dollar Index (DXY)',
      url: ourPage('dxy'),
      attribution: 'MarketWatch',
      via: 'MarketWatch',
      snippet: `DXY: ${num(m.dxy.price)} (${pct(m.dxy.change)}) — dollar strength as of ${ts}.`,
      text: 'dxy dollar index strength usd forex currency'.toLowerCase(),
    });
  }
  // Markets we should enter
  for (const e of (snap.marketEntries || []).slice(0, 8)) {
    const market = e.market || e.kind || 'opportunity';
    const ePct = e.edgePct == null ? null : (e.edgePct < 1 ? e.edgePct * 100 : e.edgePct);
    out.push({
      title: `Market entry: ${market}`,
      url: ourPage('marketEntry'),
      attribution: e.venue || 'TribalDEX',
      via: e.venue || 'TribalDEX',
      snippet: `${market}${e.venue ? ` @ ${e.venue}` : ''}${e.chain ? ` [${e.chain}]` : ''}${ePct != null ? ` ~${ePct.toFixed(1)}% edge` : ''}: ${e.reason || e.action || ''}`.trim(),
      text: `${market} ${e.venue || ''} ${e.chain || ''} ${e.reason || ''} ${e.action || ''} market entry enter trade arbitrage opportunity`.toLowerCase(),
    });
  }
  // First trade (the "act now")
  if (snap.firstTrade) {
    const f = snap.firstTrade;
    out.push({
      title: 'First trade (advisory)',
      url: ourPage('firstTrade'),
      attribution: 'TribalDEX / Hive-Engine',
      via: 'TribalDEX / Hive-Engine',
      snippet: `Best executable edge for @${f.account}: ${f.edge}${f.suggested ? ` → ${f.suggested}` : ''} (buying power ${num(f.hiveBuyingPower)} HIVE).`,
      text: `first trade arbitrage edge execute ${f.account} ${f.edge || ''} ${f.suggested || ''} buying power hive`.toLowerCase(),
    });
  }
  // News diagnostics — what the market is SAYING
  const newsArr = Array.isArray(snap.news?.assets) ? snap.news.assets
    : (snap.news?.assets && typeof snap.news.assets === 'object' ? Object.values(snap.news.assets) : []);
  for (const d of newsArr) {
    if (!d || !d.headlineCount) continue;
    const themes = (d.themes || []).slice(0, 4).map((t) => t.word).join(', ');
    out.push({
      title: `News: ${d.topic}`,
      url: ourPage('news'),
      attribution: 'Google News',
      via: 'Google News',
      snippet: `${d.topic}: ${d.sentimentHint} sentiment (${d.sentimentScore}), ${d.headlineCount} headlines${themes ? ` — themes: ${themes}` : ''}.`,
      text: `news ${d.topic} sentiment ${d.sentimentHint || ''} headlines ${themes} ${d.topic}`.toLowerCase(),
    });
  }
  // Live catalog data (#275) — keyless fetches from free-apis.mjs the engine fanned this pass. Each
  // links to OUR canonical page (`ourUrl`) and names the upstream provider honestly as attribution.
  for (const c of (Array.isArray(snap.catalog) ? snap.catalog : [])) {
    if (!c || c.value == null) continue;
    out.push({
      title: c.label || c.id || 'live data',
      url: c.ourUrl || ourPage(c.type),
      attribution: c.via || c.source || '',
      via: c.via || c.source || '',
      snippet: `${c.value}${c.via ? ` (via ${c.via})` : ''} as of ${ts}.`,
      text: `${c.label || ''} ${c.id || ''} ${c.value || ''} ${c.type || ''} ${c.via || ''} live data price`.toLowerCase(),
    });
  }
  // Allow an engine to attach explicit cited sources directly.
  for (const s of (snap.sources && Array.isArray(snap.sources) ? snap.sources : [])) {
    if (!s) continue;
    out.push({
      title: s.title || 'source',
      url: s.url || '',
      attribution: s.attribution || s.via || '',
      via: s.via || s.attribution || '',
      snippet: s.snippet || s.text || '',
      text: `${s.title || ''} ${s.snippet || s.text || ''}`.toLowerCase(),
    });
  }
  return out;
}

// ---- query matching --------------------------------------------------------

const STOP = new Set(['the', 'a', 'an', 'is', 'are', 'of', 'to', 'in', 'on', 'for', 'and', 'or',
  'what', 'whats', 'how', 'do', 'i', 'me', 'my', 'about', 'tell', 'show', 'price', 'whats', 'with',
  'can', 'you', 'whats', 'right', 'now', 'today', 'whats', 'much', 'should', 'we']);

function terms(q) {
  return (q || '')
    .toLowerCase()
    .replace(/[^a-z0-9&/ ]+/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !STOP.has(w));
}

/** Score a candidate by how many query terms it contains. */
function scoreCandidate(cand, qterms) {
  if (!qterms.length) return 0;
  let s = 0;
  for (const t of qterms) {
    if (cand.text.includes(t)) s += 1;
    // partial credit for a term appearing inside the human-readable snippet/title
    else if (`${cand.title} ${cand.snippet}`.toLowerCase().includes(t)) s += 0.5;
  }
  return s;
}

// ---- ask -------------------------------------------------------------------

const MAX_SOURCES = 4;

/**
 * Natural-language query → cited answer from the Resource Center.
 * Never returns an unsourced claim: if no candidate matches, the answer says so honestly and
 * `sources` is empty with confidence 0.
 *
 * @param {string} query
 * @param {{ topK?: number }} [opts]
 * @returns {Promise<{ answer: string, sources: Array<{title:string,url:string,snippet:string}>, confidence: number }>}
 */
export async function ask(query, opts = {}) {
  const topK = Math.max(1, Math.min(10, Number(opts.topK) || MAX_SOURCES));
  const q = typeof query === 'string' ? query.trim() : '';
  const empty = (answer, confidence = 0) => ({ answer, sources: [], confidence });

  if (!q) return empty('Ask me about a market — e.g. gold, Hive-Engine tokens, forex, or what to trade. I answer from the Resource Center with sources.');

  let raw;
  try {
    raw = await callRc(q, topK);
  } catch {
    // soft-fail: the engine threw — never propagate, answer honestly.
    return empty('The Resource Center is unavailable right now, so I can\'t give you a sourced answer. Please try again shortly.');
  }

  // The RC fn may hand back a finished result already.
  if (raw && typeof raw === 'object' && typeof raw.answer === 'string' && Array.isArray(raw.sources)) {
    return {
      answer: raw.answer,
      sources: raw.sources.slice(0, topK),
      confidence: Number.isFinite(+raw.confidence) ? +raw.confidence : (raw.sources.length ? 0.7 : 0),
    };
  }

  const candidates = snapshotCandidates(raw);
  if (!candidates.length) {
    return empty('I don\'t have any Resource Center data to answer that from yet — nothing found. Once the market-intelligence engine has run a pass, I can give you sourced figures.');
  }

  const qterms = terms(q);
  const scored = candidates
    .map((c) => ({ c, score: scoreCandidate(c, qterms) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);

  if (!scored.length) {
    // We have data but nothing matched the question — honest miss, not a fabricated answer.
    return empty(`I couldn't find anything in the Resource Center matching "${q}". I can answer about metals, stock indices, forex, Hive-Engine tokens, and market-entry opportunities — try one of those.`);
  }

  const sources = scored.map(({ c }) => ({ title: c.title, url: c.url, snippet: c.snippet, attribution: c.attribution || c.via || '', via: c.via || c.attribution || '' }));
  // Synthesis is the lead source's snippet plus a count of corroborating sources — grounded, never invented.
  const lead = sources[0];
  const extra = sources.length > 1 ? ` (+${sources.length - 1} related source${sources.length - 1 === 1 ? '' : 's'})` : '';
  const answer = `${lead.snippet}${extra}`;
  // confidence scales with match strength and corroboration, capped below "certain".
  const best = scored[0].score;
  const confidence = Math.max(0.3, Math.min(0.95, best / Math.max(1, qterms.length) * 0.6 + Math.min(sources.length, 3) * 0.12));

  return { answer, sources, confidence: +confidence.toFixed(2) };
}

// ---- formatForChat ---------------------------------------------------------

/**
 * Compact cited reply suitable for Telegram/Discord: a 1-2 line synthesis followed by numbered
 * source links. Always renders the citations when sources exist; honest when they don't.
 * @param {{ answer: string, sources: Array<{title:string,url:string,snippet:string}>, confidence: number }} result
 * @returns {string}
 */
export function formatForChat(result) {
  const r = result || {};
  const answer = typeof r.answer === 'string' && r.answer ? r.answer : 'Nothing found.';
  const sources = Array.isArray(r.sources) ? r.sources : [];
  if (!sources.length) return answer;
  const lines = sources.map((s, i) => {
    const link = s.url ? ` — ${s.url}` : '';
    return `  [${i + 1}] ${s.title}${link}`;
  });
  const conf = Number.isFinite(+r.confidence) && r.confidence > 0 ? ` (confidence ${Math.round(r.confidence * 100)}%)` : '';
  return `${answer}${conf}\nSources:\n${lines.join('\n')}`;
}

// ---- toBrief ---------------------------------------------------------------

/**
 * A brief-ready snippet so the BRE / Smols can fold a Resource Center answer into a brief.
 * Markdown with the synthesis and a bulleted, linked source list.
 * @param {{ answer: string, sources: Array<{title:string,url:string,snippet:string}>, confidence: number }} result
 * @param {string} [query]  optional — included as the heading question if provided.
 * @returns {string}
 */
export function toBrief(result, query) {
  const r = result || {};
  const answer = typeof r.answer === 'string' && r.answer ? r.answer : 'Nothing found.';
  const sources = Array.isArray(r.sources) ? r.sources : [];
  const L = [];
  L.push(`### Resource Center${query ? `: ${query}` : ' answer'}`);
  L.push(answer);
  if (Number.isFinite(+r.confidence) && r.confidence > 0) L.push(`*Confidence: ${Math.round(r.confidence * 100)}%.*`);
  if (sources.length) {
    L.push('');
    L.push('Sources:');
    for (const s of sources) {
      L.push(`- **${s.title}**${s.url ? ` (${s.url})` : ''}${s.snippet ? ` — ${s.snippet}` : ''}`);
    }
  } else {
    L.push('*No sources — nothing matched in the Resource Center.*');
  }
  return L.join('\n');
}

// ---- RateLimiter -----------------------------------------------------------
// Per-user token bucket (mirrors src/trollbox/index.mjs). Injectable clock for offline tests.

export class RateLimiter {
  /**
   * @param {object} [opts]
   * @param {number} [opts.capacity=5]    max burst (tokens)
   * @param {number} [opts.windowMs=10000] ms to fully refill from empty
   * @param {() => number} [opts.now]      clock; defaults to Date.now
   */
  constructor({ capacity = 5, windowMs = 10000, now = () => Date.now() } = {}) {
    this.capacity = capacity;
    this.windowMs = windowMs;
    this.refillPerMs = capacity / windowMs;
    this._now = now;
    this._buckets = new Map();
  }

  _refill(b, t) {
    const elapsed = t - b.last;
    if (elapsed > 0) {
      b.tokens = Math.min(this.capacity, b.tokens + elapsed * this.refillPerMs);
      b.last = t;
    }
  }

  /** Spend a token for `user`; true if allowed, false if rate-limited. */
  allow(user) {
    const key = typeof user === 'string' && user ? user : 'anon';
    const t = this._now();
    let b = this._buckets.get(key);
    if (!b) { b = { tokens: this.capacity, last: t }; this._buckets.set(key, b); }
    this._refill(b, t);
    if (b.tokens >= 1) { b.tokens -= 1; return true; }
    return false;
  }
}

// ---- handleChat ------------------------------------------------------------

const RC_COMMAND_REGEX = /^\s*!(resource|rc)\b\s*(.*)$/i;

/**
 * Route one inbound chat line. Handles `!resource <q>` / `!rc <q>` (or a bare question routed
 * here), calls ask(), and formats a cited chat reply. Soft-fails: never throws at the edge.
 *
 * @param {{ user?: string, text?: string }} msg
 * @param {object} [ctx]
 * @param {() => number} [ctx.now]      clock for the limiter; defaults to Date.now
 * @param {RateLimiter} [ctx.limiter]   shared limiter; if omitted, no rate limiting
 * @param {number} [ctx.topK]
 * @returns {Promise<{ reply: string, kind: 'resource'|'rate-limited'|'nudge'|'error' }>}
 */
export async function handleChat({ user, text } = {}, ctx = {}) {
  const { now = () => Date.now(), limiter, topK } = ctx;
  void now; // limiter carries its own clock; `now` accepted for interface symmetry.

  if (limiter && typeof limiter.allow === 'function') {
    let allowed = true;
    try { allowed = limiter.allow(typeof user === 'string' ? user : 'anon'); } catch { allowed = true; }
    if (!allowed) {
      return { reply: 'You are asking a little fast — give it a few seconds and try again.', kind: 'rate-limited' };
    }
  }

  const clean = typeof text === 'string' ? text.trim() : '';
  if (!clean) {
    return { reply: 'Ask the Resource Center anything: try "!resource gold price" or "!rc what tokens to trade".', kind: 'nudge' };
  }

  // Extract the query: either after !resource/!rc, or treat the whole bare line as the question.
  let query = clean;
  let isCommand = false;
  const m = clean.match(RC_COMMAND_REGEX);
  if (m) { isCommand = true; query = (m[2] || '').trim(); }

  if (isCommand && !query) {
    return { reply: 'Usage: !resource <question> — e.g. !resource gold price, or !rc what should we trade.', kind: 'nudge' };
  }

  try {
    const result = await ask(query, { topK });
    return { reply: formatForChat(result), kind: 'resource' };
  } catch {
    // ask() already soft-fails, but belt-and-braces: never throw out of the edge handler.
    return { reply: 'Something went wrong reaching the Resource Center. Please try again shortly.', kind: 'error' };
  }
}

// ---- CLI -------------------------------------------------------------------
// Guarded: only runs when invoked directly. Reads the query from argv and prints the cited reply.
if (process.argv[1] && process.argv[1].endsWith('resource-center-chat.mjs')) {
  const line = process.argv.slice(2).join(' ');
  const out = await handleChat({ user: 'cli', text: line.startsWith('!') ? line : `!resource ${line}` });
  console.log(`[${out.kind}]\n${out.reply}`);
}
