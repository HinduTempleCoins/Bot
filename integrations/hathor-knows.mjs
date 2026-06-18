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
const safeCall = (fn) => { try { return fn(); } catch { return null; } }; // sync soft-call
const cap = (s) => String(s || '').charAt(0).toUpperCase() + String(s || '').slice(1);
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
  {
    id: 'law', label: 'Law',
    // case law / statutes / regulations. A U.S. Code or case citation is a strong signal.
    test: (q) => /\b\d+\s*u\.?\s?s\.?\s?c\.?\s*(?:§|sec)?/i.test(q)
      || re('case ?law', 'statute', 'supreme court', 'lawsuit', 'litigation', 'legal precedent',
        'court ruling', 'court case', 'u\\.?s\\.? code', 'cfr', 'regulation', 'plaintiff', 'defendant',
        'first amendment', 'fourth amendment', 'felony', 'misdemeanor', 'jurisdiction', 'appeal',
        'is it legal', 'what does the law say', 'my legal rights').test(q),
  },
  {
    id: 'politics', label: 'Politics',
    test: (q) => re('senator', 'senators', 'congressman', 'congresswoman', 'congress', 'congressional',
      'representative', 'legislator', 'legislators', 'house of representatives', 'the senate',
      'campaign finance', 'who represents', 'my rep', 'member of congress', 'governor',
      'voting record', 'roll call').test(q),
  },
  {
    id: 'credentials', label: 'Credentials',
    // how to get credentialed — certifications, accreditors, credit-by-exam, the free paths.
    test: (q) => re('credential', 'credentials', 'certification', 'certifications', 'certificate',
      'certified', 'accredit\\w*', 'ceu', 'ceus', 'continuing education', 'tefl', 'tesol', 'celta',
      'clep', 'college credit', 'credit by exam', 'iacet', 'saylor', 'modern ?states', 'comptia',
      'osha', 'cdl', 'servsafe', 'how (do|to) (i )?get certified', 'teach english').test(q),
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
  return { hierophant: hierophantReader, coupons: couponsReader, cannabis: cannabisReader, law: lawReader, politics: politicsReader, credentials: credentialsReader, system: systemReader, directory: directoryReader };
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

// Law: a U.S. Code citation → the official statute card (pure, offline). A case citation → the case
// (network). Else a topical case search via CourtListener (keyless, low-rate). Soft-fails to null so
// the directory pointer (law.soapbox.community) covers the miss.
async function lawReader(q) {
  const lawSrc = [{ title: 'Law — case law, statutes, regulations', link: 'https://law.soapbox.community' }];
  // 1. U.S. Code statute citation — e.g. "7 U.S.C. 1639o", "21 USC § 802"
  const usc = String(q).match(/\b\d+\s*u\.?\s?s\.?\s?c\.?\s*(?:§+\s*|sec(?:tion)?\.?\s*)?\d+[a-z0-9-]*/i);
  if (usc) {
    const mod = await safe(() => import('./soapbox/uscode.mjs'), null);
    const card = mod && typeof mod.citationCard === 'function' ? safeCall(() => mod.citationCard(usc[0])) : null;
    if (card) {
      const links = [card.corneliiUrl && { title: `Cornell LII — ${card.normalized}`, link: card.corneliiUrl }, card.olrcUrl && { title: 'OLRC — official text', link: card.olrcUrl }].filter(Boolean);
      return { answer: `${card.normalized} — Title ${card.title} of the U.S. Code, § ${card.section}. The official text lives at the OLRC; the annotated version at Cornell LII. (More — case law, regulations — at law.soapbox.community.)`, sources: links.length ? links : lawSrc, data: { card } };
    }
  }
  // 2. case citation (U.S. Reports), network → soft-fail
  const caseCite = String(q).match(/\b\d+\s+u\.?\s?s\.?\s+\d+\b/i);
  if (caseCite) {
    const mod = await safe(() => import('./soapbox/caselaw-cap.mjs'), null);
    const c = mod && typeof mod.caseByCitation === 'function' ? await safe(() => mod.caseByCitation(caseCite[0]), null) : null;
    const nm = c && (c.caseName || c.name);
    if (nm) return { answer: `${nm}${c.court ? ` — ${c.court}` : ''}${c.dateFiled || c.year ? ` (${c.dateFiled || c.year})` : ''}: ${(c.snippet || '').slice(0, 240) || 'see the full opinion linked.'}`, sources: [c.url ? { title: nm, link: c.url } : lawSrc[0]], data: { case: c } };
  }
  // 3. topical case search (keyless, low-rate), network → soft-fail to null
  const mod = await safe(() => import('./soapbox/courtlistener-opinions.mjs'), null);
  if (mod && typeof mod.searchCases === 'function') {
    const cases = await safe(() => mod.searchCases({ q, limit: 3 }), []);
    if (cases && cases.length) {
      const lines = cases.slice(0, 3).map((c) => `• ${c.caseName || c.name}${c.court ? ` — ${c.court}` : ''}${c.dateFiled ? ` (${c.dateFiled})` : ''}`);
      const sources = cases.slice(0, 3).map((c) => ({ title: c.caseName || c.name, link: c.url })).filter((s) => s.link);
      return { answer: `Cases on that, from the public record (CourtListener):\n${lines.join('\n')}\n(Full opinions, statutes and regulations at law.soapbox.community. Educational, not legal advice.)`, sources: sources.length ? sources : lawSrc, data: { cases: cases.slice(0, 3) } };
    }
  }
  // no data this pass → stay in the legal domain with a pointer (don't fall through to markets)
  return { answer: 'I cover case law, statutes and regulations at law.soapbox.community. Give me a citation (e.g. "7 U.S.C. 1639o" or "410 U.S. 113") or a topic and I\'ll pull what I can. (Educational — not legal advice.)', sources: lawSrc, data: {} };
}

// Politics: a named member of Congress → their public-record card; a state → that state's delegation.
// Keyless (unitedstates/congress-legislators). Network → soft-fails to null (directory pointer covers).
async function politicsReader(q) {
  const mod = await safe(() => import('./soapbox/congress-legislators.mjs'), null);
  if (!mod) return null;
  const state = pickUsState(q);
  if (state && re('senator', 'senators', 'representative', 'representatives', 'congress', 'congressional', 'delegation', 'member', 'who represents').test(q) && typeof mod.currentLegislators === 'function') {
    const rows = await safe(() => mod.currentLegislators({ state: STATE_ABBR[state] || state }), []);
    if (rows && rows.length) return fmtLegislators(rows, `Current members of Congress for ${cap(state)}`);
  }
  const name = pickPersonName(q);
  if (name && typeof mod.findByName === 'function') {
    const hits = await safe(() => mod.findByName(name), []);
    if (hits && hits.length) return fmtLegislators(hits, `In Congress, matching "${name}"`);
  }
  // no data this pass → stay in the politics domain with a pointer (don't fall through to markets)
  return { answer: 'I cover members of Congress, elections and campaign finance at politics.soapbox.community. Name a legislator (e.g. "senator Sanders") or a state ("senators from Vermont") and I\'ll pull the public record.', sources: [{ title: 'Politics — legislators, elections, campaign finance', link: 'https://politics.soapbox.community' }], data: {} };
}

function fmtLegislators(rows, header) {
  const top = rows.slice(0, 6);
  const lines = top.map((r) => `• ${r.name} — ${r.party || '?'}, ${r.chamber || '?'}${r.state ? ` (${r.state}${r.district ? `-${r.district}` : ''})` : ''}`);
  return {
    answer: `${header}:\n${lines.join('\n')}${rows.length > top.length ? `\n…and ${rows.length - top.length} more.` : ''}\n(Voting records, campaign finance and more at politics.soapbox.community.)`,
    sources: [{ title: 'Politics — legislators, elections, campaign finance', link: 'https://politics.soapbox.community' }],
    data: { legislators: top.map((r) => ({ name: r.name, party: r.party, chamber: r.chamber, state: r.state, district: r.district, bioguide: r.bioguide })) },
  };
}

// Credentials: the by-industry credentialing catalog (pure, offline) — certifications, accreditors,
// credit-by-exam, the free paths. Always answers (catalog is local); never null.
async function credentialsReader(q) {
  const mod = await safe(() => import('./soapbox/credentials-catalog.mjs'), null);
  if (!mod || typeof mod.search !== 'function') return null;
  const src = { title: 'SoapBox Credentials — by industry', link: 'https://credentials.soapbox.community' };
  const hits = safeCall(() => mod.search(q, { limit: 4 })) || [];
  if (hits.length) {
    const costWord = { free: 'free', low: 'low cost', paid: 'paid' };
    const lines = hits.map((x) => `• ${x.name} (${costWord[x.cost] || x.cost}) — ${(x.what || '').slice(0, 150)}`);
    const sources = hits.slice(0, 3).map((x) => ({ title: x.name, link: x.url }));
    return { answer: `Credential paths for that:\n${lines.join('\n')}\nMore, organized by industry, at credentials.soapbox.community.`, sources: [...sources, src].slice(0, 4), data: { credentials: hits.map((x) => x.id) } };
  }
  const inds = (mod.INDUSTRIES || []).slice(0, 6).map((i) => i.name).join('; ');
  return { answer: `I map credentialing by industry at credentials.soapbox.community — ${inds}, and more. Tell me a field or goal (e.g. "teach English", "free college credit", "IT support") and I'll point you to the path.`, sources: [src], data: {} };
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
// full state name → 2-letter postal abbr (congress-legislators filters by abbr)
const STATE_ABBR = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA', colorado: 'CO',
  connecticut: 'CT', delaware: 'DE', florida: 'FL', georgia: 'GA', hawaii: 'HI', idaho: 'ID',
  illinois: 'IL', indiana: 'IN', iowa: 'IA', kansas: 'KS', kentucky: 'KY', louisiana: 'LA',
  maine: 'ME', maryland: 'MD', massachusetts: 'MA', michigan: 'MI', minnesota: 'MN', mississippi: 'MS',
  missouri: 'MO', montana: 'MT', nebraska: 'NE', nevada: 'NV', 'new hampshire': 'NH', 'new jersey': 'NJ',
  'new mexico': 'NM', 'new york': 'NY', 'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH',
  oklahoma: 'OK', oregon: 'OR', pennsylvania: 'PA', 'rhode island': 'RI', 'south carolina': 'SC',
  'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT', vermont: 'VT', virginia: 'VA',
  washington: 'WA', 'west virginia': 'WV', wisconsin: 'WI', wyoming: 'WY',
};
// a person's name from a politics question: strip title/framing words, keep the capitalized name run.
const POL_TITLES = new Set(['senator', 'sen', 'representative', 'rep', 'congressman', 'congresswoman',
  'congress', 'governor', 'gov', 'president', 'who', 'is', 'my', 'the', 'about', 'find', 'mr', 'mrs', 'ms', 'dr']);
function pickPersonName(q) {
  const words = String(q || '').replace(/[?.,!]/g, '').split(/\s+/);
  const run = [];
  for (const w of words) {
    if (/^[A-Z][a-zA-Z.'-]+$/.test(w) && !POL_TITLES.has(w.toLowerCase())) run.push(w);
    else if (run.length) break; // take the first capitalized run
  }
  const name = run.join(' ').trim();
  return name.length >= 2 ? name : null;
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
