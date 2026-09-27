// ryan-mind/extract.mjs — segments → CLAIMS.
// Claim: {id, text, quote (verbatim span of the source), source_id, source_kind, source_title, date, at,
//         date_basis, category, categories, confidence, speaker, own, can_supersede, class, context,
//         locator, extractor, correction_marker}
// Two extractors behind one call:
//   • deterministic (always available): sentence split + assertion filter + keyword categoriser.
//   • llm (injectable `llm(prompt) -> string`): asks a LOCAL model for claims + verbatim quotes; any quote
//     that is not literally in the chunk is dropped (never trust a paraphrase as a quote). If the model
//     returns nothing usable for a chunk, the deterministic extractor covers that chunk.
import { sha, splitSentences, contentTokens, normalizeWs, extractJson } from './util.mjs';
import { categorize } from './taxonomy.mjs';
import { OWN_KINDS } from './sources.mjs';

const ASSERT_RE = /\b(is|are|was|were|means|meant|became|becomes|represents|represent|holds|shows|proves|proved|reveals|confirms|confirmed|establishes|contains|derives|descends|equals|refers|serves|functions|creates|created|built|taught|preserves|encodes|remains|survives|connects|corresponds|identifies|called|known as)\b|=|→/i;
const HEDGE_RE = /\b(may|might|possibly|perhaps|could|speculat\w*|hypothes\w*|theor(y|ize|ise)|suggests?|likely|unclear|uncertain)\b/i;
const STRONG_RE = /\b(proves?|proved|confirm(s|ed)|establish(es|ed)|definitive(ly)?|always|never|exactly|certainly|is|are)\b/i;
// explicit self-correction language: a later claim carrying this is a deliberate correction
export const CORRECTION_RE = /\b(correction|corrected|i was wrong|i misspoke|was mistaken|misidentified|mis-identified|misattributed|mis-attributed|previously (?:said|thought|believed|claimed|stated|wrote)|i (?:now )?(?:retract|revise)|revised (?:view|position|reading|claim)|update:|erratum)\b/i;
export function isCorrection(text, context = '') {
  // context counts only when the field ITSELF is a correction (a JSON key "correction"), not a section
  // that merely has "corrections" in its title (those mostly correct outsiders' misconceptions)
  const leaf = String(context ?? '').split(' › ').pop().trim();
  return CORRECTION_RE.test(String(text)) || /^(?:self[ _-]?)?corrections?$/i.test(leaf);
}

/** Does this sentence read as a claim worth keeping? */
export function isClaimSentence(s) {
  const t = String(s).trim();
  if (t.length < 25 || t.length > 600) return false;
  if (/\?\s*$/.test(t)) return false;
  if (/(https?:\/\/|www\.|\b[a-z0-9-]+\.(?:org|com|net|io)\/)/i.test(t)) return false;          // links are citations, not claims
  if (/\b(ISSN|DOI|Pages?:|Vol\.|Manuscript (?:received|accepted))/i.test(t)) return false;     // bibliographic metadata
  if ((t.match(/[0-9:|#\[\]]/g) || []).length / t.length > 0.2) return false;
  if (contentTokens(t).length < 3) return false;
  return ASSERT_RE.test(t);
}

export function confidenceOf(s) {
  let c = 0.55;
  if (STRONG_RE.test(s)) c += 0.1;
  if (HEDGE_RE.test(s)) c -= 0.2;
  if (s.length > 350) c -= 0.05;
  return Math.max(0.1, Math.min(0.95, Math.round(c * 100) / 100));
}

function claimId(sourceId, locator, quote) { return `c-${sha(`${sourceId}|${locator}|${normalizeWs(quote)}`, 14)}`; }

function baseClaim(source, seg, quote, text, tax) {
  const own = !!seg.own;
  const cat = categorize(text, `${seg.context || ''} ${source.title || ''}`, tax);
  return {
    id: claimId(source.id, seg.locator, quote), text, quote,
    source_id: source.id, source_kind: source.kind, source_title: source.title,
    date: seg.date || source.date || null, at: seg.at || null, date_basis: seg.at ? 'exact' : seg.date ? 'segment' : source.date_basis || 'unknown',
    category: cat.category, categories: cat.categories, confidence: confidenceOf(text),
    speaker: seg.speaker || (own ? 'operator' : 'unknown'), own, can_supersede: own && OWN_KINDS.has(source.kind),
    class: 'neutral', context: seg.context || '', locator: seg.locator || '', extractor: 'deterministic-v1',
    correction_marker: isCorrection(text, seg.context),
  };
}

export function extractDeterministic(source, segments, tax, { maxPerSource = Infinity } = {}) {
  const out = []; const seen = new Set();
  for (const seg of segments || []) {
    for (const s of splitSentences(seg.text)) {
      if (out.length >= maxPerSource) return out;
      const q = s.replace(/^(?:>\s*)+/, '').replace(/^[-*•\s]+/, '').replace(/^\d+\.\s+/, '').trim();
      if (!isClaimSentence(q)) continue;
      const key = normalizeWs(q).toLowerCase(); if (seen.has(key)) continue; seen.add(key);
      out.push(baseClaim(source, seg, q, normalizeWs(q.replace(/\*\*|__|`/g, '')), tax));
    }
  }
  return out;
}

/** Group segments into model-sized chunks that never straddle a context change. */
export function chunkSegments(segments, maxChars = 1800) {
  const chunks = []; let cur = null;
  for (const seg of segments || []) {
    const sameCtx = cur && cur.segs[0].context === seg.context && cur.segs[0].own === seg.own && cur.segs[0].at === seg.at;
    if (!cur || !sameCtx || cur.len + seg.text.length > maxChars) { cur = { segs: [], len: 0 }; chunks.push(cur); }
    cur.segs.push(seg); cur.len += seg.text.length;
  }
  return chunks.map((c) => c.segs);
}

export function extractionPrompt(chunkText, context, categoryIds) {
  return [
    'You extract CLAIMS from an author\'s own writing. A claim is one assertion the author makes.',
    'For each claim return: "claim" (the assertion, one sentence), "quote" (the EXACT sentence copied character-for-character from the text that states it),',
    `"category" (one of: ${categoryIds.join(', ')}, or "new:<short name>" if none fits), "confidence" (0-1, how firmly the author asserts it).`,
    'Do not invent. Do not summarise the quote. Return JSON: {"claims":[...]} with at most 8 claims.',
    `Context: ${context || '(none)'}`,
    'TEXT:', chunkText,
  ].join('\n');
}

/** Locate a model-provided quote verbatim in the chunk (whitespace-insensitive). Returns the exact span or null. */
export function locateQuote(quote, chunkText) {
  const q = normalizeWs(quote).replace(/^["'“”]+|["'“”]+$/g, '');
  if (q.length < 20) return null;
  const hay = normalizeWs(chunkText);
  const i = hay.indexOf(q);
  return i >= 0 ? hay.slice(i, i + q.length) : null;
}

/**
 * Extract claims from a registered source's segments.
 * @param {object} source registry record
 * @param {Array} segments reader output
 * @param {object} tax taxonomy
 * @param {{llm?:Function, maxPerSource?:number, onProgress?:Function}} opts
 */
export async function extractClaims(source, segments, tax, { llm = null, maxPerSource = Infinity, onProgress = null } = {}) {
  if (typeof llm !== 'function') return extractDeterministic(source, segments, tax, { maxPerSource });
  const ids = (tax?.categories || []).filter((c) => c.status !== 'retired').map((c) => c.id);
  const out = []; const seen = new Set();
  const chunks = chunkSegments(segments);
  for (let i = 0; i < chunks.length && out.length < maxPerSource; i++) {
    const segs = chunks[i]; const seg0 = segs[0];
    const chunkText = segs.map((s) => s.text).join('\n\n');
    let got = [];
    try {
      const reply = await llm(extractionPrompt(chunkText, seg0.context, ids));
      const j = extractJson(reply);
      const arr = Array.isArray(j) ? j : Array.isArray(j?.claims) ? j.claims : [];
      for (const c of arr) {
        const quote = locateQuote(c?.quote, chunkText); if (!quote) continue;
        const key = quote.toLowerCase(); if (seen.has(key)) continue; seen.add(key);
        const text = normalizeWs(c?.claim || quote).slice(0, 600);
        const claim = baseClaim(source, seg0, quote, text, tax);
        claim.id = claimId(source.id, seg0.locator, quote);
        claim.extractor = llm.modelName || 'llm';
        const cat = String(c?.category || '');
        if (ids.includes(cat)) claim.category = cat;
        else if (/^new:/.test(cat)) claim.suggested_category = cat.slice(4).trim().toLowerCase().slice(0, 40);
        const conf = Number(c?.confidence); if (Number.isFinite(conf) && conf >= 0 && conf <= 1) claim.confidence = Math.round(conf * 100) / 100;
        got.push(claim);
      }
    } catch { got = []; }
    if (!got.length) got = extractDeterministic(source, segs, tax).filter((c) => { const k = c.quote.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
    out.push(...got.slice(0, maxPerSource - out.length));
    if (onProgress) onProgress(i + 1, chunks.length);
  }
  return out;
}
