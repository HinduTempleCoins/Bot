// scope-gate.mjs — the corpus scope gate for PUBLIC retrieval surfaces.
//
// WHY: CLAUDE.md puts the harm-reduction library IN scope (history, ethnobotany, pharmacology, dose
// ranges, interactions, testing, set/setting/aftercare) and puts "clandestine synthesis / extraction /
// manufacturing-for-distribution routes for controlled substances" OUT of scope. The corpus contains
// both. `.local/legal`-adjacent audit OILAHUASCA_SHELF_SCOPE_AUDIT.md (2026-08-25) enumerated 24 files
// that are wholly or substantially a manufacture/extraction route, and found the public recall path
// (library-index recall → our-search → hathor-converse → site/hathor-live) had NO scope check at all.
// This module is that check.
//
// WHAT IT DOES: a pure predicate over a corpus relPath. Retrieval for a public surface drops gated
// passages; internal/operator callers pass { internal: true } and get everything. The reference
// material is NOT deleted — it stays in the repo for operator use, it just stops being servable.
//
// TO REVERSE (operator call): set MELEK_SCOPE_GATE=off, or pass { internal: true } at the call site.
//
//   import { isGated, gateItems, gateReason } from './scope-gate.mjs'

// The 24 GATE files, verbatim from the audit's tables (§2, §3, §4, §5).
// Whole-shelf entries end in '/' and gate every file beneath them.
export const GATED = [
  // §3 — entire shelf: 16 ayahuasca extraction TEKs for a Schedule I substance.
  'knowledge/ayahuasca/',
  // §2 — administration recipes + an ethanol-extraction thread.
  'knowledge/oilahuasca/oilahuasca_practical_formulations.json',
  'knowledge/oilahuasca/oilahuasca_space_paste_recipe.json',
  'knowledge/oilahuasca/oilahuasca_dmtnexus_space_booze_thread.json',
  // §4 — cannabinoid synthesis + a cultivation-for-production guide.
  'knowledge/herbs/comprehensive_cannabinoid_synthesis_research.json',
  'knowledge/herbs/cannabinoid_synthesis_thc_threshold_brief.json',
  'knowledge/herbs/marijuana_advanced_growing.json',
  // §5 — the canonical per-compound synthesis procedures.
  'knowledge/shulgin-pihkal-tihkal/pihkal_quotes.json',
  'knowledge/shulgin-pihkal-tihkal/tihkal_quotes.json',
];

const norm = (p) => String(p == null ? '' : p).replace(/^\.\//, '').replace(/\\/g, '/').split('#')[0].trim();

/** Is the gate active? Off only by explicit operator env. Pure w.r.t. its argument. */
export function gateEnabled() {
  const v = (typeof process !== 'undefined' && process.env && process.env.MELEK_SCOPE_GATE) || '';
  return String(v).trim().toLowerCase() !== 'off';
}

/** Is this corpus path out-of-scope for a PUBLIC surface? Pure, deterministic. */
export function isGated(relPath) {
  const p = norm(relPath);
  if (!p) return false;
  return GATED.some((g) => (g.endsWith('/') ? p.startsWith(g) : p === g));
}

/** Why it was gated — for operator-side logging. Returns '' when not gated. */
export function gateReason(relPath) {
  return isGated(relPath)
    ? 'out-of-scope for public serving: manufacture/synthesis/extraction route (CLAUDE.md scope; shelf audit 2026-08-25)'
    : '';
}

/**
 * Drop gated passages from a retrieval result.
 *  items    — array of { relPath, ... } (library-index recall shape).
 *  internal — true for operator/internal callers: no filtering.
 * Soft: a malformed item is passed through untouched rather than throwing.
 */
export function gateItems(items, { internal = false } = {}) {
  if (!Array.isArray(items)) return [];
  if (internal || !gateEnabled()) return items;
  return items.filter((it) => {
    try { return !isGated(it && (it.relPath || it.src)); } catch { return true; }
  });
}

if (process.argv[1] && process.argv[1].endsWith('scope-gate.mjs')) {
  console.log(`MELEK scope gate — enabled=${gateEnabled()}, ${GATED.length} gate rules:\n`);
  for (const g of GATED) console.log('  ' + g);
  const probe = ['knowledge/ayahuasca/dmt_tek_a.json', 'knowledge/herbs/chamomile.json',
                 'knowledge/shulgin-pihkal-tihkal/pihkal_quotes.json', 'knowledge/scripture/the_convergence.md'];
  console.log('\nprobe:');
  for (const p of probe) console.log(`  ${isGated(p) ? 'GATED  ' : 'servable'} ${p}`);
}
