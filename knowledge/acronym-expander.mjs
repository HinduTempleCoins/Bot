// acronym-expander.mjs — a pure transform that makes MELEK wiki/corpus text
// self-explaining without an LLM: it finds acronyms, expands their first use,
// and builds an abbreviation definition list.
//
// WHY THIS EXISTS
//   Maps queue ids 390 (17+ topic folders) and 598bbb (wiki structured data)
//   want the knowledge corpus to read clearly on its own. Articles are dense
//   with project acronyms (DPoS, SMT, VKBT, AMM, RC, WIF). This module is a
//   self-contained, deterministic transform — it NEVER fetches, NEVER calls an
//   LLM, NEVER edits the corpus on disk. It only rewrites strings handed to it.
//
// EXPORTS
//   esc(s)                          — HTML/Markdown-safe escaping for interpolation
//   MELEK_TERMS                     — frozen { ACRONYM: expansion } map (descriptive)
//   detectAcronyms(text)            — [{acronym, count, expansion|null}] for /\b[A-Z]{2,6}\b/
//   expandFirstUse(text, opts)      — rewrites each acronym's FIRST use as 'Expansion (ACRONYM)'
//     opts.map (default MELEK_TERMS) — acronym -> expansion lookup
//   buildAbbreviationList(text, map)— sorted markdown definition list, esc()'d
//
//   import { detectAcronyms, expandFirstUse, buildAbbreviationList, MELEK_TERMS }
//     from './acronym-expander.mjs';

// esc() — escape any value we interpolate into rendered text (HTML-context-safe).
export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// MELEK_TERMS — descriptive expansions of project acronyms. No secrets, no
// hostnames, no key material — just plain-language glossary entries.
export const MELEK_TERMS = Object.freeze({
  DPoS: 'Delegated Proof of Stake',
  SMT: 'Smart Media Token',
  VKBT: 'Van Kush Beauty Token',
  AMM: 'Automated Market Maker',
  RC: 'Resource Credit',
  WIF: 'Wallet Import Format key',
  RPC: 'Remote Procedure Call',
  HF: 'Hardfork',
  NAI: 'Numeric Asset Identifier',
  BCI: 'Brain-Computer Interface',
  TENS: 'Transcutaneous Electrical Nerve Stimulation',
  TDCS: 'Transcranial Direct Current Stimulation',
  VR: 'Virtual Reality',
  LLM: 'Large Language Model',
  KMS: 'Key Management Service',
  TRC: 'Token Resource Contract',
  MBD: 'MELEK-Backed Dollar',
  TBD: 'Testnet-Backed Dollar',
  API: 'Application Programming Interface',
  XMR: 'Monero',
  EVM: 'Ethereum Virtual Machine',
});

// The acronym token pattern: 2-6 uppercase ASCII letters on word boundaries.
// We rebuild a fresh RegExp per scan so the lastIndex state never leaks.
const ACRONYM_RE = () => /\b[A-Z]{2,6}\b/g;

// look up an expansion case-insensitively against a map; null when unknown.
function lookupExpansion(map, acronym) {
  if (!map || typeof map !== 'object') return null;
  if (Object.prototype.hasOwnProperty.call(map, acronym)) {
    const v = map[acronym];
    return typeof v === 'string' && v ? v : null;
  }
  // fall back to a case-insensitive scan so 'tdcs' or 'Tdcs' still matches TDCS.
  const want = acronym.toUpperCase();
  for (const k of Object.keys(map)) {
    if (k.toUpperCase() === want) {
      const v = map[k];
      return typeof v === 'string' && v ? v : null;
    }
  }
  return null;
}

// detectAcronyms — find all /\b[A-Z]{2,6}\b/ tokens, count occurrences, and
// attach the known expansion (or null). Soft-fail: non-string -> [].
//   returns [{acronym, count, expansion|null}] in first-seen order.
export function detectAcronyms(text, { map = MELEK_TERMS } = {}) {
  if (typeof text !== 'string' || !text) return [];
  const order = [];
  const counts = new Map();
  const re = ACRONYM_RE();
  let m;
  while ((m = re.exec(text)) !== null) {
    const a = m[0];
    if (!counts.has(a)) { counts.set(a, 0); order.push(a); }
    counts.set(a, counts.get(a) + 1);
  }
  return order.map((acronym) => ({
    acronym,
    count: counts.get(acronym),
    expansion: lookupExpansion(map, acronym),
  }));
}

// expandFirstUse — rewrite each KNOWN acronym's FIRST occurrence as
// 'Expansion (ACRONYM)'. Later occurrences and unknown acronyms are left
// untouched. Soft-fail: non-string -> ''.
export function expandFirstUse(text, { map = MELEK_TERMS } = {}) {
  if (typeof text !== 'string' || !text) return '';
  const seen = new Set();
  const re = ACRONYM_RE();
  return text.replace(re, (acronym) => {
    if (seen.has(acronym)) return acronym; // only the first use is expanded
    seen.add(acronym);
    const expansion = lookupExpansion(map, acronym);
    if (!expansion) return acronym; // unknown -> leave as-is
    return `${expansion} (${acronym})`;
  });
}

// buildAbbreviationList — a sorted Markdown definition list of the acronyms
// present in `text` that have a known expansion. Everything interpolated is
// esc()'d. Soft-fail: non-string -> ''.
export function buildAbbreviationList(text, map = MELEK_TERMS) {
  if (typeof text !== 'string' || !text) return '';
  const found = detectAcronyms(text, { map })
    .filter((e) => e.expansion)
    .sort((a, b) => a.acronym.localeCompare(b.acronym));
  if (!found.length) return '';
  return found
    .map((e) => `**${esc(e.acronym)}** — ${esc(e.expansion)}`)
    .join('\n');
}
