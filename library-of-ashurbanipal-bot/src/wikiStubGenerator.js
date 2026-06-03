/**
 * Wiki stub generator for back-references (#49)
 *
 * When a generated wiki article links to a term that has no article yet, this module produces a
 * minimal "stub" article for that linked term so the wiki has NO dead links. The stub carries a
 * back-reference to the article that linked to it (so an editor — human or bot — can see why the
 * stub exists) and a `stub: true` marker so a later full-generation pass can find and replace it.
 *
 * This module is PURE: it parses links and builds article objects in memory. It makes NO network
 * calls, reads no files, and never touches the knowledge base. Wiring it into wikiGenerator (so a
 * generation run actually writes the stubs out) is a separate, later step — this file only provides
 * the building blocks and is independently testable.
 *
 * The stub article object matches the shape WikiGenerator.generateArticle returns closely enough to
 * be written by the same .wiki-file path: it has `title`, `content`, and `body`, plus the stub-only
 * fields (`stub`, `linkedFrom`).
 *
 *   import { extractLinkedTerms, findMissingTerms, generateStub, stubsForArticle } from './wikiStubGenerator.js';
 *
 * Soft-fail contract: every function returns an empty result (array / set / null-safe object) for
 * bad input rather than throwing.
 */

/**
 * Normalise a term for case-insensitive comparison. A MediaWiki title is case-insensitive on its
 * first letter and treats spaces/underscores as equivalent, so we lowercase, swap underscores for
 * spaces, and collapse whitespace. Returns '' for non-strings.
 */
export function normaliseTerm(term) {
  if (typeof term !== 'string') return '';
  return term
    .replace(/_/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

/**
 * Extract the set of terms an article links to.
 *
 * Accepts EITHER:
 *   - a string (an article body / wiki markup) — parsed for [[wikilinks]] and [[Target|display]]
 *     forms (only the target before the pipe counts as the linked term);
 *   - an article object — its `.content` / `.body` string is parsed, and any `.links` array it
 *     carries is merged in;
 *   - a links array — each entry may be a string or an object with `.title` / `.target` / `.term`.
 *
 * Section anchors (`[[Target#Section]]`) collapse to the target. Returns a de-duplicated array of
 * the original display-cased terms (first spelling seen wins), preserving discovery order. Returns
 * [] for anything unparseable.
 */
export function extractLinkedTerms(articleBodyOrLinks) {
  const seen = new Map(); // normalised → original casing (first seen)
  const add = (raw) => {
    if (typeof raw !== 'string') return;
    // Drop a section anchor and any pipe display text; keep only the link target.
    let target = raw.split('|')[0].split('#')[0].trim();
    if (!target) return;
    const key = normaliseTerm(target);
    if (!key) return;
    if (!seen.has(key)) seen.set(key, target);
  };

  const scanString = (str) => {
    if (typeof str !== 'string') return;
    const re = /\[\[([^\][]+?)\]\]/g; // [[ ... ]] — non-greedy, no nested brackets
    let m;
    while ((m = re.exec(str)) !== null) add(m[1]);
  };

  const scanLinksArray = (arr) => {
    if (!Array.isArray(arr)) return;
    for (const entry of arr) {
      if (typeof entry === 'string') add(entry);
      else if (entry && typeof entry === 'object') {
        add(entry.title ?? entry.target ?? entry.term ?? entry.name);
      }
    }
  };

  if (typeof articleBodyOrLinks === 'string') {
    scanString(articleBodyOrLinks);
  } else if (Array.isArray(articleBodyOrLinks)) {
    scanLinksArray(articleBodyOrLinks);
  } else if (articleBodyOrLinks && typeof articleBodyOrLinks === 'object') {
    scanString(articleBodyOrLinks.content);
    scanString(articleBodyOrLinks.body);
    scanLinksArray(articleBodyOrLinks.links);
  }

  return [...seen.values()];
}

/**
 * Given the terms an article links to and the set of titles that already have articles, return the
 * linked terms that have NO existing article (case-insensitively). De-duplicates by normalised form
 * and returns the original display casing. Returns [] for bad input.
 *
 * `existingTitles` may be an array or a Set of strings.
 */
export function findMissingTerms(linkedTerms, existingTitles) {
  if (!Array.isArray(linkedTerms)) return [];

  const existing = new Set();
  const source = existingTitles instanceof Set ? existingTitles : (Array.isArray(existingTitles) ? existingTitles : []);
  for (const t of source) {
    const key = normaliseTerm(t);
    if (key) existing.add(key);
  }

  const missing = new Map(); // normalised → original (first seen)
  for (const term of linkedTerms) {
    const key = normaliseTerm(term);
    if (!key) continue;
    if (existing.has(key)) continue;
    if (!missing.has(key)) missing.set(key, typeof term === 'string' ? term.trim() : term);
  }
  return [...missing.values()];
}

/**
 * Build a minimal valid stub article object for a single missing term.
 *
 * @param {string} term            The linked term that has no article.
 * @param {object} [opts]
 * @param {string} [opts.context]  The title of the article that linked to `term` (the back-reference).
 * @returns {object|null}          A stub article object, or null for an unusable term.
 *
 * Shape mirrors WikiGenerator.generateArticle output (title/content/body) and adds:
 *   stub: true            marker so a full-generation pass can find + replace it
 *   linkedFrom: [..]      back-reference(s) to the article(s) that linked here
 */
export function generateStub(term, opts = {}) {
  if (typeof term !== 'string') return null;
  const title = term.trim();
  if (!title) return null;

  const context = opts && typeof opts.context === 'string' ? opts.context.trim() : '';
  const linkedFrom = context ? [context] : [];

  const body = `'''${title}''' is a stub. This article has not been written yet.`;

  // MediaWiki markup, consistent with the generator's footer style. The back-reference is both
  // human-readable prose and a [[wikilink]] so the wiki graph stays connected.
  const lines = [body, ''];
  if (context) {
    lines.push(`This term was linked from [[${context}]].`, '');
  }
  lines.push('{{stub}}');
  const content = lines.join('\n');

  return {
    title,
    content,
    body,
    stub: true,
    linkedFrom,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Produce stub articles for every missing linked term in a single article.
 *
 * @param {object|string} article        The source article (object with content/body/links, or a
 *                                        raw body string). If an object, its `.title` becomes the
 *                                        back-reference context.
 * @param {Array|Set} existingTitles      Titles that already have articles (case-insensitive).
 * @returns {object[]}                     One stub per missing term; [] when nothing is missing or
 *                                         on bad input. Never throws.
 */
export function stubsForArticle(article, existingTitles) {
  try {
    if (!article) return [];

    const context = (article && typeof article === 'object' && typeof article.title === 'string')
      ? article.title
      : '';

    const linked = extractLinkedTerms(article);
    // Don't stub a self-link (an article linking to its own title).
    const selfKey = normaliseTerm(context);
    const missing = findMissingTerms(linked, existingTitles)
      .filter((t) => normaliseTerm(t) !== selfKey);

    const stubs = [];
    for (const term of missing) {
      const stub = generateStub(term, { context });
      if (stub) stubs.push(stub);
    }
    return stubs;
  } catch {
    return [];
  }
}

export default {
  normaliseTerm,
  extractLinkedTerms,
  findMissingTerms,
  generateStub,
  stubsForArticle,
};
