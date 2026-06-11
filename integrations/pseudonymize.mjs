// pseudonymize.mjs — backlog #00c2102c1e. A reusable PII PSEUDONYMIZER for AI-training corpora.
//
// WHY: text destined for an AI-training corpus must not carry personal identifiers — a real person's
// email, phone, social handle, or name. Unlike secret-redact.mjs (which targets CREDENTIALS: WIF keys,
// JWTs, passwords, and discards the value forever), this module targets PII in human prose and replaces
// each distinct value with a STABLE, TYPED placeholder ([PERSON_1], [PHONE_2], [HANDLE_1], [NAME_3]).
// The mapping is REVERSIBLE — but only via the returned map, which the caller keeps. The placeholder
// text itself carries no original value, so the corpus is safe to ship while the caller can re-hydrate.
//
// CONTRACT:
//   pseudonymize(text, opts?) -> { text, map }
//       opts.names?: string[]  — caller-supplied personal names to pseudonymize as [NAME_n].
//       Replaces, with a consistent placeholder per distinct value within ONE call:
//         email addresses           -> [PERSON_n]   (an email identifies a person)
//         phone numbers             -> [PHONE_n]
//         @handles                  -> [HANDLE_n]
//         each names[] entry        -> [NAME_n]
//   buildMap(text, names) -> Map<original, placeholder>   (the mapping only; does not rewrite text)
//   applyMap(text, map)   -> string                       (applies an existing map to text)
//
// DESIGN RULES (match integrations/ house style):
//   • PURE + DETERMINISTIC — no I/O, no env, no network, no LLM. Numbering is by FIRST-APPEARANCE order.
//   • SOFT — never throws. Non-string text -> { text: '', map: new Map() }. Bad opts are ignored.
//   • REVERSIBLE VIA MAP ONLY — the original value lives in the returned Map (caller-held), never inside
//     the emitted text. Apply applyMap(out.text, invert(out.map)) to reverse (see note below).
//   • ORDER MATTERS — emails are matched BEFORE @handles and phones so an address isn't half-eaten by
//     the handle/phone rules; caller names run LAST as a plain literal pass.
//
//   import { pseudonymize, buildMap, applyMap } from './pseudonymize.mjs'
//   pseudonymize('mail jo@x.com', { names: [] }).text  // -> 'mail [PERSON_1]'

// Detector rules in priority order. Each: [regex(global), typePrefix]. The most specific / highest-signal
// shapes run first so an email is classified as PERSON before the @handle or phone rules can fragment it.
const DETECTORS = [
  // Email address. Run FIRST — its local-part and domain would otherwise trip the handle/phone rules.
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, 'PERSON'],

  // @handle (social / chain handle): leading @, then 1+ handle chars. Run after email so an email's
  // "@domain" is already consumed. The (?<![\w@.]) guard stops it matching mid-token (e.g. an email tail).
  [/(?<![\w@.])@[A-Za-z0-9_][A-Za-z0-9_.-]*/g, 'HANDLE'],

  // Phone number: an international/grouped run of 7+ digits with optional +, spaces, dashes, parens, dots.
  // Requires at least 7 digits total so short numerics (years, small counts) aren't swallowed.
  [/\+?\d[\d\s().-]{5,}\d/g, 'PHONE'],
];

// Minimum digit count for a PHONE match — guards against grabbing short numeric runs.
const PHONE_MIN_DIGITS = 7;

/**
 * Build the original->placeholder mapping for `text` + caller-supplied `names`, in first-appearance
 * order. Pure, deterministic, never throws. Does NOT rewrite the text — see applyMap / pseudonymize.
 * @param {string} text
 * @param {string[]} [names]
 * @returns {Map<string,string>}
 */
export function buildMap(text, names) {
  const map = new Map();
  const s = typeof text === 'string' ? text : '';
  if (!s) return map;

  const counters = { PERSON: 0, PHONE: 0, HANDLE: 0, NAME: 0 };
  // Track each value's first-appearance index so numbering follows document order across all types.
  const hits = []; // { index, value, prefix }

  for (const [re, prefix] of DETECTORS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(s)) !== null) {
      const value = m[0];
      if (m.index === re.lastIndex) re.lastIndex++; // zero-width guard
      if (!value) continue;
      if (prefix === 'PHONE') {
        const digits = (value.match(/\d/g) || []).length;
        if (digits < PHONE_MIN_DIGITS) continue;
      }
      hits.push({ index: m.index, value, prefix });
    }
  }

  // Caller names: a plain literal pass. Each name's first index in the text decides its order; names
  // not present in the text still get a placeholder (so a map can be pre-seeded), placed at end of order.
  const nameList = Array.isArray(names) ? names.filter((n) => typeof n === 'string' && n.length) : [];
  for (const name of nameList) {
    const idx = s.indexOf(name);
    hits.push({ index: idx === -1 ? Infinity : idx, value: name, prefix: 'NAME' });
  }

  // Stable sort by first-appearance index; ties keep insertion order (detector order, then name order).
  hits
    .map((h, i) => ({ h, i }))
    .sort((a, b) => (a.h.index - b.h.index) || (a.i - b.i))
    .forEach(({ h }) => {
      if (map.has(h.value)) return; // consistent placeholder per distinct value
      counters[h.prefix] += 1;
      map.set(h.value, `[${h.prefix}_${counters[h.prefix]}]`);
    });

  return map;
}

/**
 * Apply an existing original->placeholder map to `text`. Replaces every occurrence of each key with its
 * placeholder. Longer keys are applied first so a name that is a substring of another is not partially
 * masked. Pure, never throws.
 * @param {string} text
 * @param {Map<string,string>} map
 * @returns {string}
 */
export function applyMap(text, map) {
  let s = typeof text === 'string' ? text : '';
  if (!s || !(map instanceof Map) || map.size === 0) return s;
  const keys = [...map.keys()].sort((a, b) => b.length - a.length);
  for (const key of keys) {
    if (!key) continue;
    s = s.split(key).join(map.get(key));
  }
  return s;
}

/**
 * Pseudonymize `text`: replace each distinct email/phone/@handle and each caller-supplied name with a
 * stable typed placeholder. Returns the rewritten text plus the original->placeholder map (caller-held;
 * the only way to reverse). Pure, deterministic, never throws.
 * @param {string} text
 * @param {{ names?: string[] }} [opts]
 * @returns {{ text: string, map: Map<string,string> }}
 */
export function pseudonymize(text, opts) {
  const s = typeof text === 'string' ? text : '';
  if (!s) return { text: '', map: new Map() };
  const names = opts && Array.isArray(opts.names) ? opts.names : [];
  const map = buildMap(s, names);
  return { text: applyMap(s, map), map };
}

// ── CLI: read stdin, pseudonymize, print the masked text (the map is intentionally not printed) ──────
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  let buf = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (d) => { buf += d; });
  process.stdin.on('end', () => {
    const { text } = pseudonymize(buf);
    process.stdout.write(text);
  });
}

export default { pseudonymize, buildMap, applyMap };
