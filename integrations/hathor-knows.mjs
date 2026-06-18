// hathor-knows.mjs — the UNIFIED knowledge front door so "talking to Hathor covers it all."
//
// Operator (2026-06-18): "Set up Hathor's Brain to have Info from the Datasets and the Hierophant
// and Coupons and Data and all other SoapBox Pages, so people basically don't need the Pages and
// talking to Her covers it all."
//
// The gap this closes: system-query.ask() already answers MARKETS / DATA (price, macro, forex,
// holdings, exchanges, arbitrage), the LIBRARY (RAG over the wiki + our datasets), and TRUST (scam
// registry). But the Hierophant (religion / sacred texts), Coupons, Cannabis/Hemp, and the long
// tail of SoapBox comparison verticals (travel, law, insurance, jobs, …) were ORPHANED readers —
// live on their own pages, never reachable through Hathor's conversation. This module is the single
// `ask()` that routes a question to the right one of ALL of them, so the chat replaces the page.
//
// Routing order (first confident answer wins):
//   1. a SPECIFIC vertical reader (hierophant / coupons / cannabis) when the question is clearly about it
//   2. system-query.ask()  — markets/data, the Library (datasets), trust/scam  (the existing front door)
//   3. a DIRECTORY POINTER — "yes, we have a <X> page" for any other SoapBox vertical (the long tail)
//   4. an honest "I don't have that to hand" fallback
//
// Uniform return: { answer, vertical, sources:[{title,link}], data?, grounded:boolean }. READ-ONLY,
// no keys, soft-fails per source, NEVER throws. Everything is injectable (__setReaders) for offline
// tests — the default readers lazy-import the real modules defensively, so a missing module is just
// an unavailable source, never a crash.
//
//   import { ask } from './hathor-knows.mjs';
//   const { answer, vertical, sources } = await ask('what does the Book of the Dead say?');
//
// CLI:  node integrations/hathor-knows.mjs "is weed legal in texas?"

import { fileURLToPath } from 'node:url';

const safe = (fn, fallback) => Promise.resolve().then(fn).catch(() => fallback);
const STOP = new Set(['the', 'a', 'an', 'of', 'is', 'are', 'what', 'whats', 'does', 'do', 'say',
  'about', 'tell', 'me', 'in', 'on', 'for', 'to', 'and', 'or', 'how', 'can', 'i', 'find', 'get',
  'any', 'with', 'this', 'that', 'my', 'your', 'her', 'show', 'give', 'where', 'when', 'who']);
const tokens = (s) => (String(s || '').toLowerCase().match(/[a-z][a-z0-9'-]{2,}/g) || []).filter((t) => !STOP.has(t));

// ── the registry: which SPECIFIC vertical a question is about (pure keyword tests) ───────────────
// Order = priority. Each: { id, label, test(q) }. The reader for each id lives in defaultReaders().
const re = (...w) => new RegExp(`\\b(${w.join('|')})\\b`, 'i');

export const VERTICALS = [
  {
    id: 'hierophant', label: 'Hierophant',
    // religion / sacred texts / mythology / the gods — the Temple's religion library.
    test: (q) => re('hierophant', 'religion', 'religious', 'scripture', 'sacred text', 'sacred-text',
      'bible', 'gospel', 'torah', 'tanakh', 'qur.?an', 'koran', 'veda', 'vedas', 'upanishad', 'gita',
      'dhammapada', 'tao te ching', 'i ching', 'avesta', 'gathas', 'edda', 'eddas', 'kalevala',
      'popol vuh', 'zohar', 'kabbalah', 'gnostic', 'hermetic', 'gilgamesh', 'book of the dead',
      'pyramid texts', 'theology', 'theological', 'mythology', 'myth', 'deity', 'deities', 'pantheon',
      'god', 'goddess', 'prophet', 'prayer', 'spiritual', 'egyptian', 'mesopotamian', 'norse',
      'zoroastrian', 'buddhist', 'hindu', 'taoist', 'shaivism', 'shaivite').test(q),
  },
  {
    id: 'coupons', label: 'Coupons & cashback',
    test: (q) => re('coupon', 'coupons', 'cashback', 'cash back', 'promo code', 'promo codes',
      'discount', 'discounts', 'deal', 'deals', 'rakuten', 'honey', 'save money', 'voucher').test(q),
  },
  {
    id: 'cannabis', label: 'Hemp / Cannabis',
    test: (q) => re('cannabis', 'hemp', 'marijuana', 'weed', 'strain', 'strains', 'thc', 'cbd',
      'dispensary', 'dispensaries', 'kush', 'indica', 'sativa').test(q),
  },
];

/** Pure routing — which SPECIFIC vertical (or 'system' if none). Exported for tests + UI branching. */
export function routeVertical(question) {
  const q = String(question || '').trim();
  if (!q) return 'empty';
  const v = VERTICALS.find((x) => { try { return x.test(q); } catch { return false; } });
  return v ? v.id : 'system';
}

// ── injectable readers (tests set fakes; default = the real modules, defensively imported) ───────
let _readers = null;
export function __setReaders(obj) { _readers = obj && typeof obj === 'object' ? obj : null; }

function defaultReaders() {
  return { hierophant: hierophantReader, coupons: couponsReader, cannabis: cannabisReader, system: systemReader, directory: directoryReader };
}

// Hierophant: keyword-search the religion catalog (texts + traditions + entities), link out to the
// canonical reading pages. We hold the MAP; the texts themselves live on sacred-texts/gutenberg/archive.
async function hierophantReader(q) {
  const cat = await safe(() => import('./hierophant-catalog.mjs'), null);
  if (!cat) return null;
  const ent = await safe(() => import('./hierophant-entities.mjs'), null);
  const terms = tokens(q);
  if (!terms.length) return null;
  const score = (hay) => { const h = String(hay || '').toLowerCase(); return terms.filter((t) => h.includes(t)).length; };

  const texts = (cat.TEXTS || []).map((t) => ({ t, s: score(`${t.title} ${t.what} ${t.tradition} ${t.era}`) }))
    .filter((x) => x.s > 0).sort((a, b) => b.s - a.s).slice(0, 3);
  const trads = (cat.TRADITIONS || []).map((t) => ({ t, s: score(`${t.name} ${t.blurb}`) }))
    .filter((x) => x.s > 0).sort((a, b) => b.s - a.s).slice(0, 2);
  const ents = ent ? (ent.ENTITIES || []).map((e) => ({ e, s: score(`${e.name} ${(e.aka || []).join(' ')} ${e.what || e.blurb || ''} ${e.tradition}`) }))
    .filter((x) => x.s > 0).sort((a, b) => b.s - a.s).slice(0, 3) : [];

  if (!texts.length && !trads.length && !ents.length) return null;

  const sources = [];
  const lines = [];
  for (const { t } of texts) {
    const link = t.links && (t.links.gutenberg || t.links.archive || t.links.sacredTexts) || null;
    lines.push(`• **${t.title}** (${t.tradition}, ${t.era}) — ${(t.what || '').slice(0, 220)}`);
    if (link) sources.push({ title: t.title, link });
  }
  for (const { e } of ents) {
    lines.push(`• ${e.name}${e.tradition ? ` (${e.tradition})` : ''} — ${(e.what || e.blurb || '').slice(0, 160)}`);
  }
  for (const { t } of trads) {
    lines.push(`• Tradition — ${t.name}: ${(t.blurb || '').slice(0, 160)}`);
  }
  const answer = `From the Hierophant's library:\n${lines.join('\n')}\n\nThe full texts are linked at hierophant.soapbox.community — I hold the map of what's in them and what to read alongside.`;
  return { answer, sources, data: { texts: texts.map((x) => x.t.id), entities: ents.map((x) => x.e.id), traditions: trads.map((x) => x.t.id) } };
}

// Coupons: extract the store, pull live coupons (soft-fail to the cashback comparison / page pointer).
async function couponsReader(q) {
  const mod = await safe(() => import('./soapbox/coupons.mjs'), null);
  if (!mod) return null;
  const store = pickStore(q);
  // live coupons (network) — soft-fail to the deterministic cashback comparison and the page pointer.
  let coupons = [];
  if (store && typeof mod.findCoupons === 'function') {
    coupons = await safe(() => mod.findCoupons({ store }), []);
    if (typeof mod.rankCoupons === 'function') coupons = mod.rankCoupons(coupons) || coupons;
  }
  const sources = [{ title: 'Coupons & cashback', link: 'https://shopping.soapbox.community#coupons' }];
  if (coupons && coupons.length) {
    const lines = coupons.slice(0, 4).map((c) => `• ${c.title || c.code || 'deal'}${c.code ? ` — code ${c.code}` : ''}${c.discount ? ` (${c.discount})` : ''}`);
    return { answer: `Coupons for ${store}:\n${lines.join('\n')}\n\nMore at shopping.soapbox.community — and check which cashback portal pays most before you buy.`, sources, data: { store, coupons: coupons.slice(0, 4) } };
  }
  // no live hits → the honest cashback comparison (deterministic) for the store, else the page.
  if (store && typeof mod.cashbackCompare === 'function') {
    const cmp = await safe(() => mod.cashbackCompare(store), null);
    const best = cmp && Array.isArray(cmp.portals) && cmp.portals[0];
    if (best) return { answer: `For ${store}, the best cashback I see is ${best.name} at ${best.rate || best.cashback || 'a listed rate'}. Compare all portals + live codes at shopping.soapbox.community.`, sources, data: { store, cashback: cmp } };
  }
  return { answer: `I track coupon codes and cashback across stores at shopping.soapbox.community${store ? ` — tell me the store (you said "${store}") and I'll pull live codes + the best-paying cashback portal` : ' — name a store and I\'ll find live codes + the best cashback portal'}.`, sources, data: { store } };
}

// Cannabis/Hemp: a US state → legal status (pure), a named strain → lookup (network, soft-fail),
// else the hemp overview.
async function cannabisReader(q) {
  const mod = await safe(() => import('./soapbox/cannabis.mjs'), null);
  if (!mod) return null;
  const sources = [{ title: 'Hemp / Cannabis', link: 'https://hemp.soapbox.community' }];
  const state = pickUsState(q);
  if (state && typeof mod.legalStatus === 'function') {
    const st = await safe(() => mod.legalStatus(state), null);
    if (st) {
      const fed = st.federal && st.federal.line ? st.federal.line : (st.status || st.summary || '');
      const note = st.stateNote || st.notes || '';
      const body = [fed, note].filter(Boolean).join('\n') || 'see the trackers below for current status';
      return { answer: `Cannabis legal status — ${state}:\n${body}\n(Full per-state trackers, dispensaries + reform orgs at hemp.soapbox.community.)`, sources, data: { state, status: st } };
    }
  }
  if (re('strain', 'indica', 'sativa', 'kush').test(q) && typeof mod.strainLookup === 'function') {
    const strain = pickStrain(q);
    if (strain) {
      const info = await safe(() => mod.strainLookup(strain), null);
      if (info && (info.name || info.lineage)) return { answer: `Strain — ${info.name || strain}${info.type ? ` (${info.type})` : ''}${info.lineage ? `: lineage ${info.lineage}` : ''}.${info.thc ? ` ~${info.thc} THC.` : ''}\n(Full profile + pricing at hemp.soapbox.community.)`, sources, data: { strain, info } };
    }
  }
  const sum = typeof mod.cannabisSummary === 'function' ? await safe(() => mod.cannabisSummary(), null) : null;
  if (sum && (sum.summary || sum.note)) return { answer: `${sum.summary || sum.note}\n(Strains, legal status by state, dispensaries + pricing at hemp.soapbox.community.)`, sources, data: { summary: sum } };
  return { answer: 'I cover cannabis/hemp — legal status by US state, strain lineage, dispensaries and pricing — at hemp.soapbox.community. Ask me "is cannabis legal in <state>?" or about a specific strain.', sources, data: {} };
}

// The existing markets/data + Library(datasets) + trust front door.
async function systemReader(q, opts) {
  const sq = await safe(() => import('./system-query.mjs'), null);
  if (!sq || typeof sq.ask !== 'function') return null;
  const r = await safe(() => sq.ask(q, opts), null);
  if (!r || !r.answer) return null;
  const weak = !r.intent || r.intent === 'open-templated' || r.intent === 'empty';
  return { answer: r.answer, data: r.data, intent: r.intent, grounded: !weak, sources: [] };
}

// The long tail: "yes, we have a <X> page." Matches the question against the aggregator-directory of
// SoapBox comparison verticals (travel, law, insurance, jobs, real-estate, …) and the ecosystem nav,
// so EVERY page is at least pointer-reachable even before its reader is wired into the chat.
async function directoryReader(q) {
  const dir = await safe(() => import('./aggregator-directory.mjs'), null);
  const nav = await safe(() => import('./ecosystem-nav.mjs'), null);
  const terms = tokens(q);
  if (!terms.length) return null;
  const out = [];
  if (dir && Array.isArray(dir.VERTICALS)) {
    for (const v of dir.VERTICALS) {
      const hay = `${v.id} ${v.name} ${v.exampleIncumbent || ''}`.toLowerCase();
      const s = terms.filter((t) => hay.includes(t)).length;
      if (s > 0) out.push({ s, title: v.name, link: `https://data.soapbox.community#${v.id}`, live: v.existsInRepo });
    }
  }
  if (nav && Array.isArray(nav.ECOSYSTEM_LINKS)) {
    for (const l of nav.ECOSYSTEM_LINKS) {
      const hay = `${l.label} ${l.key || ''}`.toLowerCase();
      const s = terms.filter((t) => hay.includes(t)).length;
      if (s > 0 && l.url && l.url !== '#') out.push({ s, title: l.label, link: l.url, live: l.live !== false });
    }
  }
  if (!out.length) return null;
  out.sort((a, b) => (b.live === a.live ? b.s - a.s : (b.live ? 1 : 0) - (a.live ? 1 : 0)));
  const top = out.slice(0, 3);
  const lines = top.map((h) => `• ${h.title}${h.live ? '' : ' (coming soon)'} — ${h.link}`);
  return {
    answer: `That's covered by one of our pages:\n${lines.join('\n')}\nAsk me directly and I'll pull what I can, or open the page for the full comparison.`,
    sources: top.map((h) => ({ title: h.title, link: h.link })),
    data: { matches: top },
  };
}

// ── the front door ──────────────────────────────────────────────────────────────────────────────
/**
 * Ask Hathor anything across ALL her knowledge surfaces. Never throws.
 * @param {string} question
 * @param {object} [opts]  forwarded to system-query (e.g. { llm:false } for deterministic answers)
 * @returns {Promise<{ answer:string, vertical:string, sources:Array<{title,link}>, data?:any, grounded:boolean }>}
 */
export async function ask(question, opts = {}) {
  const q = String(question || '').trim();
  if (!q) {
    return { answer: 'Ask me about the markets, a coin or stock price, the Library and our datasets, the Hierophant (sacred texts), coupons & cashback, hemp/cannabis, or any of our SoapBox pages.', vertical: 'empty', sources: [], grounded: false };
  }
  const readers = _readers || defaultReaders();

  // 1. a SPECIFIC vertical reader, when the question is clearly about it
  const vid = routeVertical(q);
  if (vid !== 'system' && vid !== 'empty' && typeof readers[vid] === 'function') {
    const r = await safe(() => readers[vid](q, opts), null);
    if (r && r.answer) return { answer: r.answer, vertical: vid, sources: r.sources || [], data: r.data, grounded: true };
  }

  // 2. the markets/data + Library(datasets) + trust front door
  if (typeof readers.system === 'function') {
    const sys = await safe(() => readers.system(q, opts), null);
    if (sys && sys.answer && sys.grounded) {
      return { answer: sys.answer, vertical: sys.intent || 'system', sources: sys.sources || [], data: sys.data, grounded: true };
    }
    // hold a weak system answer as the last resort below
    var weakSystem = sys; // eslint-disable-line no-var
  }

  // 3. directory pointer for any other SoapBox vertical
  if (typeof readers.directory === 'function') {
    const d = await safe(() => readers.directory(q, opts), null);
    if (d && d.answer) return { answer: d.answer, vertical: 'directory', sources: d.sources || [], data: d.data, grounded: false };
  }

  // 4. fall back to a weak system answer, else an honest miss
  if (typeof weakSystem !== 'undefined' && weakSystem && weakSystem.answer) {
    return { answer: weakSystem.answer, vertical: weakSystem.intent || 'system', sources: [], data: weakSystem.data, grounded: false };
  }
  return { answer: "I don't have that to hand yet, seeker — try the markets, a price, the Library, the Hierophant, coupons, or hemp; or name a SoapBox page and I'll point you to it.", vertical: 'none', sources: [], grounded: false };
}

// ── small extractors ─────────────────────────────────────────────────────────────────────────────
const US_STATES = ['alabama', 'alaska', 'arizona', 'arkansas', 'california', 'colorado', 'connecticut',
  'delaware', 'florida', 'georgia', 'hawaii', 'idaho', 'illinois', 'indiana', 'iowa', 'kansas',
  'kentucky', 'louisiana', 'maine', 'maryland', 'massachusetts', 'michigan', 'minnesota', 'mississippi',
  'missouri', 'montana', 'nebraska', 'nevada', 'new hampshire', 'new jersey', 'new mexico', 'new york',
  'north carolina', 'north dakota', 'ohio', 'oklahoma', 'oregon', 'pennsylvania', 'rhode island',
  'south carolina', 'south dakota', 'tennessee', 'texas', 'utah', 'vermont', 'virginia', 'washington',
  'west virginia', 'wisconsin', 'wyoming'];
function pickUsState(q) {
  const lc = String(q || '').toLowerCase();
  return US_STATES.find((s) => lc.includes(s)) || null;
}
// the store/brand a coupon question is about: an explicit "for X"/"at X", else the longest content word.
function pickStore(q) {
  const m = String(q || '').match(/\b(?:for|at|from|on)\s+([a-z0-9][a-z0-9.&'-]{1,30})/i);
  if (m) return m[1].toLowerCase();
  const t = tokens(q).filter((w) => !['coupon', 'coupons', 'cashback', 'promo', 'code', 'codes', 'discount', 'discounts', 'deal', 'deals', 'voucher', 'save', 'money'].includes(w));
  return t.sort((a, b) => b.length - a.length)[0] || null;
}
function pickStrain(q) {
  const m = String(q || '').match(/\b([a-z][a-z' -]{2,30})\s+(?:strain|kush)\b/i) || String(q || '').match(/\b(?:strain|about)\s+([a-z][a-z' -]{2,30})/i);
  return m ? m[1].trim().toLowerCase() : null;
}

// ── CLI ──────────────────────────────────────────────────────────────────────────────────────────
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const q = args.filter((a) => !a.startsWith('--')).join(' ').trim();
  if (!q) {
    console.error('usage: node integrations/hathor-knows.mjs "<question>"  [--no-llm] [--json]');
    process.exit(1);
  }
  const res = await ask(q, { llm: !args.includes('--no-llm') });
  console.log(res.answer);
  if (res.sources && res.sources.length) console.log('\n— ' + res.sources.map((s) => s.title + (s.link ? ` <${s.link}>` : '')).join('; '));
  if (args.includes('--json')) console.log('\n' + JSON.stringify({ vertical: res.vertical, grounded: res.grounded, data: res.data }, null, 2));
  else console.error(`\n[hathor-knows] vertical=${res.vertical} grounded=${res.grounded}`);
}
