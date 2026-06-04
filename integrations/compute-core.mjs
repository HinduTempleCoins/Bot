// compute-core.mjs — Hathor's computational & scientific-knowledge layer (v3 §12).
//
// The anti-hallucination core: "compute and cite, don't guess." For anything that can be
// evaluated EXACTLY in-process — arithmetic, a unit conversion, a checkable numeric claim —
// the Witness MUST compute it deterministically and never let the language model invent a
// number it could have derived. The Clarity principle, applied to science.
//
//   Local-deterministic by construction. The arithmetic evaluator is a real tokenizer +
//   shunting-yard parser → RPN evaluation. It NEVER uses the JS dynamic-eval primitive or the
//   Function constructor; an unknown
//   identifier, a stray character, or any attempt to reach a global is a parse error, never
//   executed. No network on the local path.
//
//   Wolfram is an OPTIONAL polished fallback, referenced by ENV NAME ONLY (WOLFRAM_APP_ID).
//   When the key is unset it returns { ok:false, reason:'no-app-id' } and never throws, never
//   leaks. The local path is preferred; per v3 §12, open/local compute beats a metered API for
//   a resident AI. Wolfram is the fallback for what local can't do.
//
// Style mirrors integrations/soapbox/macro.mjs and integrations/compute-cite.mjs: ESM, zero
// heavy deps, injectable fetch seam, soft-fail (typed result, never throw), provenance baked in,
// a guarded CLI block, and a fully offline-testable pure core.
//
//   import { compute, convertUnit, verifyClaim, CONSTANTS, wolframFallback, dataNote } from './compute-core.mjs'
//   node integrations/compute-core.mjs "2 + 3 * sqrt(16)"
//   node integrations/compute-core.mjs --convert 5 km mi
//   node integrations/compute-core.mjs --verify "2 + 2 = 4"
//   node integrations/compute-core.mjs --constant c

// ── fetch seam (only used by the optional Wolfram fallback; the local path never touches it) ─────────
let _fetch = (...a) => globalThis.fetch(...a);
/** Test/seam hook: inject a fetch implementation; pass nothing to restore the global. */
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

const SOURCE_LOCAL = 'Hathor local compute-core (deterministic in-process evaluator; no eval)';

/** Provenance note returned alongside computed answers. */
export function dataNote() {
  return 'computed locally; constants: NIST CODATA (PD)';
}

// ════════════════════════════════════════════════════════════════════════════════════════════════════
//  1. compute(expr) — SAFE arithmetic evaluator: tokenizer → shunting-yard → RPN. No dynamic eval.
//
//  Supports:  + - * / ^ %  · parentheses · unary minus · function calls · constants pi/e.
//  Functions: sqrt abs min max log ln exp sin cos tan.  (^ right-associative; * / % left.)
//  min/max are variadic (comma-separated args). Everything else is unary.
// ════════════════════════════════════════════════════════════════════════════════════════════════════

/** Error type for tokenize/parse/semantic failures (caught and turned into ok:false). */
export class ComputeError extends Error {}

// Whitelisted functions. Unlisted names are a parse error — never reachable as a global.
const FUNCTIONS = {
  sqrt: (x) => { if (x < 0) throw new ComputeError('sqrt of a negative number'); return Math.sqrt(x); },
  abs:  (x) => Math.abs(x),
  ln:   (x) => { if (x <= 0) throw new ComputeError('ln requires a positive argument'); return Math.log(x); },
  log:  (x) => { if (x <= 0) throw new ComputeError('log requires a positive argument'); return Math.log10(x); },
  exp:  (x) => Math.exp(x),
  sin:  (x) => Math.sin(x),
  cos:  (x) => Math.cos(x),
  tan:  (x) => Math.tan(x),
  min:  (...xs) => Math.min(...xs),
  max:  (...xs) => Math.max(...xs),
};
const VARIADIC = new Set(['min', 'max']);

// Read-only constants, allowed as bare names. Cannot be assigned (there is no assignment grammar).
const NAMED = { pi: Math.PI, e: Math.E };

// Binary operators: precedence + associativity. Higher precedence binds tighter.
const OPERATORS = {
  '+': { prec: 2, assoc: 'L', fn: (a, b) => a + b },
  '-': { prec: 2, assoc: 'L', fn: (a, b) => a - b },
  '*': { prec: 3, assoc: 'L', fn: (a, b) => a * b },
  '/': { prec: 3, assoc: 'L', fn: (a, b) => { if (b === 0) throw new ComputeError('division by zero'); return a / b; } },
  '%': { prec: 3, assoc: 'L', fn: (a, b) => { if (b === 0) throw new ComputeError('modulo by zero'); return a % b; } },
  '^': { prec: 4, assoc: 'R', fn: (a, b) => a ** b },
};

// ── tokenizer ───────────────────────────────────────────────────────────────────────────────────────
function tokenize(src) {
  const tokens = [];
  const s = String(src);
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') { i++; continue; }
    // number (int / float / scientific)
    if (ch >= '0' && ch <= '9' || (ch === '.' && s[i + 1] >= '0' && s[i + 1] <= '9')) {
      let j = i + 1;
      while (j < s.length && /[0-9.]/.test(s[j])) j++;
      if (s[j] === 'e' || s[j] === 'E') {
        j++;
        if (s[j] === '+' || s[j] === '-') j++;
        while (j < s.length && s[j] >= '0' && s[j] <= '9') j++;
      }
      const text = s.slice(i, j);
      const num = Number(text);
      if (!Number.isFinite(num)) throw new ComputeError(`bad number "${text}"`);
      tokens.push({ type: 'num', value: num });
      i = j;
      continue;
    }
    // identifier (function name or constant)
    if (/[a-zA-Z_]/.test(ch)) {
      let j = i + 1;
      while (j < s.length && /[a-zA-Z0-9_]/.test(s[j])) j++;
      const name = s.slice(i, j);
      tokens.push({ type: 'name', value: name });
      i = j;
      continue;
    }
    if (ch === '(') { tokens.push({ type: 'lparen' }); i++; continue; }
    if (ch === ')') { tokens.push({ type: 'rparen' }); i++; continue; }
    if (ch === ',') { tokens.push({ type: 'comma' }); i++; continue; }
    if (OPERATORS[ch]) { tokens.push({ type: 'op', value: ch }); i++; continue; }
    throw new ComputeError(`unexpected character "${ch}"`);
  }
  return tokens;
}

// ── shunting-yard: token stream → RPN (output queue), resolving unary minus + function arity ─────────
function toRPN(tokens) {
  const out = [];        // RPN output queue
  const ops = [];        // operator/function stack
  // arg-count stack for functions, parallel to '(' that follow a function name
  const argc = [];
  let prevType = null;   // for distinguishing unary vs binary minus, and implicit context

  const isValueEnd = (t) => t && (t.type === 'num' || t.type === 'rparen' || (t.type === 'name' && NAMED[t.value] !== undefined));

  for (let k = 0; k < tokens.length; k++) {
    const t = tokens[k];
    if (t.type === 'num') {
      out.push({ kind: 'num', value: t.value });
    } else if (t.type === 'name') {
      const next = tokens[k + 1];
      if (next && next.type === 'lparen') {
        if (!FUNCTIONS[t.value]) throw new ComputeError(`unknown function "${t.value}"`);
        ops.push({ kind: 'func', name: t.value });
      } else if (NAMED[t.value] !== undefined) {
        out.push({ kind: 'num', value: NAMED[t.value] });
      } else {
        throw new ComputeError(`unknown identifier "${t.value}"`);
      }
    } else if (t.type === 'comma') {
      while (ops.length && ops[ops.length - 1].kind !== 'lparen') out.push(ops.pop());
      if (!ops.length) throw new ComputeError('misplaced comma');
      if (argc.length) argc[argc.length - 1]++;
    } else if (t.type === 'op') {
      let opChar = t.value;
      // unary minus/plus: at start, or after another operator / '(' / comma
      const unary = (opChar === '-' || opChar === '+') &&
        (prevType === null || prevType === 'op' || prevType === 'lparen' || prevType === 'comma' || prevType === 'uop');
      if (unary) {
        if (opChar === '-') ops.push({ kind: 'uop' });
        // unary plus is a no-op; drop it but keep prevType as uop so a following '-' still unaries
        prevType = 'uop';
        continue;
      }
      const o1 = OPERATORS[opChar];
      while (ops.length) {
        const top = ops[ops.length - 1];
        if (top.kind === 'func' || top.kind === 'uop') { out.push(ops.pop()); continue; }
        if (top.kind === 'op') {
          const o2 = OPERATORS[top.value];
          if ((o1.assoc === 'L' && o1.prec <= o2.prec) || (o1.assoc === 'R' && o1.prec < o2.prec)) {
            out.push(ops.pop());
            continue;
          }
        }
        break;
      }
      ops.push({ kind: 'op', value: opChar });
    } else if (t.type === 'lparen') {
      // if this paren opens a function call, the func is already on the ops stack
      const top = ops[ops.length - 1];
      if (top && top.kind === 'func') argc.push(1);
      else argc.push(0); // 0 marks a grouping paren (no associated function)
      ops.push({ kind: 'lparen' });
    } else if (t.type === 'rparen') {
      while (ops.length && ops[ops.length - 1].kind !== 'lparen') out.push(ops.pop());
      if (!ops.length) throw new ComputeError('mismatched parenthesis');
      ops.pop(); // discard '('
      const count = argc.pop();
      if (ops.length && ops[ops.length - 1].kind === 'func') {
        const f = ops.pop();
        // an empty-grouping marker (0) following a function means the call had >=1 arg already counted
        out.push({ kind: 'call', name: f.name, argc: count === 0 ? 1 : count });
      }
    }
    // track prevType for unary detection
    if (t.type === 'rparen') prevType = 'rparen';
    else if (t.type === 'num') prevType = 'num';
    else if (t.type === 'name') prevType = NAMED[t.value] !== undefined ? 'num' : 'func';
    else if (t.type === 'lparen') prevType = 'lparen';
    else if (t.type === 'op') prevType = 'op';
    else if (t.type === 'comma') prevType = 'comma';
  }
  while (ops.length) {
    const top = ops.pop();
    if (top.kind === 'lparen') throw new ComputeError('mismatched parenthesis');
    out.push(top);
  }
  return out;
}

// ── evaluate RPN ──────────────────────────────────────────────────────────────────────────────────
function evalRPN(rpn) {
  const st = [];
  for (const node of rpn) {
    if (node.kind === 'num') {
      st.push(node.value);
    } else if (node.kind === 'uop') {
      if (!st.length) throw new ComputeError('malformed expression');
      st.push(-st.pop());
    } else if (node.kind === 'op') {
      if (st.length < 2) throw new ComputeError('malformed expression');
      const b = st.pop(); const a = st.pop();
      st.push(OPERATORS[node.value].fn(a, b));
    } else if (node.kind === 'call') {
      const f = FUNCTIONS[node.name];
      if (!f) throw new ComputeError(`unknown function "${node.name}"`);
      const n = node.argc;
      if (!VARIADIC.has(node.name) && n !== 1) throw new ComputeError(`${node.name} takes one argument`);
      if (st.length < n) throw new ComputeError('malformed expression');
      const args = st.splice(st.length - n, n);
      st.push(f(...args));
    } else {
      throw new ComputeError('malformed expression');
    }
  }
  if (st.length !== 1) throw new ComputeError('malformed expression');
  return st[0];
}

/**
 * Safely evaluate an arithmetic expression. NEVER uses eval/Function.
 * Returns { ok:true, value, source, note, steps? } or { ok:false, error } — never throws.
 * Pass { steps:true } to include the intermediate RPN for "show your work".
 */
export function compute(expr, { steps = false } = {}) {
  const text = String(expr == null ? '' : expr).trim();
  try {
    const tokens = tokenize(text);
    if (!tokens.length) return { ok: false, error: 'empty expression' };
    const rpn = toRPN(tokens);
    const value = evalRPN(rpn);
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return { ok: false, error: 'non-finite result' };
    }
    const result = { ok: true, value, source: SOURCE_LOCAL, note: dataNote() };
    if (steps) result.steps = rpn.map((n) => (n.kind === 'num' ? String(n.value) : n.kind === 'call' ? `${n.name}()` : n.kind === 'uop' ? 'neg' : n.value));
    return result;
  } catch (e) {
    const msg = e instanceof ComputeError ? e.message : 'parse error';
    return { ok: false, error: msg, expression: text };
  }
}

// ════════════════════════════════════════════════════════════════════════════════════════════════════
//  2. CONSTANTS — NIST CODATA physical constants (recommended values), each with units + source.
//     PD: CODATA recommended values are public-domain reference data. Update on the next CODATA release.
// ════════════════════════════════════════════════════════════════════════════════════════════════════

const CODATA = 'NIST CODATA (PD)';
export const CONSTANTS = {
  c:   { symbol: 'c',   value: 299792458,            unit: 'm/s',         name: 'speed of light in vacuum',     source: CODATA, exact: true },
  h:   { symbol: 'h',   value: 6.62607015e-34,       unit: 'J·s',         name: 'Planck constant',              source: CODATA, exact: true },
  hbar:{ symbol: 'ℏ',   value: 1.054571817e-34,      unit: 'J·s',         name: 'reduced Planck constant',      source: CODATA },
  NA:  { symbol: 'N_A', value: 6.02214076e23,        unit: '1/mol',       name: 'Avogadro constant',            source: CODATA, exact: true },
  e:   { symbol: 'e',   value: 1.602176634e-19,      unit: 'C',           name: 'elementary charge',            source: CODATA, exact: true },
  G:   { symbol: 'G',   value: 6.67430e-11,          unit: 'm^3/(kg·s^2)',name: 'Newtonian gravitational constant', source: CODATA },
  kB:  { symbol: 'k_B', value: 1.380649e-23,         unit: 'J/K',         name: 'Boltzmann constant',           source: CODATA, exact: true },
  me:  { symbol: 'm_e', value: 9.1093837015e-31,     unit: 'kg',          name: 'electron mass',                source: CODATA },
  R:   { symbol: 'R',   value: 8.314462618,          unit: 'J/(mol·K)',   name: 'molar gas constant',           source: CODATA, exact: true },
};

/** Look up a physical constant by key (c/h/NA/...). Soft-fails to null on unknown. */
export function constant(key) {
  if (key == null) return null;
  const k = String(key);
  if (CONSTANTS[k]) return { ...CONSTANTS[k], note: dataNote() };
  // case-insensitive / symbol-ish fallback
  const hit = Object.values(CONSTANTS).find(
    (c) => c.symbol.toLowerCase() === k.toLowerCase() || c.name.toLowerCase() === k.toLowerCase(),
  );
  return hit ? { ...hit, note: dataNote() } : null;
}

// ════════════════════════════════════════════════════════════════════════════════════════════════════
//  3. convertUnit(value, from, to) — common conversions via a documented factor table.
//     length/mass/time/data: convert to a category base unit, then out. temperature: explicit funcs.
// ════════════════════════════════════════════════════════════════════════════════════════════════════

// Each unit maps to: factor TO the category base unit (multiply to get base). Aliases share a factor.
const UNITS = {
  // length — base: metre
  length: {
    base: 'm',
    units: {
      mm: 0.001, cm: 0.01, m: 1, metre: 1, meter: 1, km: 1000,
      in: 0.0254, inch: 0.0254, ft: 0.3048, foot: 0.3048, yd: 0.9144, yard: 0.9144,
      mi: 1609.344, mile: 1609.344, nmi: 1852,
    },
  },
  // mass — base: kilogram
  mass: {
    base: 'kg',
    units: {
      mg: 1e-6, g: 0.001, gram: 0.001, kg: 1, kilogram: 1, t: 1000, tonne: 1000,
      oz: 0.028349523125, lb: 0.45359237, pound: 0.45359237, st: 6.35029318, stone: 6.35029318,
    },
  },
  // time — base: second
  time: {
    base: 's',
    units: {
      ms: 0.001, s: 1, sec: 1, second: 1, min: 60, minute: 60,
      h: 3600, hr: 3600, hour: 3600, day: 86400, week: 604800,
    },
  },
  // data — base: byte (binary multiples; bit included)
  data: {
    base: 'B',
    units: {
      bit: 0.125, b: 0.125, byte: 1, B: 1,
      kb: 1024, KB: 1024, kib: 1024, mb: 1048576, MB: 1048576, mib: 1048576,
      gb: 1073741824, GB: 1073741824, gib: 1073741824, tb: 1099511627776, TB: 1099511627776,
    },
  },
};

// temperature is affine, not multiplicative — handle as explicit conversions through Celsius.
const TEMP_ALIASES = { c: 'C', '°c': 'C', celsius: 'C', f: 'F', '°f': 'F', fahrenheit: 'F', k: 'K', kelvin: 'K' };
function normTemp(u) {
  const k = String(u).toLowerCase();
  return TEMP_ALIASES[k] || (['C', 'F', 'K'].includes(u) ? u : null);
}
function toCelsius(v, unit) {
  if (unit === 'C') return v;
  if (unit === 'F') return (v - 32) * 5 / 9;
  if (unit === 'K') return v - 273.15;
  return null;
}
function fromCelsius(v, unit) {
  if (unit === 'C') return v;
  if (unit === 'F') return v * 9 / 5 + 32;
  if (unit === 'K') return v + 273.15;
  return null;
}

function findCategory(unit) {
  for (const [cat, def] of Object.entries(UNITS)) {
    if (Object.prototype.hasOwnProperty.call(def.units, unit)) return cat;
  }
  return null;
}

/**
 * Convert a value between units. Soft-fails to { ok:false, error } on unknown unit or
 * mismatched categories. Returns { ok:true, value, from, to, category, source, note }.
 */
export function convertUnit(value, from, to) {
  const v = Number(value);
  if (!Number.isFinite(v)) return { ok: false, error: 'value must be a finite number' };
  if (from == null || to == null) return { ok: false, error: 'from and to units are required' };

  // temperature path
  const tf = normTemp(from);
  const tt = normTemp(to);
  if (tf || tt) {
    if (!tf) return { ok: false, error: `unknown unit "${from}"` };
    if (!tt) return { ok: false, error: `unknown unit "${to}"` };
    const out = fromCelsius(toCelsius(v, tf), tt);
    return { ok: true, value: out, from: tf, to: tt, category: 'temperature', source: SOURCE_LOCAL, note: dataNote() };
  }

  // multiplicative path
  const catFrom = findCategory(from);
  const catTo = findCategory(to);
  if (!catFrom) return { ok: false, error: `unknown unit "${from}"` };
  if (!catTo) return { ok: false, error: `unknown unit "${to}"` };
  if (catFrom !== catTo) return { ok: false, error: `cannot convert ${catFrom} to ${catTo}` };

  const def = UNITS[catFrom];
  const base = v * def.units[from];
  const out = base / def.units[to];
  return { ok: true, value: out, from, to, category: catFrom, source: SOURCE_LOCAL, note: dataNote() };
}

// ════════════════════════════════════════════════════════════════════════════════════════════════════
//  4. verifyClaim(text) — extract a simple numeric claim and CHECK it computationally.
//     Patterns: "X <op> Y = Z"  and  "X% of Y is Z".  This is the anti-hallucination check:
//     when the LLM emits a checkable arithmetic statement, we recompute it ourselves.
// ════════════════════════════════════════════════════════════════════════════════════════════════════

const NUM_RE = '[-+]?\\d+(?:\\.\\d+)?';

/**
 * Extract and verify a simple numeric claim in free text.
 * Returns { ok, claim, computed, stated, matches, confidence, kind } or { ok:false, error }
 * when no checkable claim is found. Never throws.
 */
export function verifyClaim(text) {
  const s = String(text == null ? '' : text).trim();
  if (!s) return { ok: false, error: 'no claim found' };

  // "X% of Y is/= Z"
  const pct = new RegExp(`(${NUM_RE})\\s*%\\s*of\\s*(${NUM_RE})\\s*(?:is|=|equals?)\\s*(${NUM_RE})`, 'i').exec(s);
  if (pct) {
    const [, p, y, z] = pct;
    const computed = (Number(p) / 100) * Number(y);
    const stated = Number(z);
    return makeVerdict(`${p}% of ${y} = ${z}`, computed, stated, 'percent');
  }

  // "X <op> Y = Z"  with op in + - * / x ÷ ^ %
  const arith = new RegExp(`(${NUM_RE})\\s*([+\\-*/x×÷^%])\\s*(${NUM_RE})\\s*(?:is|=|equals?)\\s*(${NUM_RE})`, 'i').exec(s);
  if (arith) {
    const [, a, opRaw, b, z] = arith;
    const op = ({ x: '*', '×': '*', '÷': '/' })[opRaw] || opRaw;
    const r = compute(`${a} ${op} ${b}`);
    if (!r.ok) return { ok: false, error: r.error, claim: `${a} ${opRaw} ${b} = ${z}` };
    return makeVerdict(`${a} ${opRaw} ${b} = ${z}`, r.value, Number(z), 'arithmetic');
  }

  return { ok: false, error: 'no checkable numeric claim found' };
}

function makeVerdict(claim, computed, stated, kind) {
  const tol = Math.max(1e-9, Math.abs(computed) * 1e-9);
  const matches = Number.isFinite(computed) && Number.isFinite(stated) && Math.abs(computed - stated) <= tol;
  return {
    ok: true,
    claim,
    computed,
    stated,
    matches,
    confidence: matches ? 1 : 0,
    kind,
    source: SOURCE_LOCAL,
    note: dataNote(),
  };
}

// ════════════════════════════════════════════════════════════════════════════════════════════════════
//  5. wolframFallback(query) — OPTIONAL polished fallback. By env NAME only: WOLFRAM_APP_ID.
//     Only fires when the local path can't handle a query AND the key is set. Returns
//     { ok:false, reason:'no-app-id' } when unset. Never throws, never logs/leaks the key.
// ════════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Wolfram|Alpha LLM API fallback. The key is read from the WOLFRAM_APP_ID env var by NAME only —
 * never hard-coded, never logged. Inject { fetch } for testing; otherwise uses the seam's fetch.
 * Soft-fails to a typed result; never throws.
 */
export async function wolframFallback(query, { fetch: injected, env = process.env } = {}) {
  const appId = env && env.WOLFRAM_APP_ID;
  if (!appId) return { ok: false, reason: 'no-app-id', note: 'set WOLFRAM_APP_ID to enable the optional Wolfram fallback' };
  const q = String(query == null ? '' : query).trim();
  if (!q) return { ok: false, reason: 'empty-query' };
  const doFetch = injected || _fetch;
  try {
    const url = `https://www.wolframalpha.com/api/v1/llm-api?appid=${encodeURIComponent(appId)}&input=${encodeURIComponent(q)}`;
    const r = await doFetch(url, { headers: { Accept: 'text/plain' } });
    if (!r || !r.ok) return { ok: false, reason: 'request-failed' };
    const text = await r.text();
    return { ok: true, value: text, source: 'Wolfram|Alpha LLM API (metered fallback)', query: q };
  } catch {
    return { ok: false, reason: 'request-failed' };
  }
}

// ── CLI (guarded; local path is fully offline) ───────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('compute-core.mjs')) {
  const argv = process.argv.slice(2);
  const show = (r) => console.log(JSON.stringify(r, null, 2));
  if (argv[0] === '--convert') {
    show(convertUnit(argv[1], argv[2], argv[3]));
  } else if (argv[0] === '--verify') {
    show(verifyClaim(argv.slice(1).join(' ')));
  } else if (argv[0] === '--constant') {
    show(constant(argv[1]));
  } else if (argv[0] === '--wolfram') {
    show(await wolframFallback(argv.slice(1).join(' ')));
  } else {
    show(compute(argv.join(' '), { steps: true }));
  }
}
