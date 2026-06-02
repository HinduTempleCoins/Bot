// provenance.js — source-grounding / coverage / provenance-log helpers for the wiki generator.
//
// These are the deterministic, network-free pieces of the article-quality pipeline (#69, #72, #89).
// The wikiGenerator feeds them the exact sources it put into the LLM prompt, and they:
//   - buildGroundingFooter(): a real "Sources" footer listing the KB doc ids + external URLs that
//     actually grounded the article (#69) — not a placeholder, not whatever the model improvised.
//   - computeCoverage(): per-section thin-evidence flags (#72). A section with fewer than N grounding
//     tokens/sources is marked "⚠ thin evidence — low confidence".
//   - appendProvenanceLog(): append-only JSONL audit record per article (#89).
//   - writeFactCheckReport(): save the flag-only fact-check report alongside the article (#70 plumbing).
//
// Pure-data functions take their inputs explicitly so they unit-test without a KB, a model, or a clock.
// The file-writing helpers use node built-ins only (no new deps).

import fs from 'node:fs';
import path from 'node:path';

// Default thin-evidence threshold: a section grounded by fewer than this many *sources* (or with
// fewer grounding tokens than MIN_GROUNDING_TOKENS) is low-confidence. Overridable via env so a run
// can tighten/loosen without code edits.
export const MIN_GROUNDING_SOURCES = Number(process.env.WIKI_MIN_GROUNDING_SOURCES || 2);
export const MIN_GROUNDING_TOKENS = Number(process.env.WIKI_MIN_GROUNDING_TOKENS || 120);

const THIN_FLAG = '⚠ thin evidence — low confidence';

/** Rough whitespace token count of a string (deterministic, no tokenizer dep). */
export function tokenCount(text) {
  if (!text) return 0;
  return String(text).trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Normalise the heterogeneous source records the generator collects into one list of
 * { id, kind, tokens } where kind is 'kb' | 'external'. `id` is the KB doc id (e.g.
 * "cryptocurrency/foo.json") or the external URL.
 *
 * @param {Array<{source?:string,id?:string,content?:string,excerpt?:string}>} kbSources
 * @param {Array<{url?:string,title?:string,excerpt?:string}>} externalSources
 */
export function normaliseSources(kbSources = [], externalSources = []) {
  const out = [];
  for (const s of kbSources || []) {
    const id = s.source || s.id;
    if (!id) continue;
    out.push({ id, kind: 'kb', tokens: tokenCount(s.content || s.excerpt || '') });
  }
  for (const e of externalSources || []) {
    const id = e.url || e.title;
    if (!id) continue;
    out.push({ id, kind: 'external', tokens: tokenCount(e.excerpt || ''), title: e.title || e.url });
  }
  // de-dupe by id, summing tokens so a doc fed twice doesn't double-count as two sources.
  const byId = new Map();
  for (const s of out) {
    const prev = byId.get(s.id);
    if (prev) prev.tokens += s.tokens;
    else byId.set(s.id, { ...s });
  }
  return [...byId.values()];
}

/**
 * Build a real, grounded "Sources" footer (#69). Lists the KB doc ids and external URLs that were
 * actually fed into the prompt for this article. Returns '' if there were no grounding sources at all
 * (so we never emit an empty/placeholder footer).
 */
export function buildGroundingFooter(sources = []) {
  const kb = sources.filter((s) => s.kind === 'kb');
  const ext = sources.filter((s) => s.kind === 'external');
  if (!kb.length && !ext.length) return '';
  const lines = ['== Sources (grounding) =='];
  lines.push('<!-- Auto-attached by the generator: the KB documents and external URLs that actually grounded this article. -->');
  if (kb.length) {
    lines.push("''Knowledge base:''");
    for (const s of kb) lines.push(`* <ref>${s.id}</ref>`);
  }
  if (ext.length) {
    lines.push("''External / Resource Center:''");
    for (const s of ext) lines.push(`* ${s.id}`);
  }
  return lines.join('\n') + '\n';
}

/**
 * Split a MediaWiki article body into sections keyed by their == Header ==. The text before the first
 * header is bucketed as "(intro)". Used to attribute grounding evidence per section for coverage.
 */
export function splitSections(wikiText) {
  const sections = [];
  const lines = String(wikiText || '').split('\n');
  let current = { heading: '(intro)', body: [] };
  for (const line of lines) {
    const m = line.match(/^\s*==+\s*(.+?)\s*==+\s*$/);
    if (m) {
      sections.push({ heading: current.heading, body: current.body.join('\n') });
      current = { heading: m[1].trim(), body: [] };
    } else {
      current.body.push(line);
    }
  }
  sections.push({ heading: current.heading, body: current.body.join('\n') });
  return sections.filter((s) => s.body.trim() || s.heading !== '(intro)');
}

/**
 * Coverage / confidence flag (#72). For each section, count the distinct grounding sources it cites
 * (via <ref> tags / URLs) and the section's prose tokens; a section under threshold is flagged thin.
 *
 * Sections that are themselves the provenance footers (Sources / Coverage / See Also / References)
 * are skipped — they are metadata, not content to be graded.
 *
 * @param {string} wikiText      the generated article body
 * @param {Array}  sources       normalised sources (from normaliseSources)
 * @returns {{sections:Array, thin:number, wellCovered:number, summary:string}}
 */
export function computeCoverage(wikiText, sources = []) {
  // metadata/footer headings are not graded as content (matches "Sources", "Sources (grounding)",
  // "Coverage", "Coverage (audit)", "See Also", "References").
  const metaHeads = /^(sources|coverage|see also|references)\b/i;
  const knownIds = new Set(sources.map((s) => String(s.id)));
  const sectionReports = [];
  for (const sec of splitSections(wikiText)) {
    if (metaHeads.test(sec.heading)) continue;
    // grounding sources cited in this section: <ref>…</ref> and bare URLs that match known sources
    const refs = new Set();
    let m;
    const re = /<ref>([^<]+)<\/ref>/g;
    while ((m = re.exec(sec.body))) refs.add(m[1].trim());
    for (const id of knownIds) {
      if (id && sec.body.includes(id)) refs.add(id);
    }
    const tokens = tokenCount(sec.body);
    const sourceCount = refs.size;
    const thin = sourceCount < MIN_GROUNDING_SOURCES || tokens < MIN_GROUNDING_TOKENS;
    sectionReports.push({
      heading: sec.heading,
      tokens,
      sourceCount,
      sources: [...refs],
      thin,
      flag: thin ? THIN_FLAG : 'ok',
    });
  }
  const thin = sectionReports.filter((s) => s.thin).length;
  const wellCovered = sectionReports.length - thin;
  const summary = `Coverage: ${wellCovered}/${sectionReports.length} sections well-grounded, ${thin} thin (< ${MIN_GROUNDING_SOURCES} sources or < ${MIN_GROUNDING_TOKENS} tokens).`;
  return { sections: sectionReports, thin, wellCovered, summary, thinFlag: THIN_FLAG };
}

/**
 * Render a "== Coverage (audit) ==" MediaWiki block from a coverage report (#72). Lists each thin
 * section with the thin-evidence flag so a reader/editor sees exactly which parts are low-confidence.
 */
export function buildCoverageFooter(coverage) {
  if (!coverage || !coverage.sections) return '';
  const lines = ['== Coverage (audit) =='];
  lines.push(`<!-- Auto-attached by the generator. ${coverage.summary} -->`);
  lines.push(coverage.summary);
  for (const s of coverage.sections) {
    if (s.thin) lines.push(`* '''${s.heading}''' — ${THIN_FLAG} (${s.sourceCount} source(s), ${s.tokens} tokens)`);
  }
  if (!coverage.sections.some((s) => s.thin)) lines.push('* All sections meet the grounding threshold.');
  return lines.join('\n') + '\n';
}

/**
 * Append-only provenance audit log (#89). One JSONL line per generated article recording what
 * grounded it, the model used, and the fact-check summary. Uses a passed-in `stamp` (slug/counter)
 * for ordering rather than relying on a clock inside workflow code; a real ISO `generatedAt` may be
 * supplied by the caller (ordinary Node script — real timestamps allowed) but is optional.
 *
 * @param {string} logPath
 * @param {object} record  { stamp, article, sourceDocIds, externalUrls, model, coverage, factCheckSummary, generatedAt }
 * @returns {object} the record actually written (with defaults applied)
 */
export function appendProvenanceLog(logPath, record) {
  const rec = {
    stamp: record.stamp ?? record.article ?? 'unknown',
    article: record.article ?? 'unknown',
    sourceDocIds: record.sourceDocIds ?? [],
    externalUrls: record.externalUrls ?? [],
    model: record.model ?? '',
    coverage: record.coverage ?? null,
    factCheckSummary: record.factCheckSummary ?? null,
    ...(record.generatedAt ? { generatedAt: record.generatedAt } : {}),
  };
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  fs.appendFileSync(logPath, JSON.stringify(rec) + '\n');
  return rec;
}

/**
 * Save a per-article fact-check report (#70) as JSON alongside the article. FLAG-ONLY: this writes a
 * report file; it never rewrites the article or the KB. Each result is {claim, verdict, sourceRef,
 * confidence, ...}; the report is explicitly marked advisory (false positives expected).
 *
 * @param {string} reportPath  e.g. generated-articles/Foo.factcheck.json
 * @param {object} report      { title, topic, total, tally, results }
 * @returns {object} the report object actually written
 */
export function writeFactCheckReport(reportPath, report) {
  const out = {
    advisory: true,
    note: 'FLAG-ONLY advisory fact-check. Verdicts are fallible; false positives are expected. The article and knowledge base are NEVER edited from this report — it is for operator review only.',
    title: report?.title ?? 'untitled',
    topic: report?.topic ?? '',
    total: report?.total ?? (report?.results?.length || 0),
    tally: report?.tally ?? {},
    results: (report?.results || []).map((r) => ({
      claim: r.claim,
      verdict: r.verdict,
      sourceRef: r.sourceRef ?? r.file ?? '',
      confidence: typeof r.confidence === 'number' ? r.confidence : null,
      reason: r.reason ?? '',
      evidence: r.evidence_urls ?? (r.source ? [r.source] : []),
    })),
  };
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(out, null, 2));
  return out;
}
