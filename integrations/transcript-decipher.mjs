// transcript-decipher.mjs — fix improperly-transcribed speech using OUR corpus as the basis.
//
// Operator (2026-06-20): auto-transcripts (YouTube ASR) mis-hear domain terms; use our Claude-chat
// conversations — Sasha SHULGIN, Terence MCKENNA at PRAGUE, "me and the Atheists" — as a basis for
// DECIPHERING what is actually being said. ASR fails hardest on proper nouns and jargon it has never
// seen; if WE have the vocabulary, we can repair it. This module is that repair: a domain GLOSSARY of
// canonical terms + their common mis-hearings, a deterministic fuzzy corrector, and an optional ensemble
// pass that uses the glossary as context to fix the rest.
//
// Pure + injectable (the glossary and `complete` are passed in) → offline-testable. Soft-fails: with no
// glossary and no model it returns the text unchanged. House style: ESM, CLI guard, handler(req,res).

// Seed glossary from the operator's named domains. `variants` are common ASR mishearings (lowercased).
// Extend this from the ingested Claude-chat corpus (task #35) + knowledge/oilahuasca/* as it grows.
// textOf(): the ONLY safe way to read a completion. See its doc in llm-router.mjs —
// the naive `String(r.text || r)` idiom silently produced the literal "[object Object]".
import { textOf } from './llm-router.mjs';

export const SEED_GLOSSARY = [
  { canon: 'Sasha Shulgin', variants: ['sasha shogun', 'sasha schulgin', 'sasha sholgin', 'sasha shulgen', 'sasha sholgun', 'shulgin', 'shogun'] },
  { canon: 'Ann Shulgin', variants: ['ann shogun', 'anne shulgin', 'ann schulgin'] },
  { canon: 'Terence McKenna', variants: ['terrence mckenna', 'terence mckinna', 'terrence mckinna', 'terrence mckinnon', 'terence mckenzie', 'terrance mckenna', 'mckenna'] },
  { canon: 'Dennis McKenna', variants: ['dennis mckinna', 'dennis mckenzie'] },
  { canon: 'Prague', variants: ['prog', 'prag', 'prague czech', 'praga'] },
  { canon: 'entheogen', variants: ['entheo gen', 'in theo gen', 'antheogen', 'enthiogen'] },
  { canon: 'psilocybin', variants: ['silo sybin', 'psilocibin', 'silosybin', 'psilo cybin', 'silly cybin'] },
  { canon: 'ayahuasca', variants: ['aya waska', 'iowaska', 'aya huasca', 'ayahuaska'] },
  { canon: 'DMT', variants: ['d m t', 'dmt'] },
  { canon: 'mescaline', variants: ['mescalin', 'mescaleen', 'mesca line'] },
  { canon: 'PiHKAL', variants: ['pikal', 'pee cal', 'pickle'] },
  { canon: 'TiHKAL', variants: ['tikal', 'tee cal'] },
  { canon: 'phenethylamine', variants: ['phenethyl amine', 'fennethylamine', 'phenethylamin'] },
  { canon: 'tryptamine', variants: ['trip tamine', 'tryptamin'] },
  { canon: 'the Logos', variants: ['the low gos', 'the logus'] },
  { canon: 'novelty theory', variants: ['novelty theery'] },
  { canon: 'eschaton', variants: ['eskaton', 'escheton', 'es katon'] },
  { canon: 'gnosis', variants: ['nosis', 'gno sis'] },
  { canon: 'atheist', variants: ['athiest', 'athist'] },
  { canon: 'atheism', variants: ['athiesm', 'aithism'] },
  { canon: 'theist', variants: ['thiest'] },
];

// Build a fast lookup of variant → canon. Longer variants first so multi-word matches win.
function compile(glossary) {
  const entries = [];
  for (const g of glossary || []) for (const v of g.variants || []) entries.push({ v: v.toLowerCase(), canon: g.canon });
  entries.sort((a, b) => b.v.length - a.v.length);
  return entries;
}

/**
 * Deterministic glossary correction. Replaces known mishearings with canonical terms in ONE left-to-right
 * pass (a combined longest-first alternation) so an inserted canonical form is never re-scanned — e.g.
 * "Sasha Shulgin" does not get re-matched by the "shulgin" variant into "Sasha Sasha Shulgin".
 * @returns {{ text, corrections:{from,to,count}[] }}
 */
export function correctWithGlossary(text, glossary = SEED_GLOSSARY) {
  const entries = compile(glossary); // longest variant first
  if (!entries.length) return { text: String(text || ''), corrections: [] };
  const byVariant = new Map(entries.map((e) => [e.v, e.canon]));
  const esc = (v) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`\\b(${entries.map((e) => esc(e.v)).join('|')})\\b`, 'gi');
  const counts = new Map();
  const out = String(text || '').replace(re, (m) => {
    const canon = byVariant.get(m.toLowerCase());
    if (!canon) return m;
    counts.set(m.toLowerCase(), (counts.get(m.toLowerCase()) || 0) + 1);
    return canon;
  });
  const corrections = [...counts].map(([from, count]) => ({ from, to: byVariant.get(from), count }));
  return { text: out, corrections };
}

const REFINE_HINT = (terms) => [
  'You are repairing a speech-to-text transcript that mis-hears proper nouns and jargon. Fix ONLY clear',
  'mistranscriptions — names, places, technical terms. Do NOT paraphrase, summarize, or change meaning,',
  'tone, or sentence structure. Keep filler and grammar as-is. Output ONLY the corrected transcript.',
  terms.length ? `Known correct vocabulary that may appear (use exact spelling): ${terms.join(', ')}.` : '',
  '', 'TRANSCRIPT:',
].filter(Boolean).join('\n');

/**
 * Decipher a transcript: deterministic glossary pass, then (optional) an ensemble refine that uses the
 * glossary as context. Soft-fails to the glossary-only result if the model is unavailable.
 * @param {string} text
 * @param {{ glossary?, complete?, refine?:boolean }} opts
 * @returns {Promise<{ text, corrections, refined:boolean }>}
 */
export async function decipher(text, opts = {}) {
  const glossary = opts.glossary || SEED_GLOSSARY;
  const pass1 = correctWithGlossary(text, glossary);
  if (opts.refine === false || typeof opts.complete !== 'function' || !pass1.text.trim()) {
    return { ...pass1, refined: false };
  }
  try {
    const terms = glossary.map((g) => g.canon);
    const r = await opts.complete(`${REFINE_HINT(terms)}\n${pass1.text}`, { task: 'quality' });
    const refined = textOf(r);
    if (refined && refined.length > pass1.text.length * 0.5) return { text: refined, corrections: pass1.corrections, refined: true };
  } catch { /* model down → keep the deterministic pass */ }
  return { ...pass1, refined: false };
}

export function handler(req, res) {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', async () => {
    let p = {}; try { p = JSON.parse(body || '{}'); } catch {}
    const out = await decipher(p.text || '', { refine: false }); // handler stays deterministic
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(out, null, 2));
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const sample = 'so terrence mckinna talked about silo sybin and the low gos in prog with sasha shogun';
  correctWithGlossary(sample).corrections.forEach((c) => console.log(`${c.from} → ${c.to} (${c.count})`));
  console.log('\n' + correctWithGlossary(sample).text);
}
