// memory-recall.mjs — the bridge from the deterministic Brief floor to Memory.
//
// A Brief is "deterministic floor + LLM polish" (BRIEF_PROTOCOL.md). The floor
// (briefs/rules-floor.mjs) ranks the backlog into readFirst / doNext / blocked / deferred.
// This adapter adds the third ingredient a good brief wants: *relevant past context*. For the
// top items of a floor it asks Memory (memory/index.mjs → createMemoryIndex → recall) "what do we
// already know that relates to this?" and attaches those hits, so the brief can remind the reader
// of prior annals before they re-do work that's already been recorded.
//
//   import { attachRecall, renderWithContext } from './memory-recall.mjs'
//   const recalls = await attachRecall(floor, memoryIndex, { k: 3 });
//   const md = renderWithContext(floor, recalls);
//
// attachRecall(floor, memoryIndex, { k, top, sections }) -> recalls
//   For each of the top items (default: readFirst ++ doNext, capped at `top`), call
//   memoryIndex.recall(item.text, { k }) and collect { item, related } where related is the
//   recall hits ([{ id, text, meta, score }]). Returns an array preserving floor order.
//
// renderWithContext(floor, recalls) -> markdown
//   The floor skeleton (rules-floor.renderMarkdown) plus a "Related past context" section that
//   lists, per top item, its recalled hits. Plain markdown, every field esc()'d, byte-stable for
//   identical input. Never throws.
//
// Injectable: memoryIndex is any object with a `recall(query, { k }) -> hits` method (the tests
// pass a fake). No db/embed/network here — all of that is Memory's concern, behind that one method.
// Soft-fail-never-throw: a missing/garbage index, a throwing recall, or a malformed floor all
// degrade to empty `related` / an empty section, never an exception.

import { renderMarkdown as renderFloor, esc as _esc } from './rules-floor.mjs';

export const esc = _esc;

const DEFAULT_K = 3;
const DEFAULT_TOP = 6;

/**
 * Pick the "top" items of a floor to enrich: in-progress first, then do-next, in floor order.
 * Falls back to readFirst-only / doNext-only / [] gracefully. Capped at `top`.
 */
function topItems(floor, top, sections) {
  const f = floor && typeof floor === 'object' ? floor : {};
  const which = Array.isArray(sections) && sections.length ? sections : ['readFirst', 'doNext'];
  const out = [];
  for (const key of which) {
    const arr = Array.isArray(f[key]) ? f[key] : [];
    for (const item of arr) {
      if (item && typeof item === 'object') out.push(item);
    }
  }
  const cap = Number.isInteger(top) && top > 0 ? top : DEFAULT_TOP;
  return out.slice(0, cap);
}

/**
 * Augment a rules-floor result with recalled related past context for its top items.
 *
 * @param {object} floor                       a buildFloor(...) result
 * @param {{recall(query:string,opts?:object):Promise<any[]>}} memoryIndex  any recall-capable object
 * @param {object} [opts]
 * @param {number} [opts.k=3]                   hits to recall per item
 * @param {number} [opts.top=6]                 max items to enrich
 * @param {string[]} [opts.sections]            which floor buckets to pull from (default readFirst+doNext)
 * @returns {Promise<Array<{item:object, related:any[]}>>}  floor-ordered, related=[] on any failure
 */
export async function attachRecall(floor, memoryIndex, opts = {}) {
  const o = opts || {};
  const k = Number.isInteger(o.k) && o.k > 0 ? o.k : DEFAULT_K;
  const items = topItems(floor, o.top, o.sections);
  const canRecall = memoryIndex && typeof memoryIndex.recall === 'function';

  const recalls = [];
  for (const item of items) {
    const query = String((item && item.text) || '').trim();
    let related = [];
    if (canRecall && query) {
      try {
        const hits = await memoryIndex.recall(query, { k });
        related = Array.isArray(hits) ? hits : [];
      } catch {
        related = [];
      }
    }
    recalls.push({ item, related });
  }
  return recalls;
}

const recallLine = (hit) => {
  const id = esc((hit && hit.id) ?? '?');
  const score =
    hit && typeof hit.score === 'number' && Number.isFinite(hit.score)
      ? ` _(${hit.score.toFixed(2)})_`
      : '';
  const text = esc(
    String((hit && hit.text) || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 160),
  );
  return `  - \`${id}\`${score} ${text}`;
};

const itemHeading = (item) => {
  const id = esc((item && item.id) ?? '?');
  const text = esc(
    String((item && item.text) || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120),
  );
  return `- \`${id}\` ${text}`;
};

/**
 * Render the floor skeleton plus a "Related past context" section built from `recalls`
 * (the attachRecall output). Plain markdown, esc()'d, byte-stable. Never throws.
 *
 * @param {object} floor                          a buildFloor(...) result
 * @param {Array<{item:object, related:any[]}>} recalls
 * @returns {string} markdown
 */
export function renderWithContext(floor, recalls) {
  let base = '';
  try {
    base = renderFloor(floor);
  } catch {
    base = '';
  }
  if (typeof base !== 'string') base = '';

  const list = Array.isArray(recalls) ? recalls : [];
  const enriched = list.filter((r) => r && r.item && Array.isArray(r.related) && r.related.length);

  const out = [];
  out.push(base.replace(/\n+$/, ''));
  out.push('');
  out.push('## Related past context');
  out.push('');
  if (!enriched.length) {
    out.push('_(no related past context recalled)_');
  } else {
    for (const r of enriched) {
      out.push(itemHeading(r.item));
      for (const hit of r.related) out.push(recallLine(hit));
    }
  }
  while (out.length && out[out.length - 1] === '') out.pop();
  return out.join('\n') + '\n';
}

// --- CLI (guarded) -------------------------------------------------------------------------------
// No live Memory here (it needs a db + embedder). This documents the shape against a tiny fake.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const { buildFloor } = await import('./rules-floor.mjs');
  const floor = buildFloor([
    { id: 'a', file: 'witness/monitor.mjs', text: 'finish the witness monitor', status: 'in_progress' },
    { id: 'b', file: 'signup/help.mjs', text: 'wire signup help', status: 'open' },
  ]);
  const fakeIndex = {
    async recall(query, { k = 3 } = {}) {
      return [{ id: 'annal-1', text: `prior note about: ${query}`, meta: {}, score: 0.91 }].slice(0, k);
    },
  };
  const recalls = await attachRecall(floor, fakeIndex, { k: 2 });
  process.stdout.write(renderWithContext(floor, recalls));
}
