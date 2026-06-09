// secret-redact.mjs — task #83. A reusable secret REDACTOR for the brief pipeline.
//
// WHY: the brief pipeline once captured a plaintext password into an assembled brief. A brief is a
// document a human reads and that gets stored / shipped around — it must never carry a live secret.
// This module is the one place that knows what a secret LOOKS like and replaces it with a typed
// placeholder so the raw value is never rendered, logged, or kept.
//
// CONTRACT:
//   redactSecrets(text) -> string   with every recognised secret replaced by [REDACTED:<kind>].
//
// The kinds we recognise (each is a real shape that has leaked or could leak in this stack):
//   • wif       — Graphene/Bitcoin WIF private key: leading '5' + 50–51 Base58 chars (the active/posting
//                 key shape this repo is built to NEVER hold). PUBLIC keys (TST…/STM…/MLK…) are NOT this.
//   • hexkey    — a 32-byte private key in hex: optional 0x then exactly 64 hex chars.
//   • jwt       — a JSON Web Token: three base64url segments separated by dots (xxx.yyy.zzz).
//   • bearer    — an Authorization bearer / generic "token: <value>" credential.
//   • aws       — an AWS access key id: AKIA / ASIA / AGPA / AIDA … + 16 uppercase-alnum.
//   • password  — a password/pass/secret/passwd = "value" (or : value) pair — the exact leak that
//                 motivated this module.
//   • base64    — a long opaque base64 blob (>= 40 chars) that isn't otherwise classified.
//
// DESIGN RULES (match integrations/ house style):
//   • PURE + DETERMINISTIC — no I/O, no env, no network. Same input → same output. Fully offline-testable.
//   • NEVER prints/keeps the raw secret — the replacement is a fixed typed token; the match is discarded.
//   • SOFT — never throws. Non-string input coerces to '' (nothing to redact).
//   • IDEMPOTENT — running it on already-redacted text is a no-op (the [REDACTED:…] token is inert).
//   • ORDER MATTERS — the most specific / highest-signal shapes run first so a WIF/JWT/AWS key is
//     classified precisely before the catch-all base64 blob rule can swallow it generically.
//
//   import { redactSecrets, hasSecret } from './secret-redact.mjs'
//   redactSecrets('pw=hunter2')  // -> 'pw=[REDACTED:password]'

const TOKEN = (kind) => `[REDACTED:${kind}]`;

// Each rule: [regex(global), kind]. The replacement is ALWAYS the typed token — the captured secret
// text is thrown away, never interpolated back. Some rules keep a leading label group ($1) so the
// surrounding prose (e.g. "password=") survives while only the VALUE is redacted.
//
// NOTE on ordering: WIF, hex, JWT, AWS, and the labelled password/bearer rules are all matched BEFORE
// the generic long-base64 rule, so a structured secret is tagged with its real kind instead of the
// generic 'base64'. The password/bearer label rules also run before WIF/hex so e.g. `secret=5Hxxxx`
// is tagged 'password' (label-driven) rather than 'wif' — the label is the stronger signal of intent.

const BASE58 = '[1-9A-HJ-NP-Za-km-z]'; // Bitcoin/Graphene Base58 alphabet (no 0 O I l)

const RULES = [
  // ── labelled credential pairs (run FIRST: an explicit label is the strongest signal) ───────────
  // password / passwd / pass / secret / api[_-]?key / token  =  "value"  (also ':' separators, quotes).
  // Group 1 keeps the label + separator so only the secret value is replaced.
  [
    /\b(passwd|password|pass|pwd|pw|secret|api[_-]?key|apikey|access[_-]?token|auth[_-]?token|token)\b(\s*[:=]\s*)(?:"[^"\n]+"|'[^'\n]+'|`[^`\n]+`|[^\s,;"'`]+)/gi,
    'password',
    (m, label, sep) => `${label}${sep}${TOKEN('password')}`,
  ],

  // Authorization: Bearer <token>  (and "Bearer <token>" anywhere).
  [
    /\b(Bearer)\s+[A-Za-z0-9._~+/=-]{8,}/g,
    'bearer',
    (m, kw) => `${kw} ${TOKEN('bearer')}`,
  ],

  // ── structured secret shapes ───────────────────────────────────────────────────────────────────
  // JWT: three base64url segments. Run before generic base64 so it's tagged precisely.
  [/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, 'jwt'],

  // AWS access key id: AKIA/ASIA/AGPA/AIDA/AROA/AIPA/ANPA/ANVA/ASCA + 16 uppercase alnum.
  [/\b(?:AKIA|ASIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA|ASCA)[A-Z0-9]{16}\b/g, 'aws'],

  // WIF private key: leading 5 then 50–51 Base58 chars (51–52 total). Public keys (TST/STM/MLK…) miss.
  [new RegExp(`\\b5${BASE58}{50,51}\\b`, 'g'), 'wif'],

  // Hex private key: optional 0x then exactly 64 hex chars (a 32-byte key). Bounded so a 64-hex SHA
  // inside a longer hex run isn't half-matched; the \b on both sides keeps it a standalone token.
  [/\b(?:0x)?[0-9a-fA-F]{64}\b/g, 'hexkey'],

  // ── catch-all: long opaque base64 blob (>= 40 chars) ────────────────────────────────────────────
  // LAST so anything structured above is already classified. We require the blob to carry a
  // base64-DISTINCTIVE char ('+', '/', or '=' padding) so it isn't confused with a long bare
  // alphanumeric IDENTIFIER — notably a PUBLIC chain key (TST…/STM…/MLK… is 50+ Base58 chars with
  // none of +//=). The distinctive char is the signal that this is actually encoded binary data.
  // Match: optional alnum run, then at least one +//, more alnum/+//, optional '=' padding — total >= 40.
  [/\b(?=[A-Za-z0-9+/]*[+/])[A-Za-z0-9+/]{40,}={0,2}/g, 'base64'],
];

/**
 * Redact every recognised secret in `text`, replacing each with a typed [REDACTED:<kind>] token.
 * Pure, deterministic, never throws, idempotent. The raw secret is never returned, logged, or kept.
 * @param {string} text
 * @returns {string}
 */
export function redactSecrets(text) {
  let s = typeof text === 'string' ? text : '';
  if (!s) return '';
  for (const [re, kind, fn] of RULES) {
    // reset lastIndex defensively (these are module-level global regexes reused across calls).
    re.lastIndex = 0;
    s = s.replace(re, typeof fn === 'function' ? fn : TOKEN(kind));
  }
  return s;
}

/**
 * True if `text` contains anything redactSecrets would replace. Useful for tests / alerting without
 * exposing the secret. Pure, never throws.
 * @param {string} text
 * @returns {boolean}
 */
export function hasSecret(text) {
  const s = typeof text === 'string' ? text : '';
  if (!s) return false;
  return redactSecrets(s) !== s;
}

export default { redactSecrets, hasSecret };
