// draft.mjs — THE DRAFTING SEAM. Deliberately NOT wired to any model.
//
// ════════════════════════════════════════════════════════════════════════════
//  THE ENGINE IS THE OPERATOR'S CALL. He is choosing the drafting model
//  separately. Nothing in this repo may pick one for him. `draft()` below
//  returns { ok:false, unwired:true } until someone passes an engine in with
//  __setEngine(), and no module in integrations/carthage/ ever calls it.
// ════════════════════════════════════════════════════════════════════════════
//
// What this file DOES do is assemble the context an engine will need, so that wiring one up later
// is a one-line change and not a research project. assembleBrief() is pure: it takes a bulletpoint
// and its dossier and returns structured context — the author's own words about what belongs
// there, the sourced passages with their provenance, the voice rules and the quality-control
// checklist, all quoted from the operator's reading guides. It writes NO prose.
//
// The voice rules are the guides' own, verbatim, because getting them wrong is the failure mode
// they were written to prevent:
//   Part 2 § What NOT to Do — Don't write like this: "The ancient Egyptians believed that…"
//     "Scholars have suggested…" "It is important to note…" "In conclusion…"
//     DO write like this: "We can see this represented in…" "This is the same concept as…"
//     "What we are looking at when we…" "This then becomes…"
//   Part 1 § FINAL GUIDANCE — "You are not explaining. You are revealing."
//   Part 1 § CRITICAL CONTEXT — "Think of yourself as a medieval scribe completing an illuminated
//     manuscript, not an editor restructuring it."

import { esc } from './parse.mjs';

// ── the guides' rules, quoted ────────────────────────────────────────────────
export const VOICE = Object.freeze({
  never: Object.freeze([
    'The ancient Egyptians believed that…',
    'Scholars have suggested…',
    'It is important to note…',
    'In conclusion…',
  ]),
  always: Object.freeze([
    'We can see this represented in…',
    'This is the same concept as…',
    'What we are looking at when we…',
    'This then becomes…',
  ]),
  register: Object.freeze([
    'Direct address to the reader; pedagogical, initiatory, consciousness-shifting.',
    'Narrative prose with stories inside the frameworks — not academic monotone.',
    'Primary source quotation, then the author\'s interpretation, then the synthesis.',
    'Cross-cultural synthesis: Egyptian → Greek → Hebrew → Aboriginal Australian, one illuminating another.',
    'Scientific and mythological together ("in modern terms would be an Element of Gravity").',
    'Diasporic, not atomic-family: nation-group histories and cultural movements.',
    'You are not explaining. You are revealing.',
  ]),
});

// Part 2 § QUALITY CONTROL CHECKLIST + Part 1 § QUALITY CONTROL, merged and de-duplicated.
export const QC_CHECKLIST = Object.freeze([
  'Type E bulletpoint identified and verified as a placeholder, not a section header',
  'Email archive searched for it',
  'Expansion material compiled',
  'Paragraphs drafted in the author\'s voice',
  'Cross-references noted for all 19 Books',
  'Integration points smooth — no jarring transitions',
  'No academic tone',
  'Direct address maintained',
  'Initiatory teaching quality present',
  '"We can see" rather than "It is believed"',
  'Revelatory, not explanatory',
  'Primary source quotations preserved exactly',
  'The author\'s exact words used wherever he provided them',
  'No modernizing or "cleaning up" of the original text',
  'No over-expansion of material that belongs in a later Book — flag "will expand in Book X" instead',
  'No orphan bulletpoints left behind',
]);

/**
 * Assemble everything an engine would need. PURE — reads nothing, calls nothing, writes no prose.
 * @param {{bulletpoint?:object, dossier?:object}} input
 * @returns {{ok, placeholder, note, placement, target, passages, voice, qc, instruction}}
 */
export function assembleBrief({ bulletpoint, dossier } = {}) {
  const bp = bulletpoint || dossier?.bulletpoint || {};
  const d = dossier || {};
  const est = bp.estimate || {};
  return {
    ok: !!(bp && bp.text),
    placeholder: bp.text || '',
    // the operator's own instruction on this item, where he left one (e.g. #23 Sacred Tales:
    // "looks like Header, but I need my own Words between the Quotes")
    note: bp.note || null,
    placement: {
      book: bp.book ?? bp.bookNumber ?? null,
      bookTitle: bp.bookTitle || null,
      line: bp.line ?? null,
      contextBefore: bp.contextBefore || d.bulletpoint?.contextBefore || [],
      contextAfter: bp.contextAfter || d.bulletpoint?.contextAfter || [],
    },
    target: {
      minParagraphs: est.minParagraphs ?? 5,
      maxParagraphs: est.maxParagraphs ?? 7,
      storyPoints: est.points ?? null,
      basis: est.basis || 'guides: "Average: 5-7 paragraphs each"',
    },
    // every passage keeps its provenance; a claim without a source does not go in the book
    passages: (d.entries || []).map((e) => ({
      tier: e.tier,
      tierName: e.tierName,
      title: e.title,
      quote: e.quote,
      date: e.date || null,
      provenance: e.provenance || null,
      publicDomain: e.publicDomain || null,
    })),
    voice: VOICE,
    qc: QC_CHECKLIST,
    instruction:
      'Expand this Type E bulletpoint into the stated number of paragraphs, in the author\'s own ' +
      'voice, using the supplied passages. Every claim must trace to one of them. Do not ' +
      'reorganize the surrounding text; complete it.',
  };
}

/** Human-readable version of the brief. esc()\'d; still no prose. */
export function renderBrief(brief) {
  if (!brief || !brief.ok) return '';
  const l = [
    `PLACEHOLDER: ${esc(brief.placeholder)}`,
    brief.note ? `AUTHOR'S NOTE: ${esc(brief.note)}` : '',
    `PLACEMENT: Book ${esc(String(brief.placement.book ?? '?'))} (${esc(brief.placement.bookTitle || '')}) line ${esc(String(brief.placement.line ?? '?'))}`,
    `TARGET: ${esc(String(brief.target.minParagraphs))}-${esc(String(brief.target.maxParagraphs))} paragraphs · ${esc(String(brief.target.storyPoints ?? '?'))} story points — ${esc(brief.target.basis)}`,
    '',
    `SOURCED PASSAGES (${esc(String(brief.passages.length))}):`,
  ].filter(Boolean);
  for (const p of brief.passages) {
    const pr = p.provenance || {};
    l.push(`  [${esc(p.tierName || '')}] ${esc(p.title || '')} — ${esc(pr.file || pr.url || '')}${pr.line ? `:${esc(String(pr.line))}` : ''}`);
  }
  l.push('', 'VOICE — never:', ...VOICE.never.map((s) => `  ✗ ${esc(s)}`));
  l.push('VOICE — always:', ...VOICE.always.map((s) => `  ✓ ${esc(s)}`));
  return l.join('\n');
}

// ── the seam ─────────────────────────────────────────────────────────────────
let _engine = null;
/**
 * Install the drafting engine. UNSET BY DEFAULT AND NOT SET ANYWHERE IN THIS REPO — the operator
 * is choosing the model. An engine is `async ({ brief, bulletpoint, dossier }) => ({ ok, text })`.
 */
export function __setEngine(fn) { _engine = typeof fn === 'function' ? fn : null; }
export function isWired() { return !!_engine; }

/**
 * draft({ bulletpoint, dossier }) — the one call the runner will make once an engine exists.
 * With no engine installed it returns the assembled brief and `ok:false`, so the pipeline can be
 * exercised end to end without a model and without a single word of expansion prose being written.
 */
export async function draft({ bulletpoint, dossier } = {}) {
  const brief = assembleBrief({ bulletpoint, dossier });
  if (!_engine) {
    return {
      ok: false,
      unwired: true,
      reason: 'drafting engine not wired — the operator is choosing the model',
      brief,
      text: null,
    };
  }
  try {
    const out = await _engine({ brief, bulletpoint, dossier });
    const text = out && typeof out.text === 'string' ? out.text : null;
    return { ok: !!text, unwired: false, reason: text ? null : 'engine returned no text', brief, text };
  } catch (e) {
    return { ok: false, unwired: false, reason: e && e.message ? e.message : String(e), brief, text: null };
  }
}
