// compute-cite.mjs — Hathor's compute-and-cite core (v3 §12 computational/scientific layer).
//
// The anti-hallucination principle: for anything that can be COMPUTED or LOOKED UP, the Witness must
// never guess a number. Every answer this module returns carries its provenance —
//   { value, method: 'local-cas' | 'oeis' | 'newton' | 'numbers', source, confidence }
// — so a caller (Phase-3 conversational Hathor, the fact-checker, Cheetah) can show its work and cite
// where the number came from, or decline. Compute and cite, never guess.
//
//   Four engines, all keyless:
//     • local-cas  — a SAFE in-process recursive-descent arithmetic evaluator. NO eval(), NO Function().
//                    + - * / ^, parentheses, unary minus, and the functions sqrt ln log sin cos abs.
//                    This is the high-confidence path; it runs offline and is fully deterministic.
//     • oeis       — oeis.org/search?fmt=json — identify an integer sequence (keyless).
//     • newton     — api.newtonmath.xyz — symbolic algebra (simplify/derive/integrate/factor…) (keyless).
//     • numbers    — numbersapi.com — trivia facts about a number (keyless; low-confidence, flavor).
//
// Pattern mirrors integrations/soapbox/worldbank.mjs: ESM, zero deps, keyless, a __setFetch seam,
// soft-fail (return a typed result with confidence:0 / null, NEVER throw), provenance baked in, a
// guarded CLI block, and fully offline-testable pure parser.
//
//   import { evaluate, oeisLookup, newton, numberFact, computeAndCite } from './compute-cite.mjs'
//   node integrations/compute-cite.mjs "2 + 3 * sqrt(16)"
//   node integrations/compute-cite.mjs --oeis 1,1,2,3,5,8
//   node integrations/compute-cite.mjs --newton derive "x^2"
//   node integrations/compute-cite.mjs --number 42

let _fetch = (...a) => globalThis.fetch(...a);
/** Test/seam hook: inject a fetch implementation; pass nothing to restore the global. */
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

const UA = { 'User-Agent': 'HathorComputeCite/1.0 (+https://melek; compute-and-cite)' };

// ───────────────────────────────────────────────────────────────────────────────────────────────────
//  local-cas — a safe recursive-descent arithmetic evaluator (NO eval / NO Function).
//
//  Grammar (standard precedence, ^ right-associative, unary minus, function calls):
//     expr   := term (('+' | '-') term)*
//     term   := power (('*' | '/') power)*
//     power  := unary ('^' power)?            // right-associative
//     unary  := ('+' | '-') unary | primary
//     primary:= number | name '(' expr ')' | '(' expr ')'
//
//  Only the whitelisted function names below are callable. Anything else — an unknown identifier, a
//  stray character, a JS keyword, an attempt to reach a global — is a parse error, never executed.
// ───────────────────────────────────────────────────────────────────────────────────────────────────

const FUNCTIONS = {
  sqrt: (x) => { if (x < 0) throw new CalcError('sqrt of a negative number'); return Math.sqrt(x); },
  ln:   (x) => { if (x <= 0) throw new CalcError('ln requires a positive argument'); return Math.log(x); },
  log:  (x) => { if (x <= 0) throw new CalcError('log requires a positive argument'); return Math.log10(x); },
  sin:  (x) => Math.sin(x),
  cos:  (x) => Math.cos(x),
  abs:  (x) => Math.abs(x),
};

// A handful of common constants, allowed as bare names (read-only; cannot be assigned).
const CONSTANTS = { pi: Math.PI, e: Math.E };

/** Error type for arithmetic/semantic failures (e.g. division by zero, sqrt of negative). */
export class CalcError extends Error {}

// --- tokenizer -------------------------------------------------------------------------------------
// Emits { type, value } tokens. Whitespace is skipped. Any character that can't begin a valid token
// is rejected immediately — this is the first line of defense against injection (';', '=', letters
// outside an identifier run, etc. simply never tokenize into something runnable).
function tokenize(input) {
  const src = String(input == null ? '' : input);
  const tokens = [];
  let i = 0;
  const isDigit = (c) => c >= '0' && c <= '9';
  const isAlpha = (c) => (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_';
  while (i < src.length) {
    const c = src[i];
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { i++; continue; }
    if (isDigit(c) || (c === '.' && isDigit(src[i + 1]))) {
      let j = i + 1;
      while (j < src.length && (isDigit(src[j]) || src[j] === '.')) j++;
      // optional scientific notation: 1e3, 2.5E-4
      if (src[j] === 'e' || src[j] === 'E') {
        let k = j + 1;
        if (src[k] === '+' || src[k] === '-') k++;
        if (isDigit(src[k])) { k++; while (k < src.length && isDigit(src[k])) k++; j = k; }
      }
      const text = src.slice(i, j);
      if ((text.match(/\./g) || []).length > 1) throw new CalcError(`malformed number "${text}"`);
      tokens.push({ type: 'number', value: Number(text) });
      i = j;
      continue;
    }
    if (isAlpha(c)) {
      let j = i + 1;
      while (j < src.length && (isAlpha(src[j]) || isDigit(src[j]))) j++;
      tokens.push({ type: 'name', value: src.slice(i, j) });
      i = j;
      continue;
    }
    if ('+-*/^()'.includes(c)) { tokens.push({ type: 'op', value: c }); i++; continue; }
    throw new CalcError(`unexpected character "${c}"`);
  }
  return tokens;
}

// --- parser + evaluator (single pass; computes as it parses) ---------------------------------------
function parseExpression(tokens) {
  let pos = 0;
  const peek = () => tokens[pos];
  const next = () => tokens[pos++];
  const eat = (val) => {
    const t = peek();
    if (!t || t.value !== val) throw new CalcError(`expected "${val}"`);
    return next();
  };

  function expr() {
    let v = term();
    let t;
    while ((t = peek()) && t.type === 'op' && (t.value === '+' || t.value === '-')) {
      next();
      const r = term();
      v = t.value === '+' ? v + r : v - r;
    }
    return v;
  }
  function term() {
    let v = power();
    let t;
    while ((t = peek()) && t.type === 'op' && (t.value === '*' || t.value === '/')) {
      next();
      const r = power();
      if (t.value === '/') {
        if (r === 0) throw new CalcError('division by zero');
        v = v / r;
      } else {
        v = v * r;
      }
    }
    return v;
  }
  function power() {
    const base = unary();
    const t = peek();
    if (t && t.type === 'op' && t.value === '^') {
      next();
      const exp = power(); // right-associative
      const res = Math.pow(base, exp);
      if (!Number.isFinite(res) && Number.isFinite(base) && Number.isFinite(exp)) {
        throw new CalcError('exponentiation overflow or undefined');
      }
      return res;
    }
    return base;
  }
  function unary() {
    const t = peek();
    if (t && t.type === 'op' && (t.value === '+' || t.value === '-')) {
      next();
      const v = unary();
      return t.value === '-' ? -v : v;
    }
    return primary();
  }
  function primary() {
    const t = peek();
    if (!t) throw new CalcError('unexpected end of expression');
    if (t.type === 'number') { next(); return t.value; }
    if (t.type === 'op' && t.value === '(') {
      next();
      const v = expr();
      eat(')');
      return v;
    }
    if (t.type === 'name') {
      next();
      const name = t.value;
      const after = peek();
      if (after && after.type === 'op' && after.value === '(') {
        // function call — name MUST be whitelisted or it's a hard error (injection defense)
        const fn = FUNCTIONS[name];
        if (!fn) throw new CalcError(`unknown function "${name}"`);
        eat('(');
        const arg = expr();
        eat(')');
        return fn(arg);
      }
      // bare name — only the whitelisted constants are legal
      if (Object.prototype.hasOwnProperty.call(CONSTANTS, name)) return CONSTANTS[name];
      throw new CalcError(`unknown name "${name}"`);
    }
    throw new CalcError(`unexpected token "${t.value}"`);
  }

  const result = expr();
  if (pos < tokens.length) throw new CalcError(`unexpected trailing input near "${peek().value}"`);
  return result;
}

/**
 * Safely evaluate an arithmetic/algebraic expression with the local CAS.
 * Returns a provenance-stamped result; soft-fails (confidence:0, value:null, error set) — never throws.
 *   evaluate('2 + 3 * sqrt(16)')  →  { value: 14, method:'local-cas', source:'...', confidence:1, ... }
 */
export function evaluate(expression) {
  const expr = String(expression == null ? '' : expression);
  try {
    const tokens = tokenize(expr);
    if (!tokens.length) {
      return { value: null, method: 'local-cas', source: SOURCES['local-cas'], confidence: 0, expression: expr, error: 'empty expression' };
    }
    const value = parseExpression(tokens);
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return { value: null, method: 'local-cas', source: SOURCES['local-cas'], confidence: 0, expression: expr, error: 'non-finite result' };
    }
    return { value, method: 'local-cas', source: SOURCES['local-cas'], confidence: 1, expression: expr };
  } catch (e) {
    const msg = e instanceof CalcError ? e.message : 'parse error';
    return { value: null, method: 'local-cas', source: SOURCES['local-cas'], confidence: 0, expression: expr, error: msg };
  }
}

// Provenance strings per method.
const SOURCES = {
  'local-cas': 'Hathor local CAS (deterministic in-process evaluator)',
  oeis: 'OEIS — On-Line Encyclopedia of Integer Sequences (oeis.org)',
  newton: 'Newton Math API (newtonmath.xyz)',
  numbers: 'Numbers API (numbersapi.com)',
};

// ───────────────────────────────────────────────────────────────────────────────────────────────────
//  Network engines — each keyless, each soft-fails to a confidence:0 / null result, never throws.
// ───────────────────────────────────────────────────────────────────────────────────────────────────

async function getJson(url, accept = 'application/json') {
  try {
    const r = await _fetch(url, { headers: { ...UA, Accept: accept } });
    if (!r || !r.ok) return null;
    return await r.json();
  } catch { return null; }
}
async function getText(url) {
  try {
    const r = await _fetch(url, { headers: { ...UA, Accept: 'text/plain' } });
    if (!r || !r.ok) return null;
    return await r.text();
  } catch { return null; }
}

/**
 * Identify an integer sequence via OEIS. Accepts an array of integers or a comma/space list.
 * Returns { value, method:'oeis', source, confidence, results:[{ id, name, url, data }] }.
 * confidence is 1 when ≥1 sequence matched, else 0. Soft-fails to confidence:0 on any error.
 *   oeisLookup([1,1,2,3,5,8])  →  Fibonacci (A000045)
 */
export async function oeisLookup(seq) {
  const list = Array.isArray(seq)
    ? seq
    : String(seq == null ? '' : seq).split(/[,\s]+/).filter(Boolean);
  const nums = list.map((x) => Number(x)).filter((n) => Number.isFinite(n));
  if (!nums.length) {
    return { value: null, method: 'oeis', source: SOURCES.oeis, confidence: 0, results: [], error: 'empty sequence' };
  }
  const url = `https://oeis.org/search?q=${encodeURIComponent(nums.join(','))}&fmt=json`;
  const j = await getJson(url);
  const results = Array.isArray(j?.results) ? j.results : [];
  const out = results.slice(0, 5).map((r) => {
    const id = r.number != null ? 'A' + String(r.number).padStart(6, '0') : null;
    return { id, name: r.name || '', url: id ? `https://oeis.org/${id}` : null, data: r.data || '' };
  });
  return {
    value: out[0] ? out[0].id : null,
    method: 'oeis',
    source: SOURCES.oeis,
    confidence: out.length ? 1 : 0,
    results: out,
  };
}

// Newton API operations it understands.
export const NEWTON_OPS = new Set([
  'simplify', 'factor', 'derive', 'integrate', 'zeroes', 'tangent', 'area',
  'cos', 'sin', 'tan', 'arccos', 'arcsin', 'arctan', 'abs', 'log',
]);

/**
 * Symbolic algebra via the Newton API. operation ∈ NEWTON_OPS; expr is a math expression string.
 * Returns { value, method:'newton', source, confidence, operation, expression }.
 *   newton('derive', 'x^2')  →  value: '2 x'
 * Soft-fails to confidence:0 on bad op / empty expr / network error.
 */
export async function newton(operation, expression) {
  const op = String(operation == null ? '' : operation).trim().toLowerCase();
  const expr = String(expression == null ? '' : expression).trim();
  if (!NEWTON_OPS.has(op) || !expr) {
    return { value: null, method: 'newton', source: SOURCES.newton, confidence: 0, operation: op, expression: expr, error: 'unsupported operation or empty expression' };
  }
  // Newton wants the expression in the path; slashes inside the expression must be encoded.
  const url = `https://api.newtonmath.xyz/v2/${encodeURIComponent(op)}/${encodeURIComponent(expr)}`;
  const j = await getJson(url);
  const result = j && (j.result != null ? String(j.result) : null);
  return {
    value: result,
    method: 'newton',
    source: SOURCES.newton,
    confidence: result != null && result !== '' ? 1 : 0,
    operation: op,
    expression: expr,
  };
}

/**
 * A trivia fact about a number via the Numbers API. type ∈ 'trivia'|'math'|'year'|'date'.
 * This is FLAVOR, not authority — confidence caps at 0.5 even on success (it's curated trivia, not a
 * derivation). Returns { value, method:'numbers', source, confidence, number, type }.
 *   numberFact(42)  →  "42 is the answer to the Ultimate Question…"
 */
export async function numberFact(n, { type = 'trivia' } = {}) {
  const num = Number(n);
  const kind = ['trivia', 'math', 'year', 'date'].includes(type) ? type : 'trivia';
  if (!Number.isFinite(num)) {
    return { value: null, method: 'numbers', source: SOURCES.numbers, confidence: 0, number: null, type: kind, error: 'not a number' };
  }
  const text = await getText(`http://numbersapi.com/${encodeURIComponent(Math.trunc(num))}/${kind}`);
  const fact = text && text.trim() ? text.trim() : null;
  return {
    value: fact,
    method: 'numbers',
    source: SOURCES.numbers,
    confidence: fact ? 0.5 : 0,
    number: Math.trunc(num),
    type: kind,
  };
}

/**
 * Top-level "answer this, with a citation" dispatcher. Always returns a provenance-stamped result.
 *   { kind:'expression', input } → local CAS
 *   { kind:'sequence',  input } → OEIS
 *   { kind:'symbolic', operation, input } → Newton
 *   { kind:'number-fact', input } → Numbers API
 * Defaults to treating a bare string as an expression. NEVER throws.
 */
export async function computeAndCite(req = {}) {
  const kind = req.kind || 'expression';
  if (kind === 'expression') return evaluate(req.input);
  if (kind === 'sequence') return oeisLookup(req.input);
  if (kind === 'symbolic') return newton(req.operation, req.input);
  if (kind === 'number-fact') return numberFact(req.input, { type: req.type });
  return { value: null, method: 'local-cas', source: SOURCES['local-cas'], confidence: 0, error: `unknown kind "${kind}"` };
}

// ── CLI (guarded; live engines, offline-safe wrappers) ─────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('compute-cite.mjs')) {
  const argv = process.argv.slice(2);
  const show = (r) => console.log(JSON.stringify(r, null, 2));
  if (argv[0] === '--oeis') {
    show(await oeisLookup(argv.slice(1).join(' ')));
  } else if (argv[0] === '--newton') {
    show(await newton(argv[1], argv.slice(2).join(' ')));
  } else if (argv[0] === '--number') {
    show(await numberFact(argv[1]));
  } else {
    show(evaluate(argv.join(' ')));
  }
}
