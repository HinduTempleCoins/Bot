// rule-extract.mjs — rule-based template extractor (free, regex/templates, zero AI cost).
//
// Apply a declarative ruleset of named regex/template patterns to raw text and return
// structured fields. Distinct from conversation-parser / comms-parser (which parse one
// fixed format) — this is a GENERIC, configurable field extractor for the Wiki-Bot
// pipeline: feed it a ruleset, get back {fields, matched, misses}.
//
// Design rules (BRIEF house style): pure logic, no IO, soft-fail-never-throw, esc() any
// HTML interpolation. Bad patterns are skipped (logged soft via the returned warnings),
// never thrown. Dynamic patterns are length-capped to avoid compiling catastrophic-
// backtrack-prone input blindly.
//
//   import { extract, BUILTIN_RULES, compileRule, applyRule } from './rule-extract.mjs'
//   const out = extract('mail me at a@b.com', [BUILTIN_RULES.email]);
//   // out.fields.email === 'a@b.com'

// ---- HTML escape (house style: esc() all interpolation) -------------------------------
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
}

// ---- Limits ---------------------------------------------------------------------------
// Cap pattern source length so we never hand a giant/hostile string to the regex engine.
const MAX_PATTERN_LEN = 2000;
// Cap allMatches output so a degenerate global rule cannot blow up memory.
const MAX_MATCHES = 5000;
const ALLOWED_FLAGS = /^[gimsuy]*$/;

// ---- Deterministic transforms ---------------------------------------------------------
// transform names map to pure deterministic fns. Unknown name => identity (soft).
export const TRANSFORMS = {
  trim: (v) => String(v ?? '').trim(),
  lower: (v) => String(v ?? '').toLowerCase(),
  upper: (v) => String(v ?? '').toUpperCase(),
  number: (v) => {
    const n = Number(String(v ?? '').replace(/[^0-9eE+\-.]/g, ''));
    return Number.isFinite(n) ? n : null;
  },
  collapse: (v) => String(v ?? '').replace(/\s+/g, ' ').trim(),
};

function applyTransform(name, value) {
  if (value == null) return value;
  if (!name) return value;
  const fn = TRANSFORMS[name];
  if (typeof fn !== 'function') return value; // unknown transform => identity (soft-fail)
  try { return fn(value); } catch { return value; }
}

// ---- Rule compilation -----------------------------------------------------------------
/**
 * Compile a rule spec into a safe usable rule.
 * @param {{name:string, pattern:string|RegExp, flags?:string, group?:number, transform?:string}} spec
 * @returns {{name:string, re:RegExp, group:number, transform:?string}|null}  null on invalid (soft).
 */
export function compileRule(spec) {
  if (!spec || typeof spec !== 'object') return null;
  const name = String(spec.name ?? '').trim();
  if (!name) return null;

  let re;
  try {
    if (spec.pattern instanceof RegExp) {
      re = spec.pattern;
    } else {
      const src = String(spec.pattern ?? '');
      if (!src || src.length > MAX_PATTERN_LEN) return null; // length-capped, no blind compile
      let flags = String(spec.flags ?? '');
      if (!ALLOWED_FLAGS.test(flags)) flags = ''; // reject junk flags rather than throw
      re = new RegExp(src, flags);
    }
  } catch {
    return null; // invalid regex => skipped, not thrown
  }

  let group = Number.isInteger(spec.group) && spec.group >= 0 ? spec.group : 0;
  const transform = spec.transform ? String(spec.transform) : null;
  return { name, re, group, transform };
}

// ---- Single-rule application ----------------------------------------------------------
/**
 * Apply one rule (spec or compiled) to text.
 * @returns {{name:string, value:?string|number, matched:boolean}}
 */
export function applyRule(rule, text) {
  const r = rule && rule.re instanceof RegExp ? rule : compileRule(rule);
  const name = r ? r.name : String((rule && rule.name) ?? '');
  if (!r) return { name, value: null, matched: false };

  const t = String(text ?? '');
  let m;
  try {
    // Use a non-global clone for first-match semantics so lastIndex state never leaks.
    const re = r.re.global ? new RegExp(r.re.source, r.re.flags.replace('g', '')) : r.re;
    m = t.match(re);
  } catch {
    return { name, value: null, matched: false };
  }
  if (!m) return { name, value: null, matched: false };

  let raw = r.group > 0 ? m[r.group] : m[0];
  if (raw == null) return { name, value: null, matched: false };
  const value = applyTransform(r.transform, raw);
  return { name, value, matched: value != null };
}

// ---- Helpers --------------------------------------------------------------------------
/** First captured value for a rule, or null. */
export function firstMatch(rule, text) {
  return applyRule(rule, text).value;
}

/** All matches for a rule as an array of transformed values (group-aware, capped). */
export function allMatches(rule, text) {
  const r = rule && rule.re instanceof RegExp ? rule : compileRule(rule);
  if (!r) return [];
  const t = String(text ?? '');
  const flags = r.re.flags.includes('g') ? r.re.flags : r.re.flags + 'g';
  let re;
  try { re = new RegExp(r.re.source, flags); } catch { return []; }
  const out = [];
  let m;
  try {
    while ((m = re.exec(t)) !== null) {
      let raw = r.group > 0 ? m[r.group] : m[0];
      if (raw != null) {
        const v = applyTransform(r.transform, raw);
        if (v != null) out.push(v);
      }
      if (m.index === re.lastIndex) re.lastIndex++; // guard zero-width loops
      if (out.length >= MAX_MATCHES) break;
    }
  } catch {
    return out;
  }
  return out;
}

// ---- Full extraction ------------------------------------------------------------------
/**
 * Run a ruleset over text.
 * @param {string} text
 * @param {Array} rules  array of rule specs (or compiled rules)
 * @returns {{fields:Object, matched:string[], misses:string[], warnings:string[]}}
 */
export function extract(text, rules) {
  const fields = {};
  const matched = [];
  const misses = [];
  const warnings = [];
  const list = Array.isArray(rules) ? rules : [];

  for (const spec of list) {
    const r = spec && spec.re instanceof RegExp ? spec : compileRule(spec);
    if (!r) {
      const nm = String((spec && spec.name) ?? '(unnamed)');
      warnings.push(`skipped invalid rule: ${nm}`);
      continue;
    }
    const res = applyRule(r, text);
    if (res.matched) {
      fields[res.name] = res.value;
      matched.push(res.name);
    } else {
      misses.push(res.name);
    }
  }
  return { fields, matched, misses, warnings };
}

// ---- Built-in rules -------------------------------------------------------------------
// Common reusable fields. Each is a plain spec — pass them straight to extract().
export const BUILTIN_RULES = {
  email:    { name: 'email',    pattern: '[A-Za-z0-9._%+\\-]+@[A-Za-z0-9.\\-]+\\.[A-Za-z]{2,}', transform: 'lower' },
  url:      { name: 'url',      pattern: 'https?://[^\\s<>"\')]+' },
  date:     { name: 'date',     pattern: '\\d{4}-\\d{2}-\\d{2}' }, // ISO yyyy-mm-dd
  hashtags: { name: 'hashtags', pattern: '#([A-Za-z0-9_]+)', flags: 'g', group: 1 },
  mentions: { name: 'mentions', pattern: '(?:^|[^A-Za-z0-9_])@([A-Za-z0-9_.\\-]+)', flags: 'g', group: 1 },
  price:    { name: 'price',    pattern: '\\$\\s?([0-9][0-9,]*(?:\\.[0-9]+)?)', group: 1, transform: 'number' },
  amount:   { name: 'amount',   pattern: '\\b([0-9][0-9,]*(?:\\.[0-9]+)?)\\b', group: 1, transform: 'number' },
};

// ---- CLI (guarded) --------------------------------------------------------------------
function main(argv) {
  const text = argv.slice(2).join(' ');
  if (!text) {
    process.stdout.write('usage: node tools/rule-extract.mjs <text...>\n');
    return;
  }
  const out = extract(text, Object.values(BUILTIN_RULES));
  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
}

if (process.argv[1] && process.argv[1].endsWith('rule-extract.mjs')) {
  main(process.argv);
}
