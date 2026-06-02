// steemd.mjs — the queryable-state interface over the condenser. The brief calls the condenser
// "functionally, our steemd — the canonical, queryable state of the ecosystem." This is that state
// made ASK-able: one command router that any front end (Discord, Telegram, and later Hathor /
// Cheetah) calls to read the system. It starts with the CMC data and GROWS — each new app or chain
// registers more commands against the same one source of truth. No keys, read-only.
//
//   import { runCommand, COMMANDS } from './steemd.mjs'
//   await runCommand('price VKBT')        → { ok, text, data }
//   await runCommand('clarity vkbt')      → Clarity breakdown
//   node integrations/soapbox/steemd.mjs markets 5
//
// Return shape is always { ok, text, data }: `text` is a ready-to-send message (Discord/Telegram),
// `data` is the structured object (for Hathor to reason over or an embed builder to format).

import { getCoin, topCoins, ourCoins, globalStats, hiveEngineExtras, trending } from './condenser.mjs';
import { clarityFromCoin, clarityForHive } from './clarity.mjs';
import { chainsTVL, fearGreed } from './markets-extra.mjs';
import { topProtocols } from './adapters/defillama.mjs';

const usd = (n) => (n == null || !Number.isFinite(+n) ? '—' : '$' + (+n).toLocaleString(undefined, { maximumFractionDigits: Math.abs(+n) < 1 ? 6 : 2 }));
const compact = (n) => {
  n = +n; if (!Number.isFinite(n) || n === 0) return '—';
  const a = Math.abs(n);
  if (a >= 1e12) return '$' + (n / 1e12).toFixed(2) + 'T';
  if (a >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
  if (a >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
  if (a >= 1e3) return '$' + (n / 1e3).toFixed(2) + 'K';
  return usd(n);
};
const pct = (n) => (n == null || !Number.isFinite(+n) ? '' : `${n >= 0 ? '+' : ''}${(+n).toFixed(2)}%`);
const ok = (text, data = null) => ({ ok: true, text, data });
const err = (text) => ({ ok: false, text, data: null });

// resolve a user-typed token reference to a condenser id. "VKBT"/"vkbt" → hive-engine for our tokens,
// otherwise a Tier-1 id (lowercased). "hive-engine:vkbt" and "node:melek:MELEK" pass through.
const OUR = new Set(['vkbt', 'cure']); // genuine ecosystem currencies only (SWAP.GIFU is a pegged token, not ours)
function resolveId(ref) {
  const r = String(ref || '').trim();
  if (!r) return '';
  if (r.includes(':')) return r;                       // explicit id
  if (OUR.has(r.toLowerCase())) return `hive-engine:${r.toLowerCase()}`;
  return r.toLowerCase();
}

// ── command registry — grows as apps/chains are added (the whole point) ─────
export const COMMANDS = {
  async price(args) {
    const id = resolveId(args[0]);
    if (!id) return err('usage: `price <symbol>` — e.g. `price VKBT` or `price bitcoin`');
    const c = await getCoin(id);
    if (!c) return err(`no coin "${args[0]}". Try \`markets\` to see what's listed.`);
    const chg = c.change_24h != null ? ` (${pct(c.change_24h)} 24h)` : '';
    return ok(`**${c.name}** (${c.symbol}) — ${usd(c.price_usd)}${chg}\nMarket cap ${compact(c.market_cap_usd)} · 24h vol ${compact(c.volume_24h_usd)} · tier ${c.source_tier}`, c);
  },

  async coin(args) { return COMMANDS.price(args); },     // alias

  async clarity(args) {
    const ref = args[0];
    if (!ref) return err('usage: `clarity <symbol>` — transparency from observable facts');
    const id = resolveId(ref);
    const c = await getCoin(id);
    const cl = c ? await clarityFromCoin(c) : (OUR.has(String(ref).toLowerCase()) ? await clarityForHive(ref) : null);
    if (!cl || cl.value == null) return err(`no Clarity Score for "${ref}" yet (deepest for our ecosystem tokens).`);
    const lines = Object.entries(cl.inputs || {}).map(([k, v]) => `• ${k.replace(/_/g, ' ')}: ${v}`).join('\n');
    return ok(`**Clarity ${cl.value}/100 — ${cl.band}** for ${c?.symbol || String(ref).toUpperCase()}\n${lines}\n_Low = opaque, not "scam". Observable facts only._`, cl);
  },

  async markets(args) {
    const n = Math.min(20, Math.max(1, +args[0] || 5));
    const [ours, top] = await Promise.all([ourCoins().catch(() => []), topCoins({ limit: n }).catch(() => [])]);
    const ourIds = new Set(ours.map((c) => c.id));
    const rows = [...ours, ...top.filter((c) => !ourIds.has(c.id))].slice(0, n + ours.length);
    const list = rows.map((c) => `${c.ours ? '⭐ ' : ''}**${c.symbol}** ${usd(c.price_usd)} ${c.change_24h != null ? `(${pct(c.change_24h)})` : ''}`).join('\n');
    return ok(`**Markets** (ecosystem ⭐ first)\n${list}`, rows);
  },

  async holders(args) {
    const ref = args[0];
    if (!ref) return err('usage: `holders <symbol>` — first-party distribution for an ecosystem token');
    const sym = String(ref).replace(/^hive-engine:/, '');
    const ex = await hiveEngineExtras(sym).catch(() => null);
    const h = ex?.holders;
    if (!h) return err(`no holder data for "${ref}" (ecosystem/Hive-Engine tokens only).`);
    return ok(`**${sym.toUpperCase()} holders** — issuer ${h.issuerPct}% · affiliated ${h.affiliatedPct}% · **real outside ${h.realOutsidePct}%** (${h.counts?.realOutside ?? 0} accounts)`, h);
  },

  async chains() {
    const c = await chainsTVL({ limit: 8 }).catch(() => []);
    if (!c.length) return err('chain TVL unavailable right now.');
    return ok(`**Top chains by TVL**\n${c.map((x) => `• ${x.name}: ${compact(x.tvl)}`).join('\n')}`, c);
  },

  async global() {
    const [g, f] = await Promise.all([globalStats().catch(() => null), fearGreed().catch(() => null)]);
    if (!g) return err('global stats unavailable right now.');
    return ok(`**Global** — market cap ${compact(g.total_market_cap_usd)} (${pct(g.market_cap_change_24h)} 24h) · BTC dom ${g.btc_dominance.toFixed(1)}%${f?.value != null ? ` · Fear&Greed ${f.value} (${f.classification})` : ''}`, { ...g, fng: f });
  },

  async trending() {
    const t = await trending().catch(() => []);
    if (!t.length) return err('trending unavailable right now.');
    return ok(`**Trending**: ${t.map((c) => c.symbol).join(' · ')}`, t);
  },

  async convert(args) {
    const amt = parseFloat(args[0]);
    const id = resolveId(args[1]);
    if (!Number.isFinite(amt) || !id) return err('usage: `convert <amount> <symbol>` — e.g. `convert 100 VKBT`');
    const c = await getCoin(id);
    if (!c) return err(`no coin "${args[1]}".`);
    return ok(`**${amt.toLocaleString()} ${c.symbol}** = ${usd(amt * c.price_usd)} (@ ${usd(c.price_usd)})`, { amount: amt, symbol: c.symbol, usd: amt * c.price_usd, price: c.price_usd });
  },

  async compare(args) {
    const [a, b] = [resolveId(args[0]), resolveId(args[1])];
    if (!a || !b) return err('usage: `compare <a> <b>` — e.g. `compare bitcoin ethereum`');
    const [ca, cb] = await Promise.all([getCoin(a), getCoin(b)]);
    if (!ca || !cb) return err(`couldn't load ${!ca ? args[0] : args[1]}.`);
    const line = (c) => `**${c.symbol}** ${usd(c.price_usd)} · cap ${compact(c.market_cap_usd)}${c.change_24h != null ? ` · ${pct(c.change_24h)}` : ''}`;
    const ratio = cb.price_usd ? (ca.price_usd / cb.price_usd) : null;
    return ok(`${line(ca)}\n${line(cb)}${ratio ? `\n1 ${ca.symbol} = ${ratio.toLocaleString(undefined, { maximumFractionDigits: 6 })} ${cb.symbol}` : ''}`, { a: ca, b: cb, ratio });
  },

  async gainers(args) {
    const top = await topCoins({ limit: 50 }).catch(() => []);
    const g = top.filter((c) => Number.isFinite(c.change_24h)).sort((x, y) => y.change_24h - x.change_24h).slice(0, Math.min(10, +args[0] || 5));
    return ok(`**Top gainers (24h)**\n${g.map((c) => `${c.symbol} ${pct(c.change_24h)} (${usd(c.price_usd)})`).join('\n')}`, g);
  },

  async losers(args) {
    const top = await topCoins({ limit: 50 }).catch(() => []);
    const l = top.filter((c) => Number.isFinite(c.change_24h)).sort((x, y) => x.change_24h - y.change_24h).slice(0, Math.min(10, +args[0] || 5));
    return ok(`**Top losers (24h)**\n${l.map((c) => `${c.symbol} ${pct(c.change_24h)} (${usd(c.price_usd)})`).join('\n')}`, l);
  },

  async ecosystem() {
    const ours = await ourCoins().catch(() => []);
    if (!ours.length) return err('ecosystem tokens unavailable right now.');
    return ok(`**SoapBox ecosystem**\n${ours.map((c) => `⭐ ${c.symbol} ${usd(c.price_usd)} ${c.change_24h != null ? `(${pct(c.change_24h)})` : ''}`).join('\n')}\nMELEK · SOAP · PRANA chains — https://data.soapbox.community/ecosystem`, ours);
  },

  async dapps() {
    const p = await topProtocols({ limit: 6 }).catch(() => []);
    if (!p.length) return err('dApp data unavailable right now.');
    return ok(`**Top DeFi by TVL**\n${p.map((x) => `• ${x.name}: ${compact(x.tvl)}`).join('\n')}\nFull directory: https://data.soapbox.community/dapps`, p);
  },

  async learn() {
    return ok('**Learn** — what gives a token value, scam patterns, how the Clarity Score works, burn-to-feature, DYOR:\nhttps://data.soapbox.community/learn', null);
  },

  async library(args) {
    const q = args.join(' ').trim();
    if (!q) return ok('**Library of Ashurbanipal** — the VKFRI knowledge base, fact-checked: https://wiki.soapbox.community\nTry `library <topic>` to search.', null);
    const base = process.env.WIKI_SITE || 'https://wiki.soapbox.community';
    try {
      const r = await fetch(`${base}/api/search?q=${encodeURIComponent(q)}`, { signal: AbortSignal.timeout(8000) });
      const d = await r.json();
      if (!d.results?.length) return ok(`No Library articles for "${q}". Browse: ${base}`, d);
      return ok(`**Library — "${q}"**\n${d.results.slice(0, 5).map((a) => `• [${a.title}](${a.url})`).join('\n')}`, d.results);
    } catch (e) { return err(`Library unavailable right now (${e.message}).`); }
  },
  async wiki(args) { return COMMANDS.library(args); }, // alias

  async help() {
    return ok([
      '**SoapBox steemd** — query the ecosystem state:',
      '`price <sym>` · `clarity <sym>` · `holders <sym>` · `convert <amt> <sym>` · `compare <a> <b>`',
      '`markets [n]` · `gainers` · `losers` · `trending` · `chains` · `dapps` · `global` · `ecosystem` · `learn` · `library <topic>`',
      '_Reads the condenser (one source of truth). Starts with the CMC; grows as MELEK and more apps come online._',
      'Full site: https://data.soapbox.community',
    ].join('\n'), Object.keys(COMMANDS));
  },
};

/** Parse + run a command string ("price VKBT"). Unknown verbs return help-ish guidance. */
export async function runCommand(input) {
  const parts = String(input || '').trim().split(/\s+/);
  const verb = (parts.shift() || '').toLowerCase();
  if (!verb) return COMMANDS.help();
  const fn = COMMANDS[verb];
  if (!fn) return err(`unknown command "${verb}". Try \`help\`.`);
  try { return await fn(parts); }
  catch (e) { return err(`error reading state: ${e.message}`); }
}

if (process.argv[1] && process.argv[1].endsWith('steemd.mjs')) {
  const r = await runCommand(process.argv.slice(2).join(' ') || 'help');
  console.log(r.text);
}
