// tone-analysis.mjs — keyless, PURE, offline tone/emotion/sentiment analysis (task #286).
//
// This is the "real" upgrade from the naive bull/bear keyword sentiment that comms-parser.mjs and
// conversation-parser.mjs carry today. It implements three transparent, deterministic analysers, all
// rule/lexicon based — no model download, no network, no key. Same input → same output, every time.
//
//   sentiment(text) → { score:-1..1, label:'pos'|'neg'|'neutral', ... }   VADER METHOD in JS
//   emotion(text)   → { joy, anger, fear, sadness, disgust, surprise, trust, anticipation, ... }  NRC-style
//   tone(text)      → { formality, politeness, certainty, sarcasm, ... }  linguistic-quality flags
//
// WHY rule-based first: per .local/TONE_NLP_TRANSLATION_API_CATALOG.md, VADER / NRCLex are the keyless
// "starter set" — drop-in upgrades that own the whole pipeline (no vendor lock, no data leaving our
// boxes). Swapping in the real HF models (j-hartmann emotion, cardiffNLP sentiment/irony, Detoxify) is
// a later self-host step that sits BEHIND these same function signatures. The lexicons here are compact
// built-ins, structured so they can be expanded toward the full VADER (~7500 terms) / NRC lists.
//
// All scores are ADVISORY (a hint that decorates a record), never ground truth — same liability frame
// as clarity.mjs and the existing comms-parser sentiment (never auto-edit the KB, never hard-block).
//
//   import { sentiment, emotion, tone } from './integrations/tone-analysis.mjs';
//   node integrations/tone-analysis.mjs "I am so happy this works!"   # print all three for a string

// ── tokenizer ───────────────────────────────────────────────────────────────────────────────────
// Keep emoticons/words/contractions; VADER cares about word identity + a couple of punctuation cues
// computed separately (see exclamation/question/ALLCAPS below).
const WORD_RE = /[a-zA-Z][a-zA-Z']*|:\)|:\(|:-\)|:-\(|:d|:p|<3/g;
function words(text) {
  return String(text == null ? '' : text).match(WORD_RE) || [];
}
function rawTokens(text) {
  // case-preserving split for ALLCAPS emphasis detection.
  return String(text == null ? '' : text).split(/\s+/).filter(Boolean);
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// 1) SENTIMENT — VADER method ported to JS
// ════════════════════════════════════════════════════════════════════════════════════════════════
// VADER = Valence Aware Dictionary and sEntiment Reasoner (Hutto & Gilbert 2014). The method:
//   • a valence lexicon maps a word → a signed intensity (roughly -4..+4),
//   • NEGATION within a small window flips & dampens valence,
//   • BOOSTERS (intensifiers/dampeners) scale the next word's valence,
//   • punctuation (! repetition) and ALLCAPS amplify,
//   • the per-word valences are summed and squashed to a "compound" in -1..1.
// We port the METHOD; the lexicon is a compact, expandable built-in (the full 7500-word list isn't
// needed to be useful — structure it so we can grow it / later replace with a real model).

// Compact valence lexicon — VADER-scale (-4..+4). Expandable: add rows freely.
export const VADER_LEXICON = {
  // strong positive
  excellent: 3.2, amazing: 3.1, fantastic: 3.1, wonderful: 3.0, awesome: 3.1, perfect: 3.0,
  brilliant: 2.9, superb: 3.0, love: 3.0, loved: 2.8, loves: 2.6, great: 3.1, best: 3.2,
  happy: 2.7, glad: 2.1, delighted: 2.8, thrilled: 2.9, joy: 2.6, joyful: 2.7, win: 2.4,
  wins: 2.2, won: 1.9, success: 2.2, successful: 2.3, good: 1.9, nice: 1.8, beautiful: 2.6,
  thanks: 1.9, thank: 1.9, thankful: 2.0, grateful: 2.2, gratitude: 2.0, yes: 1.2, works: 1.6,
  working: 1.0, fixed: 1.4, solved: 1.6, improve: 1.3, improved: 1.5, gain: 1.7, gains: 1.7,
  surge: 1.8, surges: 1.8, rally: 1.6, rallies: 1.6, soar: 2.0, soars: 2.0, boom: 1.7,
  bullish: 1.9, recover: 1.4, recovery: 1.4, rebound: 1.5, approval: 1.6, approved: 1.5,
  congrats: 2.4, congratulations: 2.6, hope: 1.4, hopeful: 1.7, fun: 1.9, like: 1.2, liked: 1.0,
  '<3': 2.6, ':)': 1.9, ':-)': 1.9, ':d': 2.2, ':p': 1.0,
  // mild / context positive
  ok: 0.6, okay: 0.6, fine: 0.7, cool: 1.3, agree: 1.2, agreed: 1.2, helpful: 1.8, clear: 0.9,
  safe: 1.0, strong: 1.0, up: 0.6,
  // strong negative
  terrible: -3.1, horrible: -3.1, awful: -2.9, worst: -3.2, hate: -2.9, hated: -2.7, hates: -2.6,
  disgusting: -3.0, disgusted: -2.8, angry: -2.5, anger: -2.4, furious: -3.0, mad: -2.0,
  sad: -2.1, sadness: -2.0, unhappy: -2.0, miserable: -2.8, depressed: -2.6, cry: -1.8,
  afraid: -2.2, scared: -2.2, fear: -2.1, terrified: -3.0, panic: -2.6, worry: -1.8, worried: -1.9,
  bad: -2.5, poor: -1.8, wrong: -2.0, fail: -2.3, fails: -2.3, failed: -2.3, failure: -2.5,
  broken: -2.2, broke: -1.7, bug: -1.5, error: -1.6, crash: -2.4, crashes: -2.4, crashed: -2.3,
  plunge: -2.0, plunges: -2.0, plummet: -2.2, crashing: -2.4, slump: -1.8, drop: -1.2, drops: -1.2,
  bearish: -1.9, dump: -1.8, selloff: -1.9, loss: -1.7, losses: -1.7, hack: -2.6, hacked: -2.6,
  exploit: -2.2, scam: -3.0, fraud: -3.0, lawsuit: -1.8, ban: -2.0, banned: -2.1, collapse: -2.6,
  warning: -1.4, danger: -2.2, dangerous: -2.3, ugly: -2.0, stupid: -2.4, dumb: -2.2, no: -1.2,
  nope: -1.2, problem: -1.4, problems: -1.5, issue: -0.9, issues: -1.0, annoying: -1.9,
  frustrated: -2.2, frustrating: -2.2, useless: -2.5, garbage: -2.6, trash: -2.4, disappointed: -2.3,
  disappointing: -2.3, sorry: -0.8, down: -0.6, ':(': -1.9, ':-(': -1.9,
};

// Boosters: intensifiers (+) and dampeners (−), applied to the FOLLOWING scored word's valence.
// VADER uses a flat ±0.293 step; we keep a small graded set.
const BOOSTER = {
  absolutely: 0.4, completely: 0.35, extremely: 0.45, incredibly: 0.4, really: 0.25, very: 0.3,
  so: 0.25, totally: 0.35, highly: 0.3, especially: 0.25, particularly: 0.25, super: 0.35,
  too: 0.25, quite: 0.15, more: 0.2, most: 0.3, lot: 0.2, lots: 0.2, hugely: 0.4, deeply: 0.35,
  // dampeners
  somewhat: -0.25, slightly: -0.3, kinda: -0.25, kind: -0.2, sort: -0.2, barely: -0.3,
  hardly: -0.3, less: -0.2, least: -0.2, marginally: -0.3, partly: -0.2, almost: -0.15,
};

// Negators: flip & dampen the valence of words within NEG_WINDOW following tokens.
const NEGATORS = new Set([
  'not', 'no', 'never', 'none', 'nobody', 'nothing', 'neither', 'nor', 'nowhere', 'without',
  "n't", 'cannot', "can't", 'cant', "won't", 'wont', "don't", 'dont', "doesn't", 'doesnt',
  "didn't", 'didnt', "isn't", 'isnt', "wasn't", 'wasnt', "aren't", 'arent', "weren't", 'werent',
  "haven't", 'havent', "hasn't", 'hasnt', "wouldn't", 'wouldnt', "shouldn't", 'shouldnt',
  'lacks', 'lack', 'fails', 'fail', 'failed',
]);
const NEG_WINDOW = 3;            // a negator flips polarity for up to this many following scored words
const NEG_SCALE = -0.74;         // VADER's negation multiplier (flip + dampen)

function hasContractionNot(tok) { return /n['’]t$/.test(tok); }
function isNegator(tok) { return NEGATORS.has(tok) || hasContractionNot(tok); }

// punctuation amplifiers — VADER boosts magnitude for ! runs and ? runs, and for ALLCAPS emphasis.
function punctuationBoost(rawText) {
  const ex = (String(rawText).match(/!/g) || []).length;
  const q = (String(rawText).match(/\?/g) || []).length;
  let amp = 0;
  // exclamation: up to 4 counted, ~0.292 each (VADER constant).
  amp += Math.min(ex, 4) * 0.292;
  // question marks: 2 ≈ 0.18 each, 3+ ≈ 0.96 (VADER), used as mild amplifier.
  if (q >= 3) amp += 0.96; else if (q === 2) amp += 0.36; else if (q === 1) amp += 0.18;
  return amp;
}
function allCapsBoost(rawTokenList, hasMixed) {
  // ALLCAPS emphasis only counts when the text isn't entirely caps (VADER rule).
  if (!hasMixed) return 0;
  const caps = rawTokenList.filter((t) => /[A-Z]/.test(t) && t === t.toUpperCase() && /[A-Z]{2,}/.test(t)).length;
  return caps > 0 ? 0.733 : 0;     // VADER C_INCR
}

// squash a valence sum into a compound score in (-1, 1) — VADER's normalization.
function normalizeCompound(sum, alpha = 15) {
  return sum / Math.sqrt(sum * sum + alpha);
}

/**
 * Sentiment via the VADER method — keyless, pure, offline. Tokenizes, looks each token up in the
 * valence lexicon, applies negation (flip+dampen within a window) and booster scaling from the
 * preceding token, amplifies for !/?/ALLCAPS, sums and squashes to a compound score in -1..1.
 *
 * @param {string} text
 * @returns {{score:number, label:'pos'|'neg'|'neutral', pos:number, neg:number, neutral:number,
 *            hits:Array<{word:string,valence:number,negated:boolean}>}}
 *   score is the compound (-1..1); label thresholds at ±0.05 (VADER's standard cutoff).
 */
export function sentiment(text) {
  const toks = words(text).map((t) => t.toLowerCase());
  const raws = rawTokens(text);
  const hasMixed = String(text || '') !== String(text || '').toUpperCase();
  const hits = [];
  let sum = 0;
  let posSum = 0, negSum = 0;

  for (let i = 0; i < toks.length; i++) {
    const w = toks[i];
    if (!(w in VADER_LEXICON)) continue;
    let v = VADER_LEXICON[w];

    // booster from up to 3 preceding tokens (closer = stronger), VADER damping.
    for (let d = 1; d <= 3 && i - d >= 0; d++) {
      const prev = toks[i - d];
      if (prev in BOOSTER) {
        const step = BOOSTER[prev] * (d === 1 ? 1 : d === 2 ? 0.95 : 0.9);
        v += v >= 0 ? step : -step;     // boosters push magnitude in the word's own direction
      }
    }

    // negation within the preceding window flips & dampens.
    let negated = false;
    for (let d = 1; d <= NEG_WINDOW && i - d >= 0; d++) {
      if (isNegator(toks[i - d])) { negated = true; break; }
    }
    if (negated) v *= NEG_SCALE;

    hits.push({ word: w, valence: +v.toFixed(3), negated });
    if (v > 0) posSum += v; else negSum += -v;
    sum += v;
  }

  // punctuation / caps amplify magnitude in the direction of the running sum.
  const amp = punctuationBoost(text) + allCapsBoost(raws, hasMixed);
  if (amp && sum !== 0) sum += sum > 0 ? amp : -amp;

  const score = +normalizeCompound(sum).toFixed(4);
  // pos/neg/neutral proportions (VADER-style), for callers that want the breakdown.
  const totalMag = posSum + negSum + Math.abs(amp);
  const pos = totalMag ? +((posSum + (sum > 0 ? Math.abs(amp) : 0)) / totalMag).toFixed(3) : 0;
  const neg = totalMag ? +((negSum + (sum < 0 ? Math.abs(amp) : 0)) / totalMag).toFixed(3) : 0;
  const neutral = +Math.max(0, 1 - pos - neg).toFixed(3);
  const label = score >= 0.05 ? 'pos' : score <= -0.05 ? 'neg' : 'neutral';
  return { score, label, pos, neg, neutral, hits };
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// 2) EMOTION — NRC-style emotion lexicon
// ════════════════════════════════════════════════════════════════════════════════════════════════
// The NRC Emotion Lexicon (Mohammad & Turney) tags words with the eight Plutchik emotions
// (joy/anger/fear/sadness/disgust/surprise/trust/anticipation). NRCLex just counts associations.
// We carry a compact, expandable built-in: word → array of emotions. Scores are normalized 0..1 by
// the number of emotion-bearing tokens, so a single angry word in a short sentence reads "angry".

export const NRC_LEXICON = {
  // joy
  happy: ['joy'], joy: ['joy'], joyful: ['joy'], delighted: ['joy'], glad: ['joy'], cheerful: ['joy'],
  love: ['joy', 'trust'], loved: ['joy', 'trust'], excited: ['joy', 'anticipation'], thrilled: ['joy'],
  celebrate: ['joy'], wonderful: ['joy'], great: ['joy'], awesome: ['joy'], amazing: ['joy', 'surprise'],
  fun: ['joy'], laugh: ['joy'], smile: ['joy'], win: ['joy'], won: ['joy'], success: ['joy', 'anticipation'],
  // anger
  angry: ['anger'], anger: ['anger'], furious: ['anger'], rage: ['anger'], mad: ['anger'], hate: ['anger', 'disgust'],
  hated: ['anger', 'disgust'], annoyed: ['anger'], annoying: ['anger'], frustrated: ['anger'], frustrating: ['anger'],
  outrage: ['anger'], outraged: ['anger'], hostile: ['anger'], irritated: ['anger'], resent: ['anger'],
  // fear
  afraid: ['fear'], scared: ['fear'], fear: ['fear'], terrified: ['fear'], terror: ['fear'], panic: ['fear', 'surprise'],
  worried: ['fear'], worry: ['fear'], anxious: ['fear', 'anticipation'], nervous: ['fear'], dread: ['fear'],
  threat: ['fear', 'anger'], danger: ['fear'], dangerous: ['fear'], horror: ['fear', 'disgust'],
  // sadness
  sad: ['sadness'], sadness: ['sadness'], unhappy: ['sadness'], depressed: ['sadness'], miserable: ['sadness'],
  cry: ['sadness'], grief: ['sadness'], mourn: ['sadness'], lonely: ['sadness'], hopeless: ['sadness', 'fear'],
  disappointed: ['sadness'], disappointing: ['sadness'], loss: ['sadness'], lost: ['sadness'], regret: ['sadness'],
  // disgust
  disgust: ['disgust'], disgusting: ['disgust'], disgusted: ['disgust'], gross: ['disgust'], nasty: ['disgust', 'anger'],
  revolting: ['disgust'], sick: ['disgust', 'sadness'], vile: ['disgust'], filthy: ['disgust'], rotten: ['disgust'],
  scam: ['disgust', 'anger'], fraud: ['disgust', 'anger'], corrupt: ['disgust', 'anger'],
  // surprise
  surprise: ['surprise'], surprised: ['surprise'], surprising: ['surprise'], shocked: ['surprise', 'fear'],
  shocking: ['surprise'], sudden: ['surprise'], unexpected: ['surprise'], wow: ['surprise', 'joy'], astonished: ['surprise'],
  // trust
  trust: ['trust'], trusted: ['trust'], reliable: ['trust'], honest: ['trust'], faith: ['trust'], confident: ['trust', 'anticipation'],
  safe: ['trust'], secure: ['trust'], support: ['trust'], thanks: ['trust', 'joy'], thank: ['trust', 'joy'],
  // anticipation
  anticipate: ['anticipation'], anticipation: ['anticipation'], expect: ['anticipation'], soon: ['anticipation'],
  upcoming: ['anticipation'], hope: ['anticipation', 'joy'], hopeful: ['anticipation', 'joy'], plan: ['anticipation'],
  future: ['anticipation'], ready: ['anticipation'], waiting: ['anticipation'], eager: ['anticipation', 'joy'],
};

const EMOTIONS = ['joy', 'anger', 'fear', 'sadness', 'disgust', 'surprise', 'trust', 'anticipation'];

/**
 * Emotion detection via an NRC-style lexicon — keyless, pure, offline. Counts each token's emotion
 * associations (a word may carry several), applies the same negation window as sentiment (a negated
 * emotion word does not contribute), then normalizes counts 0..1 by the total emotion-bearing hits so
 * the dominant emotion of a short message stands out.
 *
 * @param {string} text
 * @returns {{joy,anger,fear,sadness,disgust,surprise,trust,anticipation:number,
 *            dominant:string|null, counts:Record<string,number>}}
 */
export function emotion(text) {
  const toks = words(text).map((t) => t.toLowerCase());
  const counts = Object.fromEntries(EMOTIONS.map((e) => [e, 0]));
  let total = 0;
  for (let i = 0; i < toks.length; i++) {
    const w = toks[i];
    const emos = NRC_LEXICON[w];
    if (!emos) continue;
    // negation within the window suppresses the emotion association ("not happy" ≠ joy).
    let negated = false;
    for (let d = 1; d <= NEG_WINDOW && i - d >= 0; d++) {
      if (isNegator(toks[i - d])) { negated = true; break; }
    }
    if (negated) continue;
    for (const e of emos) { counts[e] += 1; total += 1; }
  }
  const scores = Object.fromEntries(EMOTIONS.map((e) => [e, total ? +(counts[e] / total).toFixed(3) : 0]));
  let dominant = null, max = 0;
  for (const e of EMOTIONS) if (counts[e] > max) { max = counts[e]; dominant = e; }
  return { ...scores, dominant, counts };
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// 3) TONE — formality / politeness / certainty / sarcasm flags
// ════════════════════════════════════════════════════════════════════════════════════════════════
// Lightweight linguistic-quality cues (the keyless stand-ins for the HF formality/politeness/irony
// models in the catalog). Each is a 0..1 lean computed from transparent markers.

const INFORMAL = new Set([
  'gonna', 'wanna', 'gotta', 'kinda', 'sorta', 'yeah', 'yep', 'nope', 'lol', 'omg', 'btw', 'imo',
  'u', 'ur', 'ya', 'cuz', 'cos', 'thx', 'pls', 'plz', 'dunno', 'ain', 'aint', 'gimme', 'lemme', 'hey',
]);
const FORMAL = new Set([
  'therefore', 'however', 'moreover', 'furthermore', 'consequently', 'regarding', 'pursuant',
  'accordingly', 'nevertheless', 'notwithstanding', 'hereby', 'herein', 'aforementioned', 'whereas',
  'kindly', 'sincerely', 'regards', 'respectfully',
]);
const POLITE = new Set([
  'please', 'thanks', 'thank', 'appreciate', 'appreciated', 'kindly', 'sorry', 'pardon', 'excuse',
  'welcome', 'grateful', 'regards', 'sincerely', 'cheers', 'congratulations',
]);
const IMPOLITE = new Set([
  'stupid', 'idiot', 'shut', 'dumb', 'useless', 'whatever', 'nonsense', 'ridiculous', 'pathetic',
  'garbage', 'trash', 'damn', 'hell', 'crap',
]);
const CERTAIN = new Set([
  'definitely', 'certainly', 'absolutely', 'always', 'never', 'clearly', 'obviously', 'undoubtedly',
  'guaranteed', 'sure', 'must', 'will', 'proven', 'fact', 'indeed', 'precisely', 'exactly',
]);
const TENTATIVE = new Set([
  'maybe', 'perhaps', 'possibly', 'probably', 'might', 'may', 'could', 'seems', 'seem', 'likely',
  'apparently', 'somewhat', 'guess', 'suppose', 'think', 'unsure', 'unclear', 'i', 'about', 'around',
]);
// sarcasm cues: positive word in scare-quotes, "yeah right", "oh great" + negative, "sure...", /s tag.
const SARCASM_PHRASES = [
  /\byeah[, ]+right\b/i, /\boh[, ]+(?:great|wonderful|fantastic|perfect|sure)\b/i,
  /\bas if\b/i, /\bwhat a surprise\b/i, /\bbig surprise\b/i, /\bnice (?:job|going)\b/i,
  /\bthanks a lot\b/i, /\bjust great\b/i, /\/s\b/i,
];

function ratio(toks, set) {
  if (!toks.length) return 0;
  let n = 0;
  for (const t of toks) if (set.has(t)) n++;
  return +(n / toks.length).toFixed(3);
}

/**
 * Tone flags — keyless, pure, offline. Returns 0..1 leans for formality, politeness, and
 * certainty (with a paired tentativeness), plus a simple sarcasm/irony heuristic. These are coarse,
 * transparent stand-ins for the HF formality/politeness/irony models named in the catalog.
 *
 * @param {string} text
 * @returns {{formality:number, politeness:number, certainty:number, tentativeness:number,
 *            sarcasm:boolean, sarcasmScore:number, exclamations:number, allCaps:boolean}}
 *   formality > 0.5 leans formal (< 0.5 informal); certainty/tentativeness are independent leans.
 */
export function tone(text) {
  const s = String(text == null ? '' : text);
  const toks = words(s).map((t) => t.toLowerCase());
  const raws = rawTokens(s);

  const informal = ratio(toks, INFORMAL);
  const formalW = ratio(toks, FORMAL);
  // formality: starts neutral 0.5, pushed by formal/informal markers + punctuation/contraction cues.
  let formality = 0.5 + formalW * 3 - informal * 3;
  if (/n['’]t\b|gonna|wanna/i.test(s)) formality -= 0.1;          // contractions read informal
  if (/[A-Z][a-z].*[.;] /.test(s) && !/[!?]{2,}/.test(s)) formality += 0.05;
  formality = +Math.min(1, Math.max(0, formality)).toFixed(3);

  const politeMarks = ratio(toks, POLITE);
  const impoliteMarks = ratio(toks, IMPOLITE);
  let politeness = 0.5 + politeMarks * 4 - impoliteMarks * 4;
  politeness = +Math.min(1, Math.max(0, politeness)).toFixed(3);

  const certainty = ratio(toks, CERTAIN);
  const tentativeness = ratio(toks, TENTATIVE);

  const exclamations = (s.match(/!/g) || []).length;
  const hasMixed = s !== s.toUpperCase();
  const allCaps = !hasMixed && /[A-Z]{3,}/.test(s) && s.trim().length > 0;

  // sarcasm heuristic: explicit phrases, /s, scare-quoted positives, or positive-word + ALLCAPS/!!! +
  // an eye-roll mismatch (positive sentiment word next to a clearly negative context). Coarse on purpose.
  let sarcasmScore = 0;
  for (const re of SARCASM_PHRASES) if (re.test(s)) sarcasmScore += 0.5;
  // quoted positive ("great") reads ironic.
  if (/["“'](?:great|wonderful|fantastic|perfect|brilliant|amazing)["”']/i.test(s)) sarcasmScore += 0.4;
  // a positive opener followed by an obviously bad outcome ("great, it broke again").
  if (/\b(?:great|wonderful|perfect|fantastic)\b[, ].*\b(?:broke|broken|crashed|failed|again|down)\b/i.test(s)) sarcasmScore += 0.4;
  sarcasmScore = +Math.min(1, sarcasmScore).toFixed(3);

  return {
    formality, politeness, certainty, tentativeness,
    sarcasm: sarcasmScore >= 0.5, sarcasmScore,
    exclamations, allCaps,
  };
}

/**
 * Convenience: run all three analysers at once. Pure & offline.
 * @param {string} text
 * @returns {{sentiment, emotion, tone}}
 */
export function analyzeTone(text) {
  return { sentiment: sentiment(text), emotion: emotion(text), tone: tone(text) };
}

if (process.argv[1] && process.argv[1].endsWith('tone-analysis.mjs')) {
  const text = process.argv.slice(2).join(' ') || 'I am absolutely thrilled this finally works! :)';
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(analyzeTone(text), null, 2));
}
