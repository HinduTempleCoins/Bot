// language-center.mjs — Hathor's LANGUAGE CENTER lobe: where PERCEPTION + KNOWLEDGE + MEMORY become
// one grounded language context the front lobe (Hathor) speaks from.
//
// Operator's brain architecture: Hathor = neocortex/front lobe (she speaks); the Resource Center =
// sensory cortex (always-on perception of markets/chain/data); the Language Center (Broca/Wernicke)
// turns that perception + what we know + what we remember into language. This module is that lobe — it
// fuses three sources into ONE context + sources list:
//   • PERCEPTION  — the Resource Center's current-state line (system-query.briefLine, cached/cheap)
//   • KNOWLEDGE   — the unified front door (hathor-knows.ask): Credentialing, Grants, Hierophant,
//                   markets, Library, Law, Politics… the right vertical, deterministically (no LLM)
//   • MEMORY      — the corpus/Library (our-search) top hits
//
// It does NOT voice the answer (that's Hathor/persona) and does NOT call the big LLM — it ASSEMBLES the
// grounded context. Everything is injectable so it (and hathor-converse, which grounds THROUGH it) run
// fully offline. Soft-fails per source; never throws.
//
//   import { compose, perceive } from './language-center.mjs';
//   const lc = await compose('how do I get TEFL certified?');  // → { context, sources, perception, knowledge, corpus, grounded }

import { search as ourSearch, formatForPrompt } from './our-search.mjs';
import { ask as knowsAsk } from './hathor-knows.mjs';

const safe = (fn, fallback) => Promise.resolve().then(fn).catch(() => fallback);

// ── injectable seams (tests + hathor-converse pass overrides; defaults = the real lobes) ───────────
let _perceive = null; // () => string  (Resource Center current-state line)
let _knows = null;    // (q, opts) => { answer, vertical, sources, grounded }
let _search = null;   // (q, opts) => { hits }
export function __setPerceive(fn) { _perceive = typeof fn === 'function' ? fn : null; }
export function __setKnows(fn) { _knows = typeof fn === 'function' ? fn : null; }
export function __setSearch(fn) { _search = typeof fn === 'function' ? fn : null; }

// Default perception = the Resource Center's one-line state (system-query.briefLine), imported lazily +
// soft so a missing/offline Resource Center is just "no perception", never a crash or a hang.
async function defaultPerceive() {
  try { const m = await import('./system-query.mjs'); return (await m.briefLine()) || ''; }
  catch { return ''; }
}

/** The Resource Center's current-state line (the senses). Never throws; '' if unavailable. */
export async function perceive() {
  const fn = _perceive || defaultPerceive;
  return (await safe(() => fn(), '')) || '';
}

function buildContext({ perception, knowledge, hits }) {
  const parts = [];
  if (perception) parts.push(`Current state (perception, via the Resource Center):\n${perception}`);
  if (knowledge && knowledge.grounded && knowledge.answer) parts.push(`From our ${knowledge.vertical || 'knowledge'} surface:\n${knowledge.answer}`);
  const corpus = formatForPrompt({ hits });
  if (corpus) parts.push(`From the corpus / Library:\n${corpus}`);
  return parts.join('\n\n');
}

function mergeSources(knowledge, hits) {
  const out = [];
  const seen = new Set();
  const add = (s) => {
    if (!s || (!s.title && !s.link)) return;
    const key = String(s.link || s.title).toLowerCase();
    if (seen.has(key)) return;
    seen.add(key); out.push({ title: s.title, link: s.link });
  };
  (knowledge && knowledge.sources || []).forEach(add);
  hits.slice(0, 4).forEach((h) => add({ title: h.title || h.relPath, link: h.link }));
  return out.slice(0, 5);
}

/**
 * Compose the unified language context for a message — perception + knowledge + memory fused. Never
 * throws; each source soft-fails independently. Pass {search, knows, perceive} to override (tests /
 * hathor-converse thread their own seams through).
 * @param {string} message
 * @param {{ k?:number, domain?:string|null, search?:Function, knows?:Function, perceive?:Function }} [opts]
 * @returns {Promise<{ perception, knowledge, corpus, context, sources, vertical, grounded }>}
 */
export async function compose(message, { k = 6, domain = null, search, knows, perceive: perceiveFn } = {}) {
  const msg = String(message || '').trim();
  if (!msg) return { perception: '', knowledge: null, corpus: [], context: '', sources: [], vertical: null, grounded: false };

  const searchFn = search || _search || ((q, o) => ourSearch(q, o));
  const knowsFn = knows || _knows || ((q, o) => knowsAsk(q, o));
  const perceiveOverride = perceiveFn || _perceive;

  // perception (senses) — only via an explicit override here; the default network-y briefLine is opt-in
  // through perceive() so compose() stays cheap + offline-safe by default for the per-message path.
  const perception = perceiveOverride ? ((await safe(() => perceiveOverride(), '')) || '') : '';

  // knowledge (the right vertical, deterministic) + memory (corpus), in parallel, each soft-failing.
  const [known, searchRes] = await Promise.all([
    safe(() => knowsFn(msg, { llm: false }), null),
    safe(() => searchFn(msg, { k, domain }), { hits: [] }),
  ]);
  const hits = (searchRes && searchRes.hits) || [];
  const knowledge = (known && known.grounded && known.answer) ? known : null;

  return {
    perception,
    knowledge,
    corpus: hits,
    context: buildContext({ perception, knowledge, hits }),
    sources: mergeSources(knowledge, hits),
    vertical: knowledge ? knowledge.vertical : null,
    grounded: hits.length > 0 || !!knowledge,
  };
}

// ── CLI ───────────────────────────────────────────────────────────────────────
const isMain = process.argv[1] && process.argv[1].endsWith('language-center.mjs');
if (isMain) {
  const q = process.argv.slice(2).filter((a) => !a.startsWith('--')).join(' ');
  if (!q) { console.error('usage: language-center.mjs "<message>"'); process.exit(1); }
  // CLI shows the FULL lobe incl. live perception
  const lc = await compose(q, { perceive });
  console.log('PERCEPTION:', lc.perception || '(none)');
  console.log('\nVERTICAL:', lc.vertical || '(corpus only)', '· grounded:', lc.grounded);
  console.log('\nCONTEXT:\n' + (lc.context || '(empty)'));
  console.log('\nSOURCES:', lc.sources.map((s) => s.title).filter(Boolean).join('; ') || '(none)');
}
