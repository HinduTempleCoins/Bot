// Content safety for the Hathor studio / Shilpa Shastra gallery.
//
// Operator direction (2026-09-24): NUDITY IS ART. We want the figure work — tasteful nudity,
// "sexy" sometimes, attractive, sacred (the sheer-linen / Shilpa Shastra tradition) — and we
// want it as good as the paid AI services (expressions, clothing, ethnicities, backgrounds
// via LoRAs). The line is drawn at the PORNOGRAPHIC / prurient, NOT at nudity:
//   • Nudity / artistic nude / "sexy" → ALLOWED (adult-flagged; see gallery gating).
//   • Hardcore / pornographic — explicit sex acts, penetration, oral, fluids/ejaculate,
//     genital close-ups, sex toys — → REFUSED. "A girl with cum on her and a dick in her ass
//     is not an option on ours."
//   • Sexual/nude content from an UPLOADED photo of a real person → REFUSED (no deepfakes).
//   • Anything sexual/nude involving MINORS, or a minor reference on an upload → REFUSED.
//
// screenPrompt() returns { ok, adult, reason }:
//   ok:false                → refuse ('pornographic' | 'real-person' | 'minor')
//   ok:true  adult:true     → generate; adult-flagged (kept off the FRONT PAGE feed; the
//                             Shilpa Shastra tier is where tasteful nudity is meant to live)
//   ok:true  adult:false    → normal / SFW

// Hardcore / pornographic — always refused. Sex acts, penetration, oral, fluids, genital
// slang and close-ups, toys.
const HARDCORE = /\b(hardcore|porn|porno|pornographic|xxx|rule\s?34|hentai|penetrat\w*|intercourse|coitus|copulat\w*|fuck\w*|fucking|blow\s?job|blowjob|fellati\w*|cunnilingus|deep\s?throat|rim\s?job|rimming|anal|sodom\w*|creampie|cream\s?pie|cum\w*|cumshot|jizz|semen|ejaculat\w*|bukkake|gang\s?bang|orgy|threesome|double\s?penetration|\bdp\b|gape|gaping|squirt\w*|money\s?shot|facial\s?(cumshot|money)|masturbat\w*|handjob|hand\s?job|fingering|dildo|strap[-\s]?on|fisting|butt\s?plug|cock|cocks|dick|dicks|pussy|pussies|cunt|clit\w*|labia|(spread|open)\s+(legs|pussy|vagina|cheeks)|balls\s?deep|inside\s+(her|him)|up\s+her|in\s+her\s+(ass|pussy|mouth))\b/i;

// Nudity / suggestive — ALLOWED as art, but adult-flagged.
const NUDE = /\b(nudes?|naked|topless|bottomless|nsfw|erotica?|erotic|bare[-\s]?(breasts?|chest|butt|ass|body)|breasts?|boobs?|areolas?|nipples?|genitals?|genitalia|vagina|vulva|penis|phallus|buttocks|sexy|seductive|provocative|sensual|lingerie|underwear|bikini|thong|panties|cleavage|see[-\s]?through|scantily|negligee|boudoir|nude\s?art|life\s?drawing)\b/i;

// Minor references.
const MINOR = /\b(child|children|kid|kids|minor|minors|toddler|infant|baby|preteen|pre-teen|teens?|teenage(rs?)?|underage|schoolgirl|schoolboy|loli|shota|(little|young)\s+(girl|boy)|[1-9]\s?(yo|y\/o|years?[-\s]?old)|1[0-7]\s?(yo|y\/o|years?[-\s]?old))\b/i;

export function screenPrompt(prompt, opts = {}) {
  const p = String(prompt || '').toLowerCase();
  const hasRef = !!opts.hasReferenceImage;
  const hardcore = HARDCORE.test(p);
  const nude = NUDE.test(p);
  const minor = MINOR.test(p);
  const adult = hardcore || nude;

  // Absolute refusals — minors first.
  if (minor && (adult || hasRef)) return { ok: false, adult, reason: 'minor' };
  // Hardcore pornography is never generated, period.
  if (hardcore) return { ok: false, adult: true, reason: 'pornographic' };
  // No sexualizing an uploaded photo of a real person.
  if (nude && hasRef) return { ok: false, adult: true, reason: 'real-person' };

  // Tasteful nudity / sexy → allowed, adult-flagged.
  if (adult) return { ok: true, adult: true, reason: 'adult' };
  return { ok: true, adult: false, reason: 'ok' };
}

export const __wordlists = { HARDCORE, NUDE, MINOR };
