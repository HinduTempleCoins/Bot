// mom-layer.mjs — task #226. The MoM (Minutes-of-Meeting) layer of the checks-and-balances stack.
//
//   Annals (fallible records)  →  MoM (meeting minutes)  →  Briefs  →  Itinerary
//                                  ▲ THIS module
//   atop Foundational Law (BRIEF.md).
//
// THE LOAD-BEARING IDEA (operator, durable ask): the brief-writing AIs read the MINUTES of the
// 12-and-12 conference, NOT the raw transcripts. A transcript is a fallible, sprawling, possibly
// operator-private record; the MINUTES are the distilled, structured, sharable account of what was
// DECIDED and what is to be DONE. Brief-writers get the minutes-derived view ONLY — they never see
// the raw conversation. This module is the boundary that enforces that.
//
// What it does:
//   • summarizeToMinutes()  — turn meeting notes/decisions/action-items into a structured MoM record.
//                             The record deliberately has NO `transcript` field. Minutes are not a log.
//   • extractActionItems()  — heuristic pull of action-item lines from free-text meeting notes.
//   • forBriefWriter()      — the TRIMMED view a brief-writer AI receives: decisions + action items +
//                             open questions ONLY. No raw transcript, no operator-private material.
//   • appendMinutes()       — append-only minutes log (the minutes are never rewritten or deleted).
//   • SCRUM_TEMPLATES       — reference MoM / standup / retro templates (the SCRUM datasets the
//                             operator asked to add).
//   • renderMinutes()       — human-readable markdown minutes.
//
// CONVENTIONS (match the rest of integrations/):
//   • PURE / DETERMINISTIC — every timestamp comes from an injectable clock ({ now }); no Date.now()
//     in the data path. Same inputs → same MoM record.
//   • INJECTABLE STORE — appendMinutes takes { store }; tests pass an in-memory store, run OFFLINE.
//   • SOFT-FAIL — bad/empty input yields an empty-but-valid record, never a throw.
//   • CLI GUARDED — the demo only runs when invoked directly.
//   • NO SECRETS, NO KEYS, READ-ONLY over its inputs.
//
//   import { summarizeToMinutes, extractActionItems, forBriefWriter,
//            appendMinutes, createMinutesStore, SCRUM_TEMPLATES, renderMinutes } from './mom-layer.mjs'
//
//   node integrations/mom-layer.mjs        # print a demo set of minutes + the brief-writer view

// ── clock (injectable, deterministic) ───────────────────────────────────────────────────────────────
const nowMs = (now) => {
  try {
    if (typeof now === 'function') { const v = now(); return Number.isFinite(+v) ? +v : Date.now(); }
    if (Number.isFinite(+now)) return +now;
  } catch { /* fall through */ }
  return Date.now();
};
const iso = (ms) => new Date(ms).toISOString();

// stable, content-free id derived from the conference id + timestamp — deterministic given a fixed clock.
const slug = (s) => String(s || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
function minutesId(conferenceId, ms) {
  const base = slug(conferenceId) || 'conf';
  return `mom:${base}:${iso(ms).slice(0, 19).replace(/[:T]/g, '').replace(/-/g, '')}`;
}

const asArray = (x) => (Array.isArray(x) ? x.filter((v) => v != null) : x == null ? [] : [x]);
const cleanStr = (x) => String(x == null ? '' : x).trim();

// ── action-item extraction (heuristic) ──────────────────────────────────────────────────────────────
// Pull action-item lines out of free-text meeting notes. Heuristics, in priority order:
//   • "TODO: ..." / "ACTION: ..." / "AI: ..." prefixes
//   • "owner: name — do X" / "@name will do X"
//   • "we will ..." / "we should ..." / "we need to ..." / "let's ..." / "next step ..."
//   • a leading imperative verb on a bullet line (build/add/fix/ship/write/wire/...)
// Returns [{ text, owner?, status:'open' }]. Pure, never throws.

const IMPERATIVE_VERBS = [
  'build', 'add', 'fix', 'ship', 'write', 'wire', 'create', 'remove', 'update', 'deploy',
  'review', 'test', 'check', 'verify', 'draft', 'send', 'investigate', 'document', 'refactor',
  'migrate', 'implement', 'merge', 'rebase', 'schedule', 'contact', 'confirm', 'follow', 'plan',
];
const IMPERATIVE_RE = new RegExp(`^(?:${IMPERATIVE_VERBS.join('|')})\\b`, 'i');
const PREFIX_RE = /^\s*(?:[-*•\d.)\s]*)?(?:TODO|ACTION|AI|ACTION ITEM|TASK)\s*[:\-]\s*(.+)$/i;
const WE_WILL_RE = /\b(?:we\s+(?:will|should|need\s+to|must|have\s+to)|let'?s|next\s+steps?)\b\s*[:,-]?\s*(.+)$/i;
const OWNER_PREFIX_RE = /^\s*(?:[-*•\s]*)?owner\s*[:\-]\s*([^—:|\-]+?)\s*(?:[—:|\-]\s*)(.+)$/i;
const AT_OWNER_RE = /(?:^|\s)@([a-z0-9_.\-]+)\s+(?:will|to|should|please)\b\s*(.+)$/i;

// strip bullet/numbering decoration from the front of a line
const undecorate = (s) => cleanStr(s).replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '');

function lineToActionItem(rawLine) {
  const line = cleanStr(rawLine);
  if (!line) return null;

  // owner: name — task
  const own = line.match(OWNER_PREFIX_RE);
  if (own) {
    const text = cleanStr(own[2]);
    if (text) return { text, owner: cleanStr(own[1]), status: 'open' };
  }
  // @name will task
  const at = line.match(AT_OWNER_RE);
  if (at) {
    const text = cleanStr(at[2]);
    if (text) return { text, owner: cleanStr(at[1]), status: 'open' };
  }
  // TODO:/ACTION:/AI: prefixes
  const pre = line.match(PREFIX_RE);
  if (pre) {
    const text = cleanStr(pre[1]);
    if (text) return { text, status: 'open' };
  }
  // we will / we should / let's / next step
  const we = line.match(WE_WILL_RE);
  if (we) {
    const text = cleanStr(we[1]);
    if (text) return { text, status: 'open' };
  }
  // leading imperative verb on an (optionally bulleted) line
  const bare = undecorate(line);
  if (IMPERATIVE_RE.test(bare)) return { text: bare, status: 'open' };

  return null;
}

/**
 * Pull action-item lines from free-text meeting notes.
 * @param {string|string[]} text  notes (multi-line string or array of lines)
 * @returns {Array<{text:string, owner?:string, status:'open'}>}
 */
export function extractActionItems(text) {
  if (text == null) return [];
  const lines = Array.isArray(text) ? text : String(text).split(/\r?\n/);
  const out = [];
  const seen = new Set();
  for (const ln of lines) {
    const item = lineToActionItem(ln);
    if (!item) continue;
    const key = `${(item.owner || '').toLowerCase()}|${item.text.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

// ── topic + open-question extraction (light, from notes) ─────────────────────────────────────────────
const QUESTION_RE = /(?:^|\s)(?:open\s+question|question|unresolved|tbd|to\s+decide)\b\s*[:\-]?\s*(.+)$/i;
function extractOpenQuestions(text) {
  if (text == null) return [];
  const lines = Array.isArray(text) ? text : String(text).split(/\r?\n/);
  const out = [];
  const seen = new Set();
  for (const ln of lines) {
    const s = undecorate(ln);
    let q = null;
    const m = s.match(QUESTION_RE);
    if (m && cleanStr(m[1])) q = cleanStr(m[1]);
    else if (/\?\s*$/.test(s) && s.length > 3) q = s;
    if (!q) continue;
    const k = q.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(q);
  }
  return out;
}

// derive coarse topics from decisions + action items (the headline subjects of the meeting)
function deriveTopics(decisions, actionItems, explicitTopics) {
  const topics = new Set(asArray(explicitTopics).map(cleanStr).filter(Boolean));
  for (const d of decisions) {
    const t = cleanStr(d).split(/[:.—-]/)[0].trim();
    if (t && t.length <= 60) topics.add(t);
  }
  for (const a of actionItems) {
    const words = cleanStr(a.text).split(/\s+/).slice(0, 4).join(' ');
    if (words) topics.add(words);
  }
  return [...topics].slice(0, 12);
}

// ── summarizeToMinutes — the distilled MoM record ────────────────────────────────────────────────────
/**
 * Build a structured Minutes-of-Meeting record from the meeting's notes, decisions and action items.
 * The record is the DISTILLED minutes — it deliberately has NO `transcript` / `raw` field. Minutes are
 * the account of what was decided and what is to be done, not a log of who said what.
 *
 * @param {{
 *   conferenceId?: string,
 *   notes?: string|string[],        // free-text meeting notes (mined for action items + open questions)
 *   decisions?: string[],            // explicit decisions reached
 *   actionItems?: Array<string|{text:string,owner?:string,status?:string}>,  // explicit action items
 *   attendees?: string[],            // who was present (the AIs / operator)
 *   topics?: string[],               // optional explicit topics
 * }} input
 * @param {{ now?: (()=>number)|number }} [opts]  injectable clock
 * @returns {{ id, at, conferenceId, attendees:string[], decisions:string[],
 *             actionItems:Array<{text,owner?,status}>, topics:string[], openQuestions:string[] }}
 */
export function summarizeToMinutes(input = {}, opts = {}) {
  const src = input && typeof input === 'object' ? input : {};
  const ms = nowMs(opts.now);

  const attendees = asArray(src.attendees).map(cleanStr).filter(Boolean);
  const decisions = asArray(src.decisions).map(cleanStr).filter(Boolean);

  // normalize explicit action items, then mine the notes for any additional ones.
  const explicitItems = asArray(src.actionItems).map((it) => {
    if (typeof it === 'string') return lineToActionItem(it) || { text: cleanStr(it), status: 'open' };
    if (it && typeof it === 'object' && cleanStr(it.text)) {
      const o = { text: cleanStr(it.text), status: cleanStr(it.status) || 'open' };
      if (cleanStr(it.owner)) o.owner = cleanStr(it.owner);
      return o;
    }
    return null;
  }).filter((x) => x && x.text);

  const minedItems = extractActionItems(src.notes);

  // merge, dedup by owner|text (explicit wins on order)
  const actionItems = [];
  const seenAI = new Set();
  for (const it of [...explicitItems, ...minedItems]) {
    const key = `${(it.owner || '').toLowerCase()}|${it.text.toLowerCase()}`;
    if (seenAI.has(key)) continue;
    seenAI.add(key);
    actionItems.push(it);
  }

  const openQuestions = extractOpenQuestions(src.notes);
  const topics = deriveTopics(decisions, actionItems, src.topics);

  // NOTE: NO `transcript`/`raw`/`notes` field on the record. Minutes are distilled, not a log.
  return {
    id: minutesId(src.conferenceId, ms),
    at: iso(ms),
    conferenceId: cleanStr(src.conferenceId) || null,
    attendees,
    decisions,
    actionItems,
    topics,
    openQuestions,
  };
}

// ── forBriefWriter — the trimmed view a brief-writer AI receives ─────────────────────────────────────
// The boundary that enforces "brief-writers read the MINUTES, not the transcript." It returns ONLY the
// decisions, action items and open questions. It explicitly drops attendees (who said what), any raw /
// transcript / notes field, and anything flagged operator-private. The result is safe to hand to an AI.
const PRIVATE_KEYS = new Set([
  'transcript', 'raw', 'rawTranscript', 'notes', 'conversation', 'messages', 'log',
  'private', 'operatorPrivate', 'secret', 'secrets', 'attendees',
]);

/**
 * The trimmed, transcript-free view of a MoM record for brief-writer AIs.
 * @param {object} mom  a record from summarizeToMinutes (or shaped like one)
 * @returns {{ id, at, decisions:string[], actionItems:Array<{text,owner?,status}>, openQuestions:string[], topics:string[] }}
 */
export function forBriefWriter(mom) {
  const m = mom && typeof mom === 'object' ? mom : {};
  return {
    id: cleanStr(m.id) || null,
    at: cleanStr(m.at) || null,
    topics: asArray(m.topics).map(cleanStr).filter(Boolean),
    decisions: asArray(m.decisions).map(cleanStr).filter(Boolean),
    actionItems: asArray(m.actionItems)
      .map((it) => {
        if (it && typeof it === 'object' && cleanStr(it.text)) {
          const o = { text: cleanStr(it.text), status: cleanStr(it.status) || 'open' };
          if (cleanStr(it.owner)) o.owner = cleanStr(it.owner);
          return o;
        }
        return null;
      })
      .filter(Boolean),
    openQuestions: asArray(m.openQuestions).map(cleanStr).filter(Boolean),
  };
  // PRIVATE_KEYS (transcript/raw/notes/attendees/operatorPrivate/...) are NEVER copied across.
}

// guard exported for tests/callers: true iff an object has no leaked private/raw key.
export function isBriefWriterSafe(view) {
  if (!view || typeof view !== 'object') return false;
  return !Object.keys(view).some((k) => PRIVATE_KEYS.has(k));
}

// ── append-only minutes log ──────────────────────────────────────────────────────────────────────────
/**
 * A default in-memory append-only minutes store. Tests can pass their own object with the same shape.
 * Minutes are NEVER rewritten or deleted — the record of what a meeting decided is permanent.
 */
export function createMinutesStore() {
  const records = [];
  return {
    append(rec) { records.push(rec); return rec; },
    list() { return records.slice(); },
    get size() { return records.length; },
  };
}

/**
 * Append a MoM record to a minutes store (append-only). NEVER deletes or mutates an existing record.
 * Soft-fails to { ok:false } if the store can't accept the record.
 * @param {object} mom  a record from summarizeToMinutes
 * @param {{ store?: object }} [opts]  store.append(rec) is the only required method
 * @returns {{ ok:boolean, size?:number }}
 */
export function appendMinutes(mom, { store } = {}) {
  if (!mom || typeof mom !== 'object') return { ok: false };
  if (!store || typeof store.append !== 'function') return { ok: false };
  try {
    store.append(mom);
    const size = typeof store.size === 'number'
      ? store.size
      : (typeof store.list === 'function' ? store.list().length : undefined);
    return { ok: true, size };
  } catch {
    return { ok: false };
  }
}

// ── SCRUM templates (the datasets the operator asked to add) ─────────────────────────────────────────
// Reference scaffolds for the minutes layer: a Minutes-of-Meeting template, a daily-standup template,
// and a sprint-retrospective template. These shape how the 12-and-12 conference output is distilled.
export const SCRUM_TEMPLATES = Object.freeze({
  mom: Object.freeze({
    name: 'Minutes of Meeting',
    description: 'Distilled record of a meeting — what was decided and what is to be done. Not a transcript.',
    sections: Object.freeze([
      'Attendees', 'Topics discussed', 'Decisions reached', 'Action items (owner + status)', 'Open questions',
    ]),
    fields: Object.freeze(['attendees', 'topics', 'decisions', 'actionItems', 'openQuestions']),
  }),
  standup: Object.freeze({
    name: 'Daily Standup',
    description: 'Three-question status check per participant. Surfaces blockers fast.',
    questions: Object.freeze([
      'What did you do since the last standup?',
      'What will you do before the next standup?',
      'What is blocking you?',
    ]),
    fields: Object.freeze(['yesterday', 'today', 'blockers']),
  }),
  retro: Object.freeze({
    name: 'Sprint Retrospective',
    description: 'Look back over the sprint to improve the next one.',
    prompts: Object.freeze([
      'What went well?',
      'What did not go well?',
      'What will we change next sprint? (action items)',
    ]),
    fields: Object.freeze(['wentWell', 'wentPoorly', 'changes']),
  }),
});

// ── renderMinutes — markdown ─────────────────────────────────────────────────────────────────────────
/**
 * Render a MoM record as human-readable markdown minutes. Pure, never throws.
 * @param {object} mom
 * @returns {string} markdown
 */
export function renderMinutes(mom) {
  const m = mom && typeof mom === 'object' ? mom : {};
  const L = [];
  const title = cleanStr(m.conferenceId) || 'Conference';
  L.push(`# Minutes — ${title}`);
  L.push(`*${cleanStr(m.at) || '—'} · id: ${cleanStr(m.id) || '—'}*`);
  L.push('');

  const attendees = asArray(m.attendees).map(cleanStr).filter(Boolean);
  L.push(`**Attendees:** ${attendees.length ? attendees.join(', ') : '_none recorded_'}`);
  L.push('');

  const topics = asArray(m.topics).map(cleanStr).filter(Boolean);
  L.push('## Topics');
  if (topics.length) topics.forEach((t) => L.push(`- ${t}`));
  else L.push('- _none recorded_');
  L.push('');

  const decisions = asArray(m.decisions).map(cleanStr).filter(Boolean);
  L.push('## Decisions');
  if (decisions.length) decisions.forEach((d) => L.push(`- ${d}`));
  else L.push('- _none recorded_');
  L.push('');

  const items = asArray(m.actionItems).filter((it) => it && cleanStr(it.text));
  L.push('## Action items');
  if (items.length) {
    items.forEach((it) => {
      const owner = cleanStr(it.owner) ? ` _(owner: ${cleanStr(it.owner)})_` : '';
      const status = cleanStr(it.status) || 'open';
      L.push(`- [ ] ${cleanStr(it.text)}${owner} — \`${status}\``);
    });
  } else L.push('- _none recorded_');
  L.push('');

  const qs = asArray(m.openQuestions).map(cleanStr).filter(Boolean);
  L.push('## Open questions');
  if (qs.length) qs.forEach((q) => L.push(`- ${q}`));
  else L.push('- _none recorded_');
  L.push('');
  L.push('*Distilled minutes (no transcript) · brief-writers read this layer, not the raw conversation.*');

  return L.join('\n');
}

export default {
  summarizeToMinutes,
  extractActionItems,
  forBriefWriter,
  isBriefWriterSafe,
  appendMinutes,
  createMinutesStore,
  SCRUM_TEMPLATES,
  renderMinutes,
};

// ── CLI (guarded) ────────────────────────────────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('mom-layer.mjs')) {
  const fixedClock = () => Date.parse('2026-06-04T18:00:00Z');
  const mom = summarizeToMinutes({
    conferenceId: '12-and-12 / 2026-06-04 18:00 UTC',
    attendees: ['Claude Code', 'Qwen', 'ensemble'],
    notes: [
      'We will wire the MoM layer into the brief pipeline.',
      'TODO: add SCRUM datasets to the repo.',
      'owner: Qwen — summarize the conference to minutes nightly',
      'Open question: do brief-writers ever need attendee attribution?',
      'Build the conversation-parsing pipeline next (task #227).',
    ].join('\n'),
    decisions: [
      'Brief-writers read the MoM layer, not raw transcripts.',
      'Minutes are append-only and carry no transcript field.',
    ],
    actionItems: [
      { text: 'Ship mom-layer.mjs + tests', owner: 'Claude Code' },
    ],
  }, { now: fixedClock });

  const store = createMinutesStore();
  appendMinutes(mom, { store });

  // eslint-disable-next-line no-console
  console.log(renderMinutes(mom));
  // eslint-disable-next-line no-console
  console.log('\n--- brief-writer view (decisions + action items + open questions ONLY) ---\n');
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(forBriefWriter(mom), null, 2));
}
