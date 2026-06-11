// integrations/conversation-tone.mjs
//
// Conversation-tone selector from disposition.
//
// Maps a per-person relationship profile (the Crypt-ology dimensions —
// trust / warmth / respect / familiarity, and a list of topic interests) to a
// single personalized *tone* the Witness should carry into a reply.
//
// This is a disposition, NOT a script. Per BRIEF.md §3 the Witness's greeting
// is never a fixed string — so the output here is a short *style note*
// ("guidance"), never a canned line of dialogue. Downstream prompt assembly
// uses the guidance to shape the voice; it does not paste it verbatim.
//
// Pure + deterministic. No LLM, no I/O, no network, no keys. Soft-fail: any bad
// or missing input collapses to the safe, neutral 'balanced' tone rather than
// throwing.
//
// Input contract (matches the cryptology dimensions, normalized 0..1):
//   { trust=0, warmth=0, respect=0, familiarity=0, interests=[] }
// where each scalar is a 0..1 confidence and `interests` is a list of topic
// strings (e.g. ['philosophy','esoteric']). Callers holding the raw Crypt-ology
// −100..100 / 0..100 scale should normalize before calling.

// Topic interests that read as "intellectual" — drawn from the Crypt-ology
// INTEREST_TOPICS set so the two subsystems agree on vocabulary.
const INTELLECTUAL_INTERESTS = Object.freeze([
  'mythology', 'religion', 'archaeology', 'esoteric',
  'genetics', 'philosophy', 'science', 'theology', 'history',
]);

// The personalized tone labels from the backlog. `guidance` is a style note —
// a disposition for the voice, never a scripted greeting.
export const TONES = Object.freeze([
  Object.freeze({
    id: 'welcoming',
    label: 'Welcoming',
    guidance: 'Open and unhurried; this person is close and at ease, so meet them with generous warmth and assume good faith. Lead with care, not formality.',
  }),
  Object.freeze({
    id: 'friendly',
    label: 'Friendly',
    guidance: 'Warm and familiar; speak as to someone you know well. Light, personal, conversational — drop the procedural register.',
  }),
  Object.freeze({
    id: 'intellectual',
    label: 'Intellectual',
    guidance: 'Engaged and substantive; this person values ideas and standing. Reason in the open, cite where it helps, and respect their judgment.',
  }),
  Object.freeze({
    id: 'cautious',
    label: 'Cautious',
    guidance: 'Measured and steady; trust is low or unproven, so stay clear, factual, and unguarded-but-careful. Earn confidence, do not assume it.',
  }),
  Object.freeze({
    id: 'balanced',
    label: 'Balanced',
    guidance: 'Even and attentive; nothing strongly pulls the disposition one way. Be present and helpful without over-warming or over-formalizing.',
  }),
]);

const _byId = Object.freeze(Object.fromEntries(TONES.map((t) => [t.id, t])));

// Coerce anything to a finite number in [0,1]; junk -> 0.
function clamp01(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

// Normalize an interests value to a lowercase string array; junk -> [].
function normInterests(v) {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x) => typeof x === 'string')
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
}

function hasIntellectualInterest(interests) {
  return interests.some((i) => INTELLECTUAL_INTERESTS.includes(i));
}

// Threshold logic. Order matters: safety (low trust) first, then the warm/known
// branches, then the intellectual branch, then the neutral default.
//
//   low trust                         => cautious
//   high warmth + high familiarity    => welcoming (very close) / friendly (warm)
//   high respect + intellectual topic => intellectual
//   otherwise                         => balanced
export function selectTone(profile = {}) {
  // Soft-fail: non-object input collapses to balanced.
  if (profile === null || typeof profile !== 'object' || Array.isArray(profile)) {
    return 'balanced';
  }

  const trust = clamp01(profile.trust);
  const warmth = clamp01(profile.warmth);
  const respect = clamp01(profile.respect);
  const familiarity = clamp01(profile.familiarity);
  const interests = normInterests(profile.interests);

  // No usable signal at all (empty / unrecognized profile) => neutral balanced,
  // not cautious. "Cautious" is for *evidence* of low trust, not absence of
  // information. This keeps soft-fail / unknown-person at the safe-neutral tone.
  const anySignal =
    trust > 0 || warmth > 0 || respect > 0 || familiarity > 0 || interests.length > 0;
  if (!anySignal) return 'balanced';

  // 1. Low trust dominates — be cautious regardless of other signals.
  if (trust < 0.3) return 'cautious';

  // 2. Warm + familiar. Strong on both => welcoming; warm but less established
  //    => friendly.
  if (warmth >= 0.6 && familiarity >= 0.6) {
    if (warmth >= 0.8 && familiarity >= 0.8) return 'welcoming';
    return 'friendly';
  }
  if (warmth >= 0.6 && familiarity >= 0.4) return 'friendly';

  // 3. High respect + an intellectual interest => intellectual.
  if (respect >= 0.6 && hasIntellectualInterest(interests)) return 'intellectual';

  // 4. Neutral default.
  return 'balanced';
}

// Look up the style note for a tone id. Unknown id soft-fails to balanced's note.
export function toneGuidance(id) {
  const t = _byId[id] || _byId.balanced;
  return t.guidance;
}

// Full description for a profile: the chosen tone plus the normalized scores
// that drove the decision (handy for prompt-assembly and for tests / audit).
export function describe(profile = {}) {
  const safe =
    profile !== null && typeof profile === 'object' && !Array.isArray(profile)
      ? profile
      : {};
  const scores = {
    trust: clamp01(safe.trust),
    warmth: clamp01(safe.warmth),
    respect: clamp01(safe.respect),
    familiarity: clamp01(safe.familiarity),
    interests: normInterests(safe.interests),
  };
  const tone = selectTone(profile);
  const meta = _byId[tone] || _byId.balanced;
  return {
    tone,
    label: meta.label,
    guidance: meta.guidance,
    scores,
  };
}

// ---- CLI ----------------------------------------------------------------
// Prints describe() of a JSON profile passed as the first arg.
//   node integrations/conversation-tone.mjs '{"trust":0.9,"warmth":0.85,"familiarity":0.9}'
function main(argv) {
  const raw = argv[2];
  let profile = {};
  if (raw) {
    try {
      profile = JSON.parse(raw);
    } catch {
      // soft-fail: bad JSON => empty profile => balanced
      profile = {};
    }
  }
  process.stdout.write(JSON.stringify(describe(profile), null, 2) + '\n');
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv);
}
