// flags.js — the knowledge-base FLAG STORE. The fact-checker writes here when a claim is contradicted
// or can't be verified against external reality; the BRIEF WRITERS read here so that when they write
// about a flagged topic/source, they carry the dispute instead of repeating it as fact.
//
// Keyed by source FILE (the KB document the claim came from, via the article's <ref>) and by TOPIC,
// so a brief writer can ask: "any flags on this file?" or "any flags on this topic?".
//
//   import { recordFlag, flagsForFile, flagsForTopic, allFlags } from './flags.js'

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const STORE = process.env.KB_FLAG_STORE || path.join(__dir, '..', '..', 'data', 'kb-flags.json');

function load() {
  try { return JSON.parse(fs.readFileSync(STORE, 'utf8')); }
  catch { return { byFile: {}, updated: '' }; }
}
function save(db) {
  fs.mkdirSync(path.dirname(STORE), { recursive: true });
  fs.writeFileSync(STORE, JSON.stringify(db, null, 2));
}

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * Record a flag. `verdict` is CONTRADICTED | UNVERIFIABLE. A SUPPORTED/INTERNAL claim is NOT a flag;
 * recording one clears any prior flag for the same claim (so re-checks heal the store).
 */
export function recordFlag({ file, topic, claim, verdict, reason, evidence, checkedAt }) {
  const db = load();
  const key = file || 'unknown';
  db.byFile[key] = db.byFile[key] || { topics: [], flags: [] };
  if (topic && !db.byFile[key].topics.includes(topic)) db.byFile[key].topics.push(topic);
  // dedupe by claim text
  db.byFile[key].flags = db.byFile[key].flags.filter((f) => norm(f.claim) !== norm(claim));
  if (verdict === 'CONTRADICTED' || verdict === 'UNVERIFIABLE') {
    db.byFile[key].flags.push({ claim, verdict, reason: reason || '', evidence: evidence || '', topic: topic || '', checkedAt: checkedAt || '' });
  }
  if (!db.byFile[key].flags.length) delete db.byFile[key]; // healed → drop empty
  db.updated = checkedAt || db.updated;
  save(db);
}

/** Flags for a specific KB source file. The brief writer's primary lookup. */
export function flagsForFile(file) {
  const db = load();
  return db.byFile[file]?.flags || [];
}

/** Flags for a topic — matches against recorded topics + claim text (fuzzy). */
export function flagsForTopic(topic) {
  const db = load();
  const t = norm(topic);
  const out = [];
  for (const [file, rec] of Object.entries(db.byFile)) {
    const topicMatch = (rec.topics || []).some((x) => norm(x).includes(t) || t.includes(norm(x)));
    for (const f of rec.flags) {
      if (topicMatch || norm(f.claim).includes(t) || norm(f.topic).includes(t)) out.push({ file, ...f });
    }
  }
  return out;
}

/** Everything — for a dashboard or a full audit export. */
export function allFlags() { return load(); }

/** True when `s` looks like a KB FILE key (a path with an extension) rather than a free topic. */
function looksLikeFile(s) {
  return /[\\/]/.test(String(s)) || /\.(json|md|txt|wiki)$/i.test(String(s));
}

/** How many open flags exist for a KB file OR topic — the "N open fact-flags" the brief feed shows. */
export function openFlagCount(kbFileOrTopic) {
  const flags = looksLikeFile(kbFileOrTopic) ? flagsForFile(kbFileOrTopic) : flagsForTopic(kbFileOrTopic);
  return flags.length;
}

/**
 * A short note a brief writer can paste into context for a KB FILE or a TOPIC (#123). Returns '' when
 * clean. When given a path-like argument it looks up that exact KB file (the key flags are recorded
 * under); otherwise it fuzzy-matches the topic. The header states the open-flag COUNT so the Server-4
 * brief pipeline can surface "this KB doc has N open fact-flags."
 */
export function briefWarningFor(kbFileOrTopic) {
  const isFile = looksLikeFile(kbFileOrTopic);
  const flags = isFile ? flagsForFile(kbFileOrTopic) : flagsForTopic(kbFileOrTopic);
  if (!flags.length) return '';
  const label = isFile ? `KB doc "${kbFileOrTopic}"` : `"${kbFileOrTopic}"`;
  const lines = flags.slice(0, 8).map((f) => `- [${f.verdict}] ${f.claim} — ${f.reason}${f.evidence ? ` (${f.evidence})` : ''}`);
  const more = flags.length > 8 ? `\n…and ${flags.length - 8} more.` : '';
  return `⚠️ FACT-CHECK FLAGS — ${label} has ${flags.length} open fact-flag(s); the knowledge base contains disputed/unverified claims here. Do NOT repeat them as fact; attribute or omit:\n${lines.join('\n')}${more}`;
}

if (process.argv[1] && process.argv[1].endsWith('flags.js')) {
  const [cmd, arg] = process.argv.slice(2);
  if (cmd === 'topic' || cmd === 'warn') console.log(briefWarningFor(arg) || `(no flags for "${arg}")`);
  else if (cmd === 'count') console.log(openFlagCount(arg));
  else if (cmd === 'file') console.log(JSON.stringify(flagsForFile(arg), null, 2));
  else console.log(JSON.stringify(allFlags(), null, 2));
}
