// liveData.js — Ashurbanipal live-data connector (Task #94).
//
// Bridges the library bot to the live CMC/steemd data layer so articles and answers can
// cite CURRENT prices, markets, and chain facts — honestly time-stamped, never presented
// as eternal truth. The shared queryable-state layer is integrations/soapbox/steemd.mjs
// (`runCommand` → { ok, text, data }), the same source Discord/Telegram read.
//
// Design rules (strict):
//   • ESM, matching the library bot.
//   • Defensive DYNAMIC import of the .mjs data layer — bridged at call time, soft-fail if absent.
//   • Injectable data source via __setDataSource(fn) so tests run OFFLINE against canned data.
//   • Soft-fail, no-throw: data unavailable → null / [] . NEVER breaks article generation.
//   • CLI guarded; no secrets.
//
//   import { priceFact, marketFacts, chainFact, citeLiveData, enrich } from './liveData.js';
//   await priceFact('VKBT')              → { symbol, priceUsd, change24h, asOf } | null
//   node src/liveData.js price VKBT

// ── injectable data source ─────────────────────────────────────────────────
// A data source is an async fn(commandString) → { ok, text, data } (the steemd contract).
// Default is null → we lazily, defensively import the real steemd.mjs on first use.
let _dataSource = null;
let _importTried = false;
let _importedRunner = null;

/** Inject a data source (used by tests to run offline). Pass null to reset to the real layer. */
export function __setDataSource(fn) {
  _dataSource = typeof fn === 'function' ? fn : null;
  if (fn === null) { _importTried = false; _importedRunner = null; }
}

// Resolve the active runner: an injected source wins; otherwise defensively import steemd.mjs.
async function getRunner() {
  if (_dataSource) return _dataSource;
  if (_importedRunner) return _importedRunner;
  if (_importTried) return null; // already failed once — stay soft
  _importTried = true;
  try {
    // The data layer lives outside the bot package; bridge by relative URL at call time.
    const mod = await import('../../integrations/soapbox/steemd.mjs');
    if (mod && typeof mod.runCommand === 'function') {
      _importedRunner = (cmd) => mod.runCommand(cmd);
      return _importedRunner;
    }
  } catch {
    // soft-fail: data layer unavailable (missing deps, offline, etc.) — never throw.
  }
  return null;
}

// Run a steemd command, soft-failing to null on any error / unavailability.
async function query(cmd) {
  try {
    const run = await getRunner();
    if (!run) return null;
    const r = await run(cmd);
    if (!r || r.ok === false) return null;
    return r; // { ok, text, data }
  } catch {
    return null; // soft-fail, no-throw
  }
}

const nowIso = () => new Date().toISOString();

// ── public API ─────────────────────────────────────────────────────────────

/**
 * Current price fact for a symbol.
 * @returns {Promise<{symbol,priceUsd,change24h,asOf}|null>} null on any failure.
 */
export async function priceFact(symbol) {
  const sym = String(symbol || '').trim();
  if (!sym) return null;
  const r = await query(`price ${sym}`);
  const c = r?.data;
  if (!c || c.price_usd == null) return null;
  return {
    symbol: c.symbol || sym.toUpperCase(),
    priceUsd: Number(c.price_usd),
    change24h: c.change_24h == null ? null : Number(c.change_24h),
    asOf: nowIso(),
  };
}

/**
 * Price facts for a watchlist of symbols. Always returns an array (possibly empty);
 * symbols that soft-fail are dropped, never throw.
 * @returns {Promise<Array<{symbol,priceUsd,change24h,asOf}>>}
 */
export async function marketFacts(symbols) {
  const list = Array.isArray(symbols) ? symbols : [];
  const facts = await Promise.all(list.map((s) => priceFact(s).catch(() => null)));
  return facts.filter(Boolean);
}

/**
 * A current chain fact routed through the data layer (e.g. account exists, post count).
 * `query` is a steemd command string such as "price MELEK" or a future "account hathor".
 * @returns {Promise<{query,text,data,asOf}|null>} null on any failure.
 */
export async function chainFact(queryStr) {
  const q = String(queryStr || '').trim();
  if (!q) return null;
  const r = await query(q);
  if (!r) return null;
  return { query: q, text: r.text ?? null, data: r.data ?? null, asOf: nowIso() };
}

/**
 * A citation string the wiki / fact-checker can embed — honestly time-stamped with the
 * as-of date so live facts are never presented as eternal truth.
 * Accepts a priceFact-shaped object (or any object with symbol + an as-of timestamp).
 */
export function citeLiveData(fact) {
  if (!fact || typeof fact !== 'object') return '';
  const asOf = fact.asOf || nowIso();
  const date = String(asOf).slice(0, 10); // YYYY-MM-DD, honest time-stamp
  const sym = fact.symbol ? String(fact.symbol).toUpperCase() : null;
  if (sym && fact.priceUsd != null) {
    const price = Number(fact.priceUsd).toLocaleString(undefined, {
      maximumFractionDigits: Math.abs(Number(fact.priceUsd)) < 1 ? 6 : 2,
    });
    return `As of ${date}, ${sym} traded at $${price} (source: SoapBox/steemd).`;
  }
  // Generic chain fact citation.
  const what = fact.query || sym || 'data';
  return `As of ${date}, ${what} per live SoapBox/steemd (source: SoapBox/steemd).`;
}

/**
 * Augment an article with an additive "Live data" footnote of current facts.
 * ADDITIVE ONLY: the original article body is never rewritten — facts are appended as a
 * footnote section. If no live data is available, the article is returned unchanged.
 *
 * @param {string|{content?:string,body?:string}} article  article text or an object with a body field.
 * @param {{symbols?:string[]}} [opts]
 * @returns {Promise<typeof article>} same type as input, body + Live-data footnote.
 */
export async function enrich(article, opts = {}) {
  const symbols = Array.isArray(opts.symbols) ? opts.symbols : [];
  const facts = await marketFacts(symbols);
  if (!facts.length) return article; // nothing to add → leave article untouched.

  const lines = facts.map((f) => `- ${citeLiveData(f)}`);
  const footnote = `\n\n## Live data\n\n${lines.join('\n')}\n`;

  if (typeof article === 'string') return article + footnote;
  if (article && typeof article === 'object') {
    const key = typeof article.content === 'string' ? 'content'
      : typeof article.body === 'string' ? 'body' : null;
    if (key) return { ...article, [key]: article[key] + footnote };
    // No recognized body field — attach footnote without touching anything else.
    return { ...article, liveData: footnote };
  }
  return article;
}

// ── CLI (guarded) ───────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('liveData.js')) {
  const [verb, ...rest] = process.argv.slice(2);
  const out = async () => {
    if (verb === 'price') return priceFact(rest[0]);
    if (verb === 'markets') return marketFacts(rest);
    if (verb === 'chain') return chainFact(rest.join(' '));
    return { usage: 'node src/liveData.js <price SYM | markets SYM... | chain "cmd ...">' };
  };
  console.log(JSON.stringify(await out(), null, 2));
}
