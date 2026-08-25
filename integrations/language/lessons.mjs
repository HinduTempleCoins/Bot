// lessons.mjs — Hathor Language Center: the curriculum + learning engine for the MELEK/SoapBox
// language-education surface. PURE + injectable: no network, no wall-clock reads inside the logic
// (every `now` is passed in), soft-fail everywhere, esc() for anything that will reach HTML.
//
// What lives here:
//   • COURSES — a real starter curriculum. Three languages (Spanish, Kurdish (Kurmanji), French),
//     each with 3+ lessons of ACTUAL content: vocab (word/translation/example), phrases, grammar
//     notes. Kurdish is seeded first-class because the MELEK name carries a Kurdish lineage.
//   • scoreAnswer(given, expected)   — normalized, accent-folding, near-match scoring → {correct,score,...}
//   • srsSchedule({item, grade, now})— SM-2-style spaced repetition (Anki's algorithm, honestly).
//   • nextDue(deck, now)             — the next card due for review (or the soonest-upcoming).
//   • deckFor(course)               — flatten a course's vocab+phrases into a review deck of items.
//   • progress(learner)             — a learner's replayed state from the append-only store.
//   • recordReview(...)             — append one graded review event (drives SRS + progress).
//   • memoryStore()/jsonlStore()    — injectable per-learner progress stores (default in-memory).
//
// Ties to the ecosystem: a completed lesson / review streak is a natural PLAY-reward or on-chain
// "move" trigger — the surface (site/language) can call recordReview() and hand the event to the
// Move/PLAY faucet. This module stays pure; it never broadcasts. (See memory: melek-move-reward-model.)

import fsReal from 'node:fs';
import pathReal from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = pathReal.dirname(fileURLToPath(import.meta.url));

// esc() — HTML-escape any interpolation that reaches a page. Kept here so lessons content is safe
// to render straight from the registry without the server re-escaping structural markup.
export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ════════════════════════════════════════════════════════════════════════════════════════════════
//  CURRICULUM — real seeded content. Each course: { id, label, native, flag, blurb, lessons[] }.
//  Each lesson: { n, title, focus, vocab[], phrases[], grammar[] }.
//    vocab  item: { word, translation, example }   (word in target language; translation in English)
//    phrase item: { phrase, translation }
//    grammar item: a plain-language note string.
// ════════════════════════════════════════════════════════════════════════════════════════════════

export const COURSES = {
  es: {
    id: 'es', label: 'Spanish', native: 'Español', flag: '🇪🇸',
    blurb: 'The world’s second-most-spoken native language. Start with greetings, numbers, and the everyday phrases that get you through a day.',
    lessons: [
      {
        n: 1, title: 'Greetings & courtesy', focus: 'Say hello, please, and thank you.',
        vocab: [
          { word: 'hola', translation: 'hello', example: '¡Hola! ¿Cómo estás?' },
          { word: 'buenos días', translation: 'good morning', example: 'Buenos días, señora.' },
          { word: 'buenas noches', translation: 'good night', example: 'Buenas noches, hasta mañana.' },
          { word: 'gracias', translation: 'thank you', example: 'Muchas gracias por tu ayuda.' },
          { word: 'por favor', translation: 'please', example: 'Un café, por favor.' },
          { word: 'adiós', translation: 'goodbye', example: 'Adiós, nos vemos pronto.' },
        ],
        phrases: [
          { phrase: '¿Cómo estás?', translation: 'How are you?' },
          { phrase: 'Estoy bien, gracias.', translation: 'I am well, thank you.' },
          { phrase: 'Mucho gusto.', translation: 'Nice to meet you.' },
        ],
        grammar: [
          'Spanish opens questions with an inverted mark: ¿ … ? Exclamations use ¡ … !',
          'Two words for "you": tú (informal) and usted (formal/respectful).',
        ],
      },
      {
        n: 2, title: 'Numbers 1–10', focus: 'Count, and give a quantity.',
        vocab: [
          { word: 'uno', translation: 'one', example: 'Tengo uno.' },
          { word: 'dos', translation: 'two', example: 'Dos cafés, por favor.' },
          { word: 'tres', translation: 'three', example: 'Son las tres.' },
          { word: 'cuatro', translation: 'four', example: 'Cuatro personas.' },
          { word: 'cinco', translation: 'five', example: 'Cinco minutos.' },
          { word: 'seis', translation: 'six', example: 'Seis euros.' },
          { word: 'siete', translation: 'seven', example: 'Siete días.' },
          { word: 'ocho', translation: 'eight', example: 'Ocho horas.' },
          { word: 'nueve', translation: 'nine', example: 'Nueve meses.' },
          { word: 'diez', translation: 'ten', example: 'Diez dedos.' },
        ],
        phrases: [
          { phrase: '¿Cuánto cuesta?', translation: 'How much does it cost?' },
          { phrase: 'Tengo dos hermanos.', translation: 'I have two brothers.' },
        ],
        grammar: [
          'uno drops to "un" before a masculine noun: un café, un día.',
          'Numbers do not change for gender except uno/una and the hundreds.',
        ],
      },
      {
        n: 3, title: 'Getting around', focus: 'Ask where things are and order simply.',
        vocab: [
          { word: 'agua', translation: 'water', example: 'Un vaso de agua.' },
          { word: 'comida', translation: 'food', example: 'La comida está lista.' },
          { word: 'baño', translation: 'bathroom', example: '¿Dónde está el baño?' },
          { word: 'calle', translation: 'street', example: 'Vivo en esta calle.' },
          { word: 'ayuda', translation: 'help', example: 'Necesito ayuda.' },
          { word: 'aquí', translation: 'here', example: 'Estoy aquí.' },
        ],
        phrases: [
          { phrase: '¿Dónde está...?', translation: 'Where is...?' },
          { phrase: 'No entiendo.', translation: 'I don’t understand.' },
          { phrase: '¿Habla inglés?', translation: 'Do you speak English?' },
        ],
        grammar: [
          'estar is for location and temporary state; ser is for identity and permanence.',
          'Definite articles agree in gender/number: el/la/los/las.',
        ],
      },
    ],
  },

  ku: {
    id: 'ku', label: 'Kurdish (Kurmanji)', native: 'Kurdî', flag: '☀️',
    blurb: 'Kurmanji Kurdish — the northern dialect. Seeded first-class here because the MELEK name itself carries a Kurdish King/Angel lineage (see the MELEK lineage web).',
    lessons: [
      {
        n: 1, title: 'Greetings & courtesy', focus: 'Hello, thank you, and welcome.',
        vocab: [
          { word: 'silav', translation: 'hello', example: 'Silav, tu çawa yî?' },
          { word: 'spas', translation: 'thank you', example: 'Spas dikim.' },
          { word: 'bi xêr hatî', translation: 'welcome', example: 'Bi xêr hatî mala me.' },
          { word: 'erê', translation: 'yes', example: 'Erê, ez tême.' },
          { word: 'na', translation: 'no', example: 'Na, spas.' },
          { word: 'bi xatirê te', translation: 'goodbye', example: 'Bi xatirê te, heta sibê.' },
        ],
        phrases: [
          { phrase: 'Tu çawa yî?', translation: 'How are you?' },
          { phrase: 'Ez baş im.', translation: 'I am well.' },
          { phrase: 'Navê te çi ye?', translation: 'What is your name?' },
        ],
        grammar: [
          'Kurmanji is written in a Latin (Hawar) alphabet; ç, ş, ê, î, û are distinct letters.',
          '"im / yî / e" are the present forms of "to be": ez baş im = I am well.',
        ],
      },
      {
        n: 2, title: 'Numbers 1–10', focus: 'Counting in Kurmanji.',
        vocab: [
          { word: 'yek', translation: 'one', example: 'Yek sêv.' },
          { word: 'du', translation: 'two', example: 'Du roj.' },
          { word: 'sê', translation: 'three', example: 'Sê kes.' },
          { word: 'çar', translation: 'four', example: 'Çar deri.' },
          { word: 'pênc', translation: 'five', example: 'Pênc tili.' },
          { word: 'şeş', translation: 'six', example: 'Şeş meh.' },
          { word: 'heft', translation: 'seven', example: 'Heft roj.' },
          { word: 'heşt', translation: 'eight', example: 'Heşt saet.' },
          { word: 'neh', translation: 'nine', example: 'Neh sal.' },
          { word: 'deh', translation: 'ten', example: 'Deh tili.' },
        ],
        phrases: [
          { phrase: 'Ev çend e?', translation: 'How much is this?' },
          { phrase: 'Du kefî, ji kerema xwe.', translation: 'Two coffees, please.' },
        ],
        grammar: [
          '"ji kerema xwe" = please (literally "from your grace").',
          'Nouns have gender (masculine/feminine) which shows up in the oblique case and izafe.',
        ],
      },
      {
        n: 3, title: 'Everyday words', focus: 'Water, food, and asking for help.',
        vocab: [
          { word: 'av', translation: 'water', example: 'Avê bide min.' },
          { word: 'nan', translation: 'bread/food', example: 'Nan xwar.' },
          { word: 'mal', translation: 'home/house', example: 'Ez li malê me.' },
          { word: 'alîkarî', translation: 'help', example: 'Alîkariyê dixwazim.' },
          { word: 'roj', translation: 'day/sun', example: 'Roj baş.' },
          { word: 'dost', translation: 'friend', example: 'Ew dostê min e.' },
        ],
        phrases: [
          { phrase: 'Ez fêm nakim.', translation: 'I don’t understand.' },
          { phrase: 'Tu bi îngilîzî diaxivî?', translation: 'Do you speak English?' },
          { phrase: 'Roj baş.', translation: 'Good day.' },
        ],
        grammar: [
          'Izafe links a noun to its modifier: dostê min = friend-of mine.',
          'Word order is typically Subject–Object–Verb: "Ez avê vedixwim" = I water drink.',
        ],
      },
    ],
  },

  fr: {
    id: 'fr', label: 'French', native: 'Français', flag: '🇫🇷',
    blurb: 'A language of diplomacy, cooking, and 29 countries. Begin with polite greetings, small numbers, and survival phrases.',
    lessons: [
      {
        n: 1, title: 'Greetings & courtesy', focus: 'Hello, please, thank you.',
        vocab: [
          { word: 'bonjour', translation: 'hello / good day', example: 'Bonjour, madame.' },
          { word: 'bonsoir', translation: 'good evening', example: 'Bonsoir à tous.' },
          { word: 'merci', translation: 'thank you', example: 'Merci beaucoup.' },
          { word: 's’il vous plaît', translation: 'please', example: 'Un café, s’il vous plaît.' },
          { word: 'oui', translation: 'yes', example: 'Oui, bien sûr.' },
          { word: 'au revoir', translation: 'goodbye', example: 'Au revoir, à bientôt.' },
        ],
        phrases: [
          { phrase: 'Comment allez-vous ?', translation: 'How are you? (formal)' },
          { phrase: 'Je vais bien, merci.', translation: 'I am well, thank you.' },
          { phrase: 'Enchanté.', translation: 'Nice to meet you.' },
        ],
        grammar: [
          'French keeps a space before ? ! : and ; — "Comment allez-vous ?"',
          'vous is formal/plural "you"; tu is informal singular.',
        ],
      },
      {
        n: 2, title: 'Numbers 1–10', focus: 'Counting and quantities.',
        vocab: [
          { word: 'un', translation: 'one', example: 'Un croissant.' },
          { word: 'deux', translation: 'two', example: 'Deux cafés.' },
          { word: 'trois', translation: 'three', example: 'Trois heures.' },
          { word: 'quatre', translation: 'four', example: 'Quatre jours.' },
          { word: 'cinq', translation: 'five', example: 'Cinq euros.' },
          { word: 'six', translation: 'six', example: 'Six mois.' },
          { word: 'sept', translation: 'seven', example: 'Sept jours.' },
          { word: 'huit', translation: 'eight', example: 'Huit heures.' },
          { word: 'neuf', translation: 'nine', example: 'Neuf ans.' },
          { word: 'dix', translation: 'ten', example: 'Dix doigts.' },
        ],
        phrases: [
          { phrase: 'C’est combien ?', translation: 'How much is it?' },
          { phrase: 'J’ai deux frères.', translation: 'I have two brothers.' },
        ],
        grammar: [
          'un/une changes for gender: un livre (m.), une table (f.).',
          'The final consonant is often silent — but "six" and "dix" sound the "s" when counting alone.',
        ],
      },
      {
        n: 3, title: 'Getting around', focus: 'Order, ask directions, ask for help.',
        vocab: [
          { word: 'eau', translation: 'water', example: 'Une carafe d’eau.' },
          { word: 'pain', translation: 'bread', example: 'Du pain, s’il vous plaît.' },
          { word: 'toilettes', translation: 'restroom', example: 'Où sont les toilettes ?' },
          { word: 'rue', translation: 'street', example: 'Dans cette rue.' },
          { word: 'aide', translation: 'help', example: 'J’ai besoin d’aide.' },
          { word: 'ici', translation: 'here', example: 'Je suis ici.' },
        ],
        phrases: [
          { phrase: 'Où est... ?', translation: 'Where is...?' },
          { phrase: 'Je ne comprends pas.', translation: 'I don’t understand.' },
          { phrase: 'Parlez-vous anglais ?', translation: 'Do you speak English?' },
        ],
        grammar: [
          'Articles carry gender: le (m.), la (f.), les (pl.); de + le → du.',
          'Negation wraps the verb: ne … pas — "je ne comprends pas".',
        ],
      },
    ],
  },
};

// ── registry helpers ──────────────────────────────────────────────────────────────────────────────

/** List course ids in registry order. */
export function listCourses() { return Object.keys(COURSES); }

/** Fetch a course by id, or null. */
export function getCourse(id) {
  const c = COURSES[id];
  return c || null;
}

/** Fetch lesson `n` (1-based) of a course, or null. */
export function getLesson(courseId, n) {
  const c = getCourse(courseId);
  if (!c) return null;
  const num = Number(n);
  return c.lessons.find((l) => l.n === num) || null;
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
//  SCORING — normalize a learner's typed answer against the expected string. Accent-folding,
//  case-insensitive, punctuation-tolerant, with a Levenshtein near-match band so a single typo
//  still counts. PURE + deterministic.
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** Fold accents, lowercase, strip punctuation, collapse whitespace. */
export function normalize(s) {
  return String(s == null ? '' : s)
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // strip combining accents
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ') // drop punctuation (keep letters/numbers, any script)
    .replace(/\s+/g, ' ')
    .trim();
}

/** Classic Levenshtein edit distance (iterative, two-row). */
export function levenshtein(a, b) {
  a = String(a == null ? '' : a); b = String(b == null ? '' : b);
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    prev = cur;
  }
  return prev[b.length];
}

/**
 * Score a typed answer against the expected answer.
 * Returns { correct, score (0..1), close, distance, normalizedGiven, normalizedExpected }.
 * - exact (normalized) → score 1, correct
 * - within a small edit band (≤ ~15% of length, min 1) → close=true, correct=true, score in (0,1)
 * - otherwise → correct=false. Soft-fail: bad input never throws.
 */
export function scoreAnswer(given, expected) {
  const ng = normalize(given);
  const ne = normalize(expected);
  if (!ne) return { correct: false, score: 0, close: false, distance: Infinity, normalizedGiven: ng, normalizedExpected: ne };
  if (ng === ne) return { correct: true, score: 1, close: false, distance: 0, normalizedGiven: ng, normalizedExpected: ne };
  if (!ng) return { correct: false, score: 0, close: false, distance: ne.length, normalizedGiven: ng, normalizedExpected: ne };

  const dist = levenshtein(ng, ne);
  const tol = Math.max(1, Math.round(ne.length * 0.15)); // 1 typo, or ~15% of the answer
  const score = Math.max(0, 1 - dist / ne.length);
  if (dist <= tol) return { correct: true, score, close: true, distance: dist, normalizedGiven: ng, normalizedExpected: ne };
  return { correct: false, score, close: false, distance: dist, normalizedGiven: ng, normalizedExpected: ne };
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
//  SPACED REPETITION — SM-2 (the SuperMemo-2 / Anki algorithm), stated honestly.
//    grade (quality) is 0..5:  <3 = a lapse (reset the interval);  >=3 = recalled.
//  An SRS item carries: { reps, interval (days), ease (>=1.3), due (ISO), lapses }.
//  srsSchedule is PURE: `now` is injected; it returns a NEW item, never mutates the input.
// ════════════════════════════════════════════════════════════════════════════════════════════════

const DAY_MS = 86400000;
const MIN_EASE = 1.3;

/** A fresh SRS item, due immediately (or at `now` if given). */
export function freshItem(now = 0) {
  return { reps: 0, interval: 0, ease: 2.5, lapses: 0, due: toIso(now) };
}

function toIso(now) {
  const d = now instanceof Date ? now : new Date(now || 0);
  const t = d.getTime();
  return Number.isFinite(t) ? new Date(t).toISOString() : new Date(0).toISOString();
}
function toMs(v) {
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'number') return v;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : 0;
}

/**
 * SM-2 scheduling. Given an item, a grade (0..5), and the current time `now` (ms or Date),
 * return the NEXT item state. Deterministic — no wall-clock read. Soft-fail: a malformed item
 * is treated as fresh.
 */
export function srsSchedule({ item, grade, now = 0 } = {}) {
  const base = item && typeof item === 'object' ? item : {};
  const q = Math.max(0, Math.min(5, Number.isFinite(+grade) ? +grade : 0));
  const nowMs = toMs(now);

  let reps = Number.isFinite(+base.reps) ? +base.reps : 0;
  let interval = Number.isFinite(+base.interval) ? +base.interval : 0;
  let ease = Number.isFinite(+base.ease) ? +base.ease : 2.5;
  let lapses = Number.isFinite(+base.lapses) ? +base.lapses : 0;

  // Update ease per SM-2: EF' = EF + (0.1 - (5-q)*(0.08 + (5-q)*0.02))
  ease = ease + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02));
  if (ease < MIN_EASE) ease = MIN_EASE;

  if (q < 3) {
    // Lapse: relearn from the start. Short interval so it comes back soon.
    reps = 0;
    interval = 0; // due again essentially now (within the same session on the site)
    lapses += 1;
  } else {
    reps += 1;
    if (reps === 1) interval = 1;
    else if (reps === 2) interval = 6;
    else interval = Math.round(interval * ease);
    if (interval < 1) interval = 1;
  }

  const dueMs = nowMs + interval * DAY_MS;
  return {
    reps, interval,
    ease: Math.round(ease * 1000) / 1000,
    lapses,
    due: toIso(dueMs),
    lastGrade: q,
    lastReviewed: toIso(nowMs),
  };
}

/**
 * From a deck (array of { key, item }) pick the card most in need of review at `now`:
 * the earliest-due card whose due time is <= now; if none is due, the soonest-upcoming.
 * Returns { key, item, due, overdueMs } or null for an empty deck. Deterministic.
 */
export function nextDue(deck, now = 0) {
  if (!Array.isArray(deck) || !deck.length) return null;
  const nowMs = toMs(now);
  let best = null;
  for (const card of deck) {
    if (!card || typeof card !== 'object') continue;
    const item = card.item || freshItem(0);
    const dueMs = toMs(item.due);
    const overdueMs = nowMs - dueMs;
    if (!best || dueMs < best.dueMs) best = { key: card.key, item, due: item.due, dueMs, overdueMs };
  }
  if (!best) return null;
  return { key: best.key, item: best.item, due: best.due, overdueMs: best.overdueMs };
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
//  DECKS — flatten a course into reviewable items. Each item has a stable `key` so progress can
//  attach an SRS state to it across sessions.
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** Build a stable key for a reviewable item. */
export function itemKey(courseId, lessonN, kind, index) {
  return `${courseId}:${lessonN}:${kind}:${index}`;
}

/**
 * Flatten a course into a deck of prompt/answer cards:
 *   { key, courseId, lessonN, kind:'vocab'|'phrase', prompt (English), answer (target), example }
 * The prompt is the English side; the learner produces the target-language side.
 * Soft-fail: an unknown course → [].
 */
export function deckFor(courseId) {
  const c = getCourse(courseId);
  if (!c) return [];
  const cards = [];
  for (const lesson of c.lessons) {
    (lesson.vocab || []).forEach((v, i) => {
      cards.push({
        key: itemKey(c.id, lesson.n, 'vocab', i),
        courseId: c.id, lessonN: lesson.n, kind: 'vocab',
        prompt: v.translation, answer: v.word, example: v.example || '',
      });
    });
    (lesson.phrases || []).forEach((p, i) => {
      cards.push({
        key: itemKey(c.id, lesson.n, 'phrase', i),
        courseId: c.id, lessonN: lesson.n, kind: 'phrase',
        prompt: p.translation, answer: p.phrase, example: '',
      });
    });
  }
  return cards;
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
//  PROGRESS STORE — per-learner, append-only event log. A store exposes:
//    append(event) -> bool, events(learner) -> array (for that learner).
//  Default in-memory; jsonlStore() is a file-backed drop-in. Injectable via __setStore.
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** In-memory append-only store (default; ideal for tests + ephemeral runs). */
export function memoryStore() {
  const log = [];
  return {
    kind: 'memory',
    append(event) { try { log.push(event); return true; } catch { return false; } },
    events(learner) { return learner == null ? log.slice() : log.filter((e) => e && e.learner === learner); },
    _reset() { log.length = 0; },
  };
}

/** Default JSONL path. Honours LANGUAGE_PROGRESS_JSONL so a route + a CLI reader agree on one file. */
export function defaultStorePath() {
  return process.env.LANGUAGE_PROGRESS_JSONL || pathReal.join(__dir, '.language-progress.jsonl');
}

/**
 * JSONL-backed append-only store. Injectable fs (mkdirSync/appendFileSync/readFileSync).
 * Each append writes ONE line; events() replays the file (skipping corrupt lines). Never edits.
 */
export function jsonlStore({ fs = fsReal, path = defaultStorePath() } = {}) {
  return {
    kind: 'jsonl',
    path,
    append(event) {
      try {
        fs.mkdirSync(pathReal.dirname(path), { recursive: true });
        fs.appendFileSync(path, JSON.stringify(event) + '\n');
        return true;
      } catch { return false; }
    },
    events(learner) {
      let raw;
      try { raw = fs.readFileSync(path, 'utf8'); } catch { return []; }
      const out = [];
      for (const line of String(raw).split('\n')) {
        const s = line.trim();
        if (!s) continue;
        try {
          const ev = JSON.parse(s);
          if (learner == null || (ev && ev.learner === learner)) out.push(ev);
        } catch { /* skip corrupt line */ }
      }
      return out;
    },
  };
}

let _store = memoryStore();

/** Swap the backing store (default in-memory). Pass jsonlStore({fs,path}) for a file-backed one. */
export function __setStore(store) {
  if (store && typeof store.append === 'function' && typeof store.events === 'function') _store = store;
  return _store;
}
/** Read the active store (diagnostics / tests). */
export function __getStore() { return _store; }

/**
 * Record one graded review. Appends a 'review' event and returns the NEW SRS item computed from
 * the learner's prior state for that key. `now` injected for determinism. Soft-fail → returns the
 * computed item even if the append fails.
 *   { learner, courseId, key, grade, now, store? }
 */
export function recordReview({ learner, courseId, key, grade, now = 0, store } = {}) {
  const st = store || _store;
  const prior = itemStateFor(learner, key, st);
  const item = srsSchedule({ item: prior, grade, now });
  const event = {
    type: 'review', learner: learner == null ? '' : String(learner),
    courseId: courseId == null ? '' : String(courseId),
    key: key == null ? '' : String(key),
    grade: Math.max(0, Math.min(5, Number.isFinite(+grade) ? +grade : 0)),
    at: toIso(now), item,
  };
  try { st.append(event); } catch { /* soft-fail: still return the item */ }
  return item;
}

/** Replay a learner's events → the current SRS item for one key (or a fresh item). */
export function itemStateFor(learner, key, store) {
  const st = store || _store;
  let events = [];
  try { events = st.events(learner) || []; } catch { events = []; }
  let item = null;
  for (const ev of events) {
    if (ev && ev.type === 'review' && ev.key === key && ev.item) item = ev.item;
  }
  return item || freshItem(0);
}

/**
 * A learner's full progress: per-course review counts, mastered items (interval >= 21 days),
 * total reviews, and the live SRS item map. Replayed from the append-only store — deterministic
 * given a fixed store. Soft-fail: unknown learner → an empty-but-valid summary.
 */
export function progress(learner, store) {
  const st = store || _store;
  let events = [];
  try { events = st.events(learner) || []; } catch { events = []; }

  const items = {};            // key -> latest SRS item
  const byCourse = {};         // courseId -> { reviews, correct, keys:Set }
  let totalReviews = 0, totalCorrect = 0;

  for (const ev of events) {
    if (!ev || ev.type !== 'review') continue;
    totalReviews += 1;
    if (+ev.grade >= 3) totalCorrect += 1;
    if (ev.item && ev.key) items[ev.key] = ev.item;
    const cid = ev.courseId || (ev.key ? String(ev.key).split(':')[0] : '');
    const c = byCourse[cid] || (byCourse[cid] = { reviews: 0, correct: 0, keys: new Set() });
    c.reviews += 1;
    if (+ev.grade >= 3) c.correct += 1;
    if (ev.key) c.keys.add(ev.key);
  }

  const courses = {};
  for (const [cid, c] of Object.entries(byCourse)) {
    let mastered = 0;
    for (const k of c.keys) {
      const it = items[k];
      if (it && +it.interval >= 21) mastered += 1;
    }
    courses[cid] = { reviews: c.reviews, correct: c.correct, seen: c.keys.size, mastered };
  }

  return {
    learner: learner == null ? '' : String(learner),
    totalReviews, totalCorrect,
    accuracy: totalReviews ? Math.round((totalCorrect / totalReviews) * 100) / 100 : 0,
    courses, items,
  };
}

/**
 * Build a per-learner review deck for a course: each card gets its live SRS item attached.
 * Handy for the practice surface + nextDue(). Deterministic given a fixed store.
 */
export function learnerDeck(learner, courseId, store) {
  const st = store || _store;
  const prog = progress(learner, st);
  return deckFor(courseId).map((card) => ({ ...card, item: prog.items[card.key] || freshItem(0) }));
}

// ── CLI: quick self-check (no network). ────────────────────────────────────────────────────────────
if (process.argv[1] && /language\/lessons\.mjs$/.test(process.argv[1])) {
  console.log('courses    :', listCourses().join(', '));
  const deck = deckFor('ku');
  console.log('ku deck    :', deck.length, 'cards; first prompt →', deck[0]?.prompt, '=', deck[0]?.answer);
  console.log('score good :', JSON.stringify(scoreAnswer('silav', 'silav')));
  console.log('score typo :', JSON.stringify(scoreAnswer('silv', 'silav')));
  const wrong = srsSchedule({ item: freshItem(0), grade: 1, now: 0 });
  const right = srsSchedule({ item: freshItem(0), grade: 5, now: 0 });
  console.log('srs wrong  : interval', wrong.interval, 'due', wrong.due);
  console.log('srs right  : interval', right.interval, 'due', right.due);
}
