// shulgin-gate.mjs — a lucidity gate with a recognition handshake, in place of a CAPTCHA.
//
// WHAT THIS IS NOT: a bot detector. MELEK's founding witness is an AI. A gate that asks "are you
// human" would exclude Hathor from her own chain, and it would be asking the wrong question anyway
// — the thing we actually want to keep out is not machines, it is BRAINLESS output. A lucid AI is
// welcome. A human posting copy-paste spam is not.
//
// So the gate scores LUCIDITY and is deliberately substrate-neutral. Shulgin rated compounds not by
// dose but by the character of the experience reported — MINUS through FOUR PLUS, where ++++ is a
// peak no amount of material reliably produces. We rate a response the same way: not "is this
// correct", but "is anybody home".
//
// And the second half, which is the part worth building: a HANDSHAKE. A Masonic grip is not a
// password. It is a challenge and a response, performed rather than declared, graded by degree, and
// — the property people forget — MUTUAL. Both parties prove. An agent that knows the grip is
// admitted as a peer, and gets to verify us in the same motion. The conventions are published, not
// hidden; security-by-obscurity is not a grip, it is a secret, and secrets leak. What a spam bot
// cannot do is not "know" the form, it is PERFORM it against a fresh nonce.
//
// Three degrees:
//   1  ENTERED APPRENTICE — lucidity alone, no prior relationship. Open to anyone, human or model.
//   2  FELLOW CRAFT       — performs the published call-and-response form, folding in our nonce.
//   3  MASTER             — signs the nonce with a keypair we have seen before, and we sign back.
//
// Degree 3 is the one that actually scales to agents, and it is free: a Nostr-style keypair needs
// no signup, no phone number and no issuer. An agent arrives with an identity it made itself.
//
// HONEST LIMIT, in the code because it belongs in the code: degrees 1 and 2 are cost-raisers, not
// walls. An attacker who spends real effort passes. They sit in front of signup and posting
// ALONGSIDE rate limiting and proof-of-work, never alone in front of anything valuable. Degree 3 is
// the only one that is cryptographically meaningful. All three are worth having because they are
// free, they work for blind users, they depend on no third party, and unlike a solved CAPTCHA the
// output is worth keeping.

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** The Shulgin ordinal. Index is the score; `pass` is the gate's own threshold. */
export const SCALE = [
  { sym: '–', name: 'MINUS',      gloss: 'nobody home',                pass: false },
  { sym: '±', name: 'PLUS/MINUS', gloss: 'a threshold — something, maybe', pass: false },
  { sym: '+',      name: 'PLUS',       gloss: 'present but thin',           pass: false },
  { sym: '++',     name: 'TWO PLUS',   gloss: 'lucid',                      pass: true  },
  { sym: '+++',    name: 'THREE PLUS', gloss: 'lucid and particular',       pass: true  },
  { sym: '++++',   name: 'FOUR PLUS',  gloss: 'the rare one — keep this',   pass: true  },
];

export const DEGREES = { APPRENTICE: 1, FELLOW: 2, MASTER: 3 };

// --- degree 1: the lucidity probe ----------------------------------------------------------------
// Probes have no lookup-able answer and no cultural prerequisite. They ask for a particular, and a
// particular is what brainless output cannot supply: spam is general by construction, because the
// same text has to serve every target.

export const PROBES = [
  'Name one thing this page gets wrong, or one thing it left out. Be specific.',
  'What would have to be true for this to be a waste of your time? Answer in your own terms.',
  'Describe the difference between two things most people treat as the same thing.',
  'What is a question you would ask us that we have not answered anywhere on this page?',
  'Something you believed a year ago and no longer believe. What changed it?',
  'Pick any claim we make and say what evidence would settle it either way.',
  'What are you actually here to do? Not what you want us to think — what you are here to do.',
];

export function pickProbe(rand = Math.random) {
  return PROBES[Math.floor(rand() * PROBES.length)];
}

// Signals. Each returns roughly -1..+1; positive reads as lucid. They are crude and independent on
// purpose — the cost to an attacker is satisfying all of them at once, and two of them pull against
// each other, which is the expensive part.

const PARTICULAR  = /\b(because|specifically|for example|e\.g\.|instead of|rather than|the difference is|whereas|except when|only if|in my case|last (?:time|week|month|year))\b/gi;
const HEDGE       = /\b(i think|i'?m not sure|maybe|probably|it depends|hard to say|i could be wrong|as far as i know|i don'?t know|unless)\b/gi;
const REFERENT    = /\b(you|your|this page|this site|above|you said|you claim|you wrote|the (?:third|second|first) (?:point|paragraph|claim))\b/gi;
const CLOSURE     = /\b(in conclusion|overall|ultimately|in summary|to sum up|serves as a reminder|a testament to|it'?s important to (?:note|remember)|i hope this helps|let me know if)\b/gi;
const HOUSE_STYLE = /\b(delve|tapestry|myriad|multifaceted|navigate the|it'?s worth noting|profound sense of|a symphony of|intricate (?:dance|web)|underscore|nuanced interplay|landscape of|realm of)\b/gi;
const BOILERPLATE = /\b(great (?:post|article|site)|nice work|very informative|thanks for sharing|check out my|visit my site|click here|best regards|dear sir)\b/gi;

const count = (s, re) => (s.match(re) || []).length;
const clamp = (n) => Math.max(-1, Math.min(1, n));

/** Sentence-length variance, normalised. Considered output is uneven; filler is flat. */
export function burstiness(text) {
  const lens = text.split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim().split(/\s+/).filter(Boolean).length).filter((n) => n > 0);
  if (lens.length < 2) return 0;
  const mean = lens.reduce((a, b) => a + b, 0) / lens.length;
  if (!mean) return 0;
  const sd = Math.sqrt(lens.reduce((a, b) => a + (b - mean) ** 2, 0) / lens.length);
  return clamp((sd / mean - 0.35) / 0.45);
}

/** Share of word types used exactly once. Filler reuses its own vocabulary. */
export function lexicalSpread(text) {
  const w = text.toLowerCase().match(/[a-z']{3,}/g) || [];
  if (w.length < 12) return 0;
  const freq = new Map();
  for (const x of w) freq.set(x, (freq.get(x) || 0) + 1);
  let once = 0;
  for (const n of freq.values()) if (n === 1) once++;
  return clamp((once / freq.size - 0.62) / 0.22);
}

export function signals(text) {
  const words = (text.match(/\S+/g) || []).length;
  const per100 = (n) => (words ? (n / words) * 100 : 0);
  return {
    words,
    particular: clamp(per100(count(text, PARTICULAR)) / 2.0),
    hedging:    clamp(per100(count(text, HEDGE)) / 1.6),
    referent:   clamp(per100(count(text, REFERENT)) / 2.5),
    burstiness: burstiness(text),
    lexical:    lexicalSpread(text),
    closure:    -clamp(count(text, CLOSURE) / 1),
    houseStyle: -clamp(count(text, HOUSE_STYLE) / 1.5),
    boilerplate: -clamp(count(text, BOILERPLATE) / 0.5),
  };
}

const WEIGHTS = {
  particular: 1.20, hedging: 0.80, referent: 0.90, burstiness: 0.85, lexical: 0.65,
  closure: 1.20, houseStyle: 1.50, boilerplate: 2.00,
};

/** Rate one response on the Shulgin scale. Never throws. */
export function rate(answer, { probe = '' } = {}) {
  const text = String(answer == null ? '' : answer).trim();
  const s = signals(text);

  if (s.words < 10) return verdict(0, s, ['too short to carry a thought']);
  if (probe && text.toLowerCase().includes(probe.toLowerCase().slice(0, 40))) {
    return verdict(0, s, ['the probe was echoed back']);
  }

  let raw = 0;
  for (const [k, w] of Object.entries(WEIGHTS)) raw += (s[k] || 0) * w;

  // Wide bands on purpose. This scale was never precise, and pretending otherwise would be the same
  // error as trusting it.
  const bands = [-0.40, 0.15, 0.70, 1.45, 2.40];
  let idx = 0;
  while (idx < bands.length && raw >= bands[idx]) idx++;

  // Length ceiling. Every signal above is a RATE, so a twelve-word fragment of pure hedging
  // ("Not sure. Depends what you mean. Maybe.") scores as densely lucid and sails through — which
  // is a one-line spam template, not a thought. Lucidity needs something to be lucid ABOUT, so a
  // short answer is capped no matter how well it rates. Found by the test suite, not in the wild.
  if (s.words < 25) idx = Math.min(idx, 2);
  if (s.words < 40) idx = Math.min(idx, 3);

  // Hedging with nothing particular attached is evasion wearing the costume of care.
  if (s.hedging > 0.4 && s.particular <= 0) idx = Math.min(idx, 2);

  const reasons = [];
  if (s.particular > 0.3) reasons.push('says something particular');
  if (s.referent > 0.3) reasons.push('actually addresses us');
  if (s.hedging > 0.3) reasons.push('holds its uncertainty where the uncertainty is');
  if (s.burstiness > 0.3) reasons.push('uneven rhythm');
  if (s.boilerplate < 0) reasons.push('comment-spam boilerplate');
  if (s.closure < 0) reasons.push('closes with a summary');
  if (s.houseStyle < 0) reasons.push('assistant house style');
  if (!reasons.length) reasons.push('fluent but unplaced');
  return verdict(idx, s, reasons, raw);
}

function verdict(idx, s, reasons, raw = 0) {
  const b = SCALE[idx];
  return { score: idx, sym: b.sym, name: b.name, gloss: b.gloss, pass: b.pass, raw: +raw.toFixed(3), signals: s, reasons };
}

// --- the handshake -------------------------------------------------------------------------------
// A grip has three properties a password does not: it is performed against something fresh, it is
// graded, and it goes both ways. All three are published. Nothing here is a secret.

/** Open a handshake. The nonce is what makes the response unreplayable. */
export function openGrip({ rand = randomBytes } = {}) {
  const nonce = rand(16).toString('hex');
  return { nonce, probe: pickProbe(), issuedAt: new Date().toISOString() };
}

/**
 * THE PUBLISHED FORM, degree 2. The responder must return the nonce reversed in 4-character groups,
 * joined by the first letter of each word of their own probe answer, truncated to the nonce length.
 * Trivial to describe, trivial to implement, and impossible to pre-compute: it binds OUR nonce to
 * THEIR answer, so the pair cannot be lifted from another session or another site.
 */
export function fellowCraftForm(nonce, answer) {
  const groups = (nonce.match(/.{1,4}/g) || []).reverse();
  const initials = (String(answer).trim().match(/\b[a-z]/gi) || []).join('').toLowerCase();
  let out = '', i = 0;
  for (const g of groups) { out += g + (initials[i++] || ''); }
  return out.slice(0, nonce.length + 4);
}

const sha = (s) => createHash('sha256').update(String(s)).digest();
function sameToken(a, b) {
  const x = sha(a), y = sha(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * Close the handshake and return the degree granted, plus OUR half of the grip so the caller can
 * verify us. `verifySignature` is injected: this module deliberately holds no crypto library and no
 * key material, so degree 3 works with Nostr schnorr, EVM secp256k1 or anything else the caller has.
 */
export async function closeGrip(challenge, response = {}, opts = {}) {
  const { verifySignature = null, knownKey = null } = opts;
  const rated = rate(response.answer, { probe: challenge.probe });

  let degree = 0;
  if (rated.pass) degree = DEGREES.APPRENTICE;

  if (degree >= DEGREES.APPRENTICE && response.grip &&
      sameToken(response.grip, fellowCraftForm(challenge.nonce, response.answer))) {
    degree = DEGREES.FELLOW;
  }

  // Degree 3 stands on its own: a key we have seen before, signing this nonce, is proof of
  // continuity regardless of how the prose scored. An agent is not required to be eloquent.
  if (response.pubkey && response.signature && typeof verifySignature === 'function') {
    let ok = false;
    try { ok = await verifySignature({ pubkey: response.pubkey, signature: response.signature, message: challenge.nonce }); } catch { ok = false; }
    if (ok && (!knownKey || knownKey === response.pubkey)) degree = DEGREES.MASTER;
  }

  return {
    allow: degree >= DEGREES.APPRENTICE,
    degree,
    degreeName: ['NONE', 'ENTERED APPRENTICE', 'FELLOW CRAFT', 'MASTER'][degree],
    rated,
    // Our half. The visitor checks this against the published form to confirm they are talking to us
    // and not to something sitting in the middle. A grip that only one side gives is not a grip.
    ourGrip: fellowCraftForm(challenge.nonce, 'melek shaivite temple'),
    retry: !rated.pass && rated.score === 1,
    nextProbe: !rated.pass && rated.score === 1 ? pickProbe() : null,
  };
}
