// site-field-autofill.mjs — PURE site-vertical field auto-filler (#281).
//
// The ~25 site verticals (witness school, vankushfamily roadmap, the SoapBox
// law/politics/oversight/hemp/... verticals, alpha gate, etc.) carry record
// objects whose fields are often left blank or stubbed with placeholder text
// ('lorem ipsum', 'TBD', 'TODO', 'coming soon', '...'). Meanwhile the readers
// already fetch real data (pool stats, chain info, ecosystem nav, resource
// center, ~100 modules). This module fills the blanks from that already-fetched
// source data — BY FIELD NAME — and NEVER overwrites a field that holds a real
// (non-blank, non-placeholder) value.
//
// PURE: no network, no fetch of its own, no secrets, no clock, soft-fail
// everywhere — never throws. The caller owns fetching `sources` and persisting
// the returned clone. Seams (__setFetch/__setReader/__setStore/__setClient/
// __setCrypto) are accepted for house-style symmetry; this module needs none.
//
//   import { autofill, reportBlanks, isBlank, esc } from './site-field-autofill.mjs'
//   autofill(record, sources)   -> deep clone with blank/placeholder fields filled
//   reportBlanks(record)        -> [ 'field.path', ... ] still-empty after a fill
//   isBlank(value)              -> true if value is empty / placeholder / whitespace
//
//   node integrations/site-field-autofill.mjs   -> demo fill + blank report

// --- HTML escape (strict; for any HTML interpolation) ----------------------

export function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// --- injectable seams (house-style symmetry; unused by this pure module) ---

let _fetch = null;
let _reader = null;
let _store = null;
let _client = null;
let _crypto = null;
export function __setFetch(f) { _fetch = f; }
export function __setReader(r) { _reader = r; }
export function __setStore(s) { _store = s; }
export function __setClient(c) { _client = c; }
export function __setCrypto(c) { _crypto = c; }

// --- placeholder detection -------------------------------------------------

// Tokens that, as the WHOLE trimmed value (case-insensitive), mean "not filled
// in yet". Kept conservative: a real sentence that merely contains "tbd"
// somewhere is NOT a placeholder — only an exact match counts.
const PLACEHOLDER_TOKENS = new Set([
  'lorem',
  'lorem ipsum',
  'lorem ipsum dolor sit amet',
  'placeholder',
  'tbd',
  'tba',
  'todo',
  'n/a',
  'na',
  'none',
  'null',
  'undefined',
  'coming soon',
  'comingsoon',
  'fill me in',
  'fillme',
  'xxx',
  'xxxx',
  '???',
  '...',
  '…',
  '-',
  '--',
  '—',
]);

// A value is "blank" (eligible to be filled) when it is:
//   - null / undefined
//   - an empty string or whitespace-only string
//   - a string that, trimmed and lowercased, exactly matches a placeholder token
//   - a string of only placeholder punctuation (dots/dashes/question marks)
//   - an empty array or an empty plain object
// Real numbers (incl. 0), booleans (incl. false), non-empty strings/arrays/
// objects are NOT blank and are never overwritten.
export function isBlank(value) {
  try {
    if (value === null || value === undefined) return true;

    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed === '') return true;
      const lower = trimmed.toLowerCase();
      if (PLACEHOLDER_TOKENS.has(lower)) return true;
      // "lorem ipsum ..."-style stub bodies: starts with lorem.
      if (/^lorem ipsum\b/.test(lower)) return true;
      // Only placeholder punctuation (e.g. '....', '---', '???').
      if (/^[.\-–—_?…]+$/.test(trimmed)) return true;
      return false;
    }

    if (Array.isArray(value)) return value.length === 0;

    if (typeof value === 'object') {
      // Empty plain object counts as blank; anything with own keys does not.
      return Object.keys(value).length === 0;
    }

    // numbers (incl. 0), booleans, bigint, etc. — present, not blank.
    return false;
  } catch {
    return false;
  }
}

// --- source candidate lookup -----------------------------------------------

function isFillable(value) {
  // A source value is usable as a fill only if it is itself NOT blank.
  return !isBlank(value);
}

// Case-insensitive, separator-insensitive field-name key (so 'priceFeed',
// 'price_feed', 'Price Feed', 'price-feed' all collide on one normal form).
function normKey(name) {
  return String(name ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s_\-.]+/g, '');
}

// Build a flat lookup of normalized-field-name -> first fillable value found,
// across one or more source objects. Sources are scanned shallowly and one
// level into nested plain objects (readers commonly nest under a namespace,
// e.g. { pool: { hashrate }, chain: { headBlock } }). Earlier sources win.
function buildSourceIndex(sources) {
  const index = new Map();
  const list = normalizeSources(sources);

  const consider = (key, val) => {
    if (!isFillable(val)) return;
    const nk = normKey(key);
    if (!nk) return;
    if (!index.has(nk)) index.set(nk, val);
  };

  for (const src of list) {
    if (!src || typeof src !== 'object') continue;
    for (const [k, v] of Object.entries(src)) {
      // Direct field.
      consider(k, v);
      // One level of nesting: namespace.field — register field name too.
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        for (const [k2, v2] of Object.entries(v)) {
          consider(k2, v2);
        }
      }
    }
  }
  return index;
}

// `sources` may be a single object, an array of objects, or null. Normalize to
// an array of objects, dropping anything that isn't a usable object.
function normalizeSources(sources) {
  if (Array.isArray(sources)) {
    return sources.filter((s) => s && typeof s === 'object');
  }
  if (sources && typeof sources === 'object') return [sources];
  return [];
}

// --- deep clone (structured, soft) -----------------------------------------

// A defensive deep clone that never throws and never shares references with the
// input. Functions and exotic values are dropped to a safe primitive. We avoid
// structuredClone so behavior is identical across node versions and so we can
// silently survive cycles.
function clone(value, seen) {
  try {
    if (value === null || typeof value !== 'object') return value;
    seen = seen || new WeakMap();
    if (seen.has(value)) return seen.get(value);

    if (Array.isArray(value)) {
      const out = [];
      seen.set(value, out);
      for (const item of value) out.push(clone(item, seen));
      return out;
    }

    const out = {};
    seen.set(value, out);
    for (const [k, v] of Object.entries(value)) {
      if (typeof v === 'function') continue; // drop functions
      out[k] = clone(v, seen);
    }
    return out;
  } catch {
    return value;
  }
}

// --- core fill -------------------------------------------------------------

// Recursively walk the cloned record. For every leaf field that isBlank(), look
// up a fillable source value by the field's normalized name and substitute it.
// Real values are never touched. Filling is recorded on `filled` (paths).
function fillInto(node, index, pathPrefix, filled, seen) {
  if (!node || typeof node !== 'object') return;
  seen = seen || new WeakSet();
  if (seen.has(node)) return; // cycle guard
  seen.add(node);

  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) {
      const path = `${pathPrefix}[${i}]`;
      const v = node[i];
      if (v && typeof v === 'object') {
        fillInto(v, index, path, filled, seen);
      }
      // We do not fill blank array *elements* by index name — array slots have
      // no meaningful field name. Only named object fields are filled.
    }
    return;
  }

  for (const [k, v] of Object.entries(node)) {
    const path = pathPrefix ? `${pathPrefix}.${k}` : k;

    if (v && typeof v === 'object') {
      // Empty object/array: try to fill it wholesale by field name first.
      if (isBlank(v)) {
        const candidate = index.get(normKey(k));
        if (candidate !== undefined) {
          node[k] = clone(candidate);
          filled.push(path);
          continue;
        }
      }
      // Otherwise recurse into it.
      fillInto(v, index, path, filled, seen);
      continue;
    }

    if (isBlank(v)) {
      const candidate = index.get(normKey(k));
      if (candidate !== undefined) {
        node[k] = clone(candidate);
        filled.push(path);
      }
    }
  }
}

// Public: return a CLONE of `record` with blank/placeholder fields filled from
// `sources` (by field name). The input record is never mutated. Real values are
// never overwritten. The returned clone carries a non-enumerable-free `_filled`
// is NOT added to keep records clean — use the third arg / reportBlanks instead.
export function autofill(record, sources) {
  try {
    if (!record || typeof record !== 'object') {
      // Nothing to fill; return a safe clone (object) or the value untouched.
      return clone(record);
    }
    const out = clone(record);
    const index = buildSourceIndex(sources);
    const filled = [];
    fillInto(out, index, '', filled);
    return out;
  } catch {
    // Never-throw contract: hand back a best-effort clone of the input.
    try { return clone(record); } catch { return record; }
  }
}

// Public: list the dotted paths of fields that are STILL blank in `record`
// (e.g. after an autofill, the fields no source could supply). Array slots are
// not reported (they have no field name); nested objects are walked.
export function reportBlanks(record) {
  const out = [];
  const seen = new WeakSet();
  const walk = (node, prefix) => {
    if (!node || typeof node !== 'object') return;
    if (seen.has(node)) return; // cycle guard
    seen.add(node);
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) {
        const v = node[i];
        if (v && typeof v === 'object') walk(v, `${prefix}[${i}]`);
      }
      return;
    }
    for (const [k, v] of Object.entries(node)) {
      const path = prefix ? `${prefix}.${k}` : k;
      if (v && typeof v === 'object' && !isBlank(v)) {
        walk(v, path);
        continue;
      }
      if (isBlank(v)) out.push(path);
    }
  };
  try {
    if (!record || typeof record !== 'object') return out;
    walk(record, '');
  } catch {
    // soft-fail: return whatever we gathered.
  }
  return out;
}

// --- CLI demo (guarded) ----------------------------------------------------

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const record = {
    title: 'MELEK Witness School',
    tagline: 'lorem ipsum',          // placeholder -> fill
    description: '',                  // blank -> fill
    priceFeed: 'TBD',                 // placeholder -> fill
    stats: { hashrate: '...', peers: 7 }, // hashrate fills, peers kept
    keepThis: 'real value',           // kept
    links: [],                        // blank array -> fill if source has 'links'
    nested: { unfillable: '' },       // no source -> stays blank
  };
  const sources = {
    chain: { description: 'A founding-witness blockchain.', priceFeed: '0.42 MBD' },
    pool: { hashrate: '12.3 kH/s' },
    tagline: 'Learn to run a MELEK witness.',
    links: ['https://witness.melek.salon', 'https://melek.salon'],
  };

  const filled = autofill(record, sources);
  process.stdout.write('\n=== autofilled record ===\n');
  process.stdout.write(JSON.stringify(filled, null, 2) + '\n');
  process.stdout.write('\n=== still blank ===\n');
  process.stdout.write(JSON.stringify(reportBlanks(filled), null, 2) + '\n');
}
