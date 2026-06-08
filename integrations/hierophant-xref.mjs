// hierophant-xref.mjs — the DERIVED cross-reference layer for the Hierophant library.
//
// Phase-2 (Theoi index + Blue-Letter-Bible interlinking) sits on top of the two data modules
// (hierophant-catalog.mjs = texts, hierophant-entities.mjs = entities). It adds NO new data; it
// derives indexes and a linker from what's already there:
//
//   1. A unified cross-reference index built from BOTH directions of the existing data —
//      a text's `entities[]` list AND an entity's `texts[]` list — reconciled into one symmetric
//      map (text → entities, entity → texts). Either side declaring a link counts (the two are
//      kept in sync by the validators, but we union them so a one-sided edit can't drop a link).
//
//   2. A Theoi-style browse index: every entity, alpha-sorted and grouped (by tradition, by type,
//      and a flat A–Z), for the richer /gods encyclopedia page.
//
//   3. An interlinker — the Blue-Letter-Bible "click a term → see it everywhere" experience. Given
//      a plain text string (e.g. a text's "what" paragraph), it wraps every recognised entity name
//      or epithet in a link to that entity's page, leaving all other text untouched. It works on
//      ALREADY-ESCAPED html (the caller esc()s first), matches longest-name-first so "Atum-Ra"
//      beats "Ra", never links inside an existing match, and case-folds for matching only.
//
// SECURITY / DISCIPLINE: pure derivation, no network, no keys, never throws. Every consumer must
// tolerate empty results. The interlinker only ever EMITS anchors to our own /gods/:id routes with
// an entity id taken from the registry (kebab-case) — it never reflects user input into markup.

import { TEXTS, TEXT_IDS, getText } from './hierophant-catalog.mjs';
import { ENTITIES, getEntity } from './hierophant-entities.mjs';

// ── 1. cross-reference index ──────────────────────────────────────────────────────────────────────
// Union of both directions. Returns:
//   textToEntities : Map<textId,   entityId[]>   (sorted by entity name)
//   entityToTexts  : Map<entityId,  textId[]>    (sorted by text title)
// Dangling ids on either side are dropped defensively (so a rename can't crash a page).
export function buildXref() {
  const t2e = new Map();   // textId  -> Set<entityId>
  const e2t = new Map();   // entityId-> Set<textId>
  const add = (tid, eid) => {
    if (!TEXT_IDS.has(tid) || !getEntity(eid)) return;       // skip dangling, both ways
    if (!t2e.has(tid)) t2e.set(tid, new Set());
    if (!e2t.has(eid)) e2t.set(eid, new Set());
    t2e.get(tid).add(eid);
    e2t.get(eid).add(tid);
  };
  // direction A: text.entities[]
  for (const t of TEXTS) for (const eid of (t.entities || [])) add(t.id, eid);
  // direction B: entity.texts[]
  for (const e of ENTITIES) for (const tid of (e.texts || [])) add(tid, e.id);

  // freeze into sorted plain arrays
  const textToEntities = new Map();
  for (const [tid, set] of t2e) {
    textToEntities.set(tid, [...set].sort((a, b) => {
      const A = getEntity(a), B = getEntity(b);
      return String(A && A.name).localeCompare(String(B && B.name));
    }));
  }
  const entityToTexts = new Map();
  for (const [eid, set] of e2t) {
    entityToTexts.set(eid, [...set].sort((a, b) => {
      const A = getText(a), B = getText(b);
      return String(A && A.title).localeCompare(String(B && B.title));
    }));
  }
  return { textToEntities, entityToTexts };
}

/** Resolved entities mentioned in a text (back-reference for text pages). [{id,name,...}] sorted by name. */
export function entitiesForText(textId) {
  const { textToEntities } = buildXref();
  return (textToEntities.get(textId) || []).map(getEntity).filter(Boolean);
}

/** Resolved texts that mention an entity (back-reference for entity pages). [{id,title,...}] sorted by title. */
export function textsForEntity(entityId) {
  const { entityToTexts } = buildXref();
  return (entityToTexts.get(entityId) || []).map(getText).filter(Boolean);
}

// ── 2. Theoi-style browse index ─────────────────────────────────────────────────────────────────
// Alpha-sorted full list, plus grouped views. Each group is { key, label, list } with list alpha-sorted.
const byName = (a, b) => String(a.name).localeCompare(String(b.name));

/** Every entity, alpha-sorted by display name. */
export function entitiesAlpha() {
  return [...ENTITIES].sort(byName);
}

/**
 * Group entities for the index page.
 *   groupBy('tradition') -> one group per tradition that has entities, key = tradition id (server maps to name)
 *   groupBy('type')      -> one group per entity type that has entities
 *   groupBy('letter')    -> A–Z buckets (first letter of name; non-letters bucket under '#')
 * Groups are returned sorted by key; within each group entities are alpha-sorted.
 */
export function groupEntities(by = 'tradition') {
  const buckets = new Map();
  const keyOf = (e) => {
    if (by === 'type') return e.type || 'concept';
    if (by === 'letter') {
      const c = String(e.name || '').trim().charAt(0).toUpperCase();
      return /[A-Z]/.test(c) ? c : '#';
    }
    return e.tradition || 'other';
  };
  for (const e of entitiesAlpha()) {
    const k = keyOf(e);
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(e);
  }
  const keys = [...buckets.keys()].sort((a, b) => a.localeCompare(b));
  return keys.map((key) => ({ key, label: key, list: buckets.get(key) }));
}

// ── 3. the interlinker (Blue-Letter-Bible "click a term → see it everywhere") ───────────────────────
// Build, once, a match table of [phrase, entityId], longest first so multi-word / hyphenated names
// win over their substrings.
//
// PHRASE DISCIPLINE — this is what keeps interlinking from getting silly. A figure's NAME always
// qualifies. An EPITHET only qualifies if it reads like a proper noun: it must NOT begin with an
// article ("the Sea", "the Dragon" → skip — they'd link a common phrase, not the figure), and every
// alphabetic word in it must be Capitalised ("Hermes Trismegistus", "Atum-Ra", "Bel" → keep;
// "Cosmic Order", "Truth" alone, "King of the Gods" → skip). This stops a generic epithet from
// stealing the (one-per-entity) link off the real name later in the sentence. Parentheticals and
// quotes are stripped first ('Khepri (dawn)' -> 'Khepri'); phrases under 3 chars are dropped.
const ARTICLES = new Set(['the', 'a', 'an']);
function isProperPhrase(phrase) {
  const words = phrase.split(/[\s-]+/).filter(Boolean);
  if (!words.length) return false;
  if (ARTICLES.has(words[0].toLowerCase())) return false;        // "the Sea", "the Dragon"
  // every alphabetic word must start uppercase (allows hyphen compounds like Atum-Ra)
  return words.every((w) => !/[a-z]/.test(w[0]) || /^[A-Z]/.test(w));
}
function buildMatchTable() {
  const seen = new Set();   // lowercased phrase -> first owner wins (registry order)
  const table = [];
  const consider = (raw, id, isName) => {
    let phrase = String(raw || '').replace(/\([^)]*\)/g, '').trim();   // strip parentheticals
    phrase = phrase.replace(/["“”']/g, '').trim();
    if (phrase.length < 3) return;                                     // too short → skip (avoids noise)
    if (!isName && !isProperPhrase(phrase)) return;                   // epithet must be proper-noun-like
    const key = phrase.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    table.push({ phrase, id });
  };
  for (const e of ENTITIES) {
    consider(e.name, e.id, true);
    for (const ep of (e.epithets || [])) consider(ep, e.id, false);
  }
  // longest phrase first so 'Atum-Ra' is matched before 'Ra', 'Hermes Trismegistus' before its parts
  table.sort((a, b) => b.phrase.length - a.phrase.length);
  return table;
}
let _matchTable = null;
function matchTable() { return (_matchTable ||= buildMatchTable()); }

// word-ish boundary: a name match must not sit inside a longer word ("Rama" must not match "Ra").
const isWordChar = (ch) => !!ch && /[A-Za-z0-9À-ɏ]/.test(ch);

/**
 * Interlink a plain-text string: wrap recognised entity names/epithets with links to /gods/:id.
 *
 *   text       the source string (already HTML-escaped by the caller — we never escape, never inject)
 *   esc        the caller's esc() — used ONLY to escape the entity id/class we put into the anchor
 *   opts.excludeId   don't self-link a phrase to the page we're already on (an entity's own page)
 *   opts.linkClass   optional class for the emitted <a>
 *
 * Unknown text is returned byte-for-byte. On any unexpected condition it returns the input unchanged
 * (soft-fail). Each distinct entity is linked at most ONCE (its first mention), Blue-Letter-style —
 * keeps prose readable instead of turning every repeat into a link.
 */
export function interlink(text, esc, opts = {}) {
  const src = String(text == null ? '' : text);
  if (!src) return '';
  const escId = typeof esc === 'function' ? esc : (s) => String(s);
  const excludeId = opts.excludeId || '';
  const cls = opts.linkClass ? ` class="${escId(opts.linkClass)}"` : '';
  try {
    const table = matchTable().filter((m) => m.id !== excludeId);
    const linked = new Set();          // entityId already linked once in this string
    let out = '';
    let i = 0;
    const lower = src.toLowerCase();
    while (i < src.length) {
      let matched = null;
      for (const m of table) {
        if (linked.has(m.id)) continue;
        const p = m.phrase.toLowerCase();
        if (lower.startsWith(p, i)) {
          const before = src[i - 1];
          const after = src[i + p.length];
          if (!isWordChar(before) && !isWordChar(after)) { matched = m; break; }
        }
      }
      if (matched) {
        const shown = src.slice(i, i + matched.phrase.length);   // preserve original casing/escaping
        out += `<a href="/gods/${escId(matched.id)}"${cls}>${shown}</a>`;
        linked.add(matched.id);
        i += matched.phrase.length;
      } else {
        out += src[i];
        i += 1;
      }
    }
    return out;
  } catch {
    return src;   // soft-fail: never throw out of a renderer
  }
}

// test seam — let tests reset the memoised match table if they monkey with the registry
export function __resetMatchTable() { _matchTable = null; }
