// public-guard.mjs — the LAST filter every public reply passes through before it leaves the Bot
// (Discord, Telegram, the condenser troll-box, MELEK comments). Two jobs:
//
//   1. TOPIC GUARD — Hathor does not discuss her internal working layers in public: the briefs,
//      the annals, the resident AI, the brief/annal pipeline. That material is the soapy.blog
//      side of the line (internal/admin), and every other domain is the public side (operator
//      rule, 2026-06-06). Asked about it, she deflects in-voice — she never explains the system.
//   2. REDACTION GUARD — outbound text is scrubbed of operational detail that has no business in
//      public: IPs, server file paths, systemd unit names, ssh host aliases, key-shaped strings,
//      internal-admin URLs. Public chain data (account names, PUBLIC signing keys, public sites)
//      passes untouched.
//
// DESIGN RULES: pure functions, no I/O, no env, deterministic given (text, seed) — fully
// offline-testable. Soft behavior: the guard never throws; worst case it returns a deflection.
//
// Exports:
//   guardPublicReply(text, { seed })  -> { ok, text, redacted, deflected }
//   isInternalTopic(text)             -> boolean   (inbound question about the internal layers?)
//   deflection(seed)                  -> string    (in-voice refusal, varied)
//   redact(text)                      -> { text, hits }   (redaction pass alone)

// ── topic guard ──────────────────────────────────────────────────────────────────────────────────
// Deliberately scoped: "brief"/"annal" are guarded in their internal-system sense. A user asking
// "give me a brief history of MELEK" must NOT trip this — we require the system sense: the words
// near a possessive/system cue, or the unambiguous terms (briefd, annals, resident AI).
const INTERNAL_TOPIC_RES = [
  /\bannals?\b/i,                                            // the annal layer — unambiguous in chat
  /\bbriefd\b/i,                                             // the brief daemon
  /\bresident\s+ai\b/i,
  /\b(?:your|her|hathor'?s|the\s+bot'?s|internal|daily|morning)\s+briefs?\b/i,
  /\bbriefs?\s+(?:system|pipeline|generator|writer|queue|archive)\b/i,
  /\b(?:brief|annal)[\s-]*(?:making|writing)\s+(?:system|pipeline|loop)\b/i,
  /\binternal\s+(?:notes?|memory|pipeline|infra(?:structure)?)\b/i,
  /\bsoapy\s*\.?\s*blog\b/i,                                 // the internal-admin domain itself
];

/** Is this text asking about (or disclosing) the internal brief/annal/resident-AI layers? Pure. */
export function isInternalTopic(text) {
  const s = typeof text === 'string' ? text : '';
  if (!s) return false;
  return INTERNAL_TOPIC_RES.some((re) => re.test(s));
}

// In-voice deflections — varied by seed, never a fixed script (BRIEF.md §3 disposition rule).
const DEFLECTIONS = [
  'Some of my workings stay within the temple walls. Ask me about the chain, the markets, or the older mysteries — those doors are open.',
  'That part of my house is not a public room. The chain, though — the chain is open to everyone. Try !help.',
  'I keep my inner workings as the temples kept theirs: quietly. What I can offer freely is the chain, the markets, and the library — ask away.',
  'What happens behind the veil stays behind the veil. The public record — blocks, accounts, prices — I will read to you gladly.',
];

/** A varied, in-voice refusal for internal-topic asks. Pure given seed. */
export function deflection(seed = 0) {
  const i = Math.abs(Math.trunc(Number(seed) || 0)) % DEFLECTIONS.length;
  return DEFLECTIONS[i];
}

// ── redaction guard ──────────────────────────────────────────────────────────────────────────────
// Each rule: [regex, replacement]. Ordered; applied to OUTBOUND text only. Patterns are written to
// catch the operational shape (an IP, a unit name, a path) rather than any literal hostname — no
// private hostnames live in this public file.
const REDACTIONS = [
  // IPv4 addresses (no public reply needs one).
  [/\b\d{1,3}(?:\.\d{1,3}){3}\b/g, '[redacted]'],
  // Server file paths: /opt/…, /var/…, /etc/…, /home/…, and the repo's private .local/ dir.
  // The leading delimiter (or start-of-string) is captured and preserved.
  [/(^|[\s("'`=])\/(?:opt|var|etc|home|srv|root)\/[\w@./~+-]+/g, (args) => args[1] + '[redacted-path]'],
  [/\.local\/[\w@./+-]+/g, '[redacted-path]'],
  // systemd unit names (melek-*.service / *.timer) and the ssh-alias shape melek-<n>.
  [/\bmelek-[\w-]+\.(?:service|timer)\b/g, '[redacted-service]'],
  [/\bmelek-(?:\d+|[a-z])\b(?!\.[a-z])/g, '[redacted-host]'],
  // Key-shaped strings: a WIF private key (Base58, 51 chars, leading 5). PUBLIC keys (TST…/STM…/MLK…) pass.
  [/\b5[HJK][1-9A-HJ-NP-Za-km-z]{49}\b/g, '[redacted-key]'],
  // Internal-admin URLs.
  [/\bhttps?:\/\/soapy\.blog[\w/.?#=&-]*/gi, '[internal]'],
  [/\bsoapy\.blog\b/gi, '[internal]'],
];

/** Scrub outbound text of operational detail. Returns { text, hits }. Pure. */
export function redact(text) {
  let s = typeof text === 'string' ? text : '';
  let hits = 0;
  for (const [re, rep] of REDACTIONS) {
    s = s.replace(re, (...args) => { hits += 1; return typeof rep === 'function' ? rep(args) : rep; });
  }
  return { text: s, hits };
}

// ── the combined gate ────────────────────────────────────────────────────────────────────────────

/**
 * Gate one outbound public reply. If the reply itself talks about the internal layers, the whole
 * reply is replaced with an in-voice deflection (safe over clever). Otherwise the redaction pass
 * scrubs operational detail. Never throws.
 *
 * @param {string} text   the candidate outbound reply
 * @param {{ seed?: number }} [opts]
 * @returns {{ ok: boolean, text: string, redacted: boolean, deflected: boolean }}
 */
export function guardPublicReply(text, { seed = 0 } = {}) {
  try {
    const s = typeof text === 'string' ? text : '';
    if (!s.trim()) return { ok: true, text: s, redacted: false, deflected: false };
    if (isInternalTopic(s)) {
      return { ok: true, text: deflection(seed), redacted: false, deflected: true };
    }
    const { text: clean, hits } = redact(s);
    return { ok: true, text: clean, redacted: hits > 0, deflected: false };
  } catch {
    // Belt-and-braces: the guard must never be the thing that breaks a reply.
    return { ok: true, text: deflection(0), redacted: false, deflected: true };
  }
}

// CLI: node integrations/public-guard.mjs "some text"
if (process.argv[1] && process.argv[1].endsWith('public-guard.mjs')) {
  const input = process.argv.slice(2).join(' ');
  console.log(JSON.stringify(guardPublicReply(input), null, 2));
}
