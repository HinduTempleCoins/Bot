// asks-to-tasks.mjs — the bridge from the ASKS-RECORDING system to the task list. Operator
// 2026-06-01: the thing that records "asks" in our conversations should boot into task creation
// when I say "create tasks for automode." This reads recent conversation text (the operator's
// messages — the same stream the brief's "last things you asked for" section uses), extracts each
// ask VERBATIM via the conversation parser, dedupes against tasks already on the list, and emits
// clean task specs ready to create. No paraphrase — the operator's words become the task.
//
//   node tools/asks-to-tasks.mjs <conversation.md> [existing-tasks.txt]
//   cat recent.md | node tools/asks-to-tasks.mjs -
//   import { asksToTasks } from './asks-to-tasks.mjs'

import { readFileSync } from 'node:fs';
import { parseConversation } from './conversation-parser.mjs';

// turn one ask sentence into a task spec: a short subject + the full ask as the description.
function toTask(ask) {
  const subject = ask.length <= 70 ? ask : ask.slice(0, 67).replace(/\s+\S*$/, '') + '…';
  return { subject, description: ask, activeForm: 'Working on: ' + subject };
}

// cheap fuzzy dedupe: normalize to lowercase word-set, treat as same if >70% token overlap.
function tokens(s) { return new Set(String(s).toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length > 3)); }
function similar(a, b) {
  const A = tokens(a), B = tokens(b); if (!A.size || !B.size) return false;
  let inter = 0; for (const t of A) if (B.has(t)) inter++;
  return inter / Math.min(A.size, B.size) >= 0.7;
}

/**
 * Extract the operator's asks from conversation text and return task specs not already covered by
 * `existingSubjects`. Decisions + action items both count as asks (an automode queue wants both).
 */
export function asksToTasks(conversationText, existingSubjects = []) {
  const parsed = parseConversation(conversationText);
  const asks = [...parsed.actions, ...parsed.decisions];
  const out = [];
  for (const ask of asks) {
    if (existingSubjects.some((e) => similar(ask, e)) || out.some((t) => similar(ask, t.description))) continue;
    out.push(toTask(ask));
  }
  return out;
}

if (process.argv[1] && process.argv[1].endsWith('asks-to-tasks.mjs')) {
  const conv = process.argv[2];
  if (!conv) { console.error('usage: asks-to-tasks.mjs <conversation.md|-> [existing-tasks.txt]'); process.exit(1); }
  const text = conv === '-' ? readFileSync(0, 'utf8') : readFileSync(conv, 'utf8');
  const existing = process.argv[3] ? readFileSync(process.argv[3], 'utf8').split('\n').filter(Boolean) : [];
  const tasks = asksToTasks(text, existing);
  console.log(`${tasks.length} new task(s) extracted from your asks (verbatim, deduped):\n`);
  console.log(JSON.stringify(tasks, null, 2));
  console.log(`\n→ feed these to TaskCreate. This is the asks-recorder booting into the task list.`);
}
