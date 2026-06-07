// flag-changes.mjs — push the files Claude (or anyone) just changed into the annal system's
// PRIORITY QUEUE, so the annal-writing AIs cover the change promptly instead of waiting for the
// round-robin cursor to come around. Operator rule (2026-06-01): "changes go into their queue to
// be checked — make that a normal thing."
//
//   node tools/flag-changes.mjs [gitRange]      # default: last 2 days of commits (HEAD@{2.days.ago}..HEAD)
//   node tools/flag-changes.mjs HEAD~5..HEAD
//
// Writes .local/ai-net-priority.json (the queue payload) + .local/change-log.jsonl (the record
// with the "why"). Delivers to the brain when BRAIN_SSH + AINET_PRIORITY_PATH are set
// (gitignored .local/brain-delivery.env), exactly like publish-feed — never hard-codes infra.

import { execSync } from 'node:child_process';
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';

const range = process.argv[2] || `HEAD@{2.days.ago}..HEAD`;
const ANNAL_EXT = new Set(['.js', '.mjs', '.cjs', '.ts', '.py', '.sh', '.md', '.json', '.mdx', '.txt']);

function sh(cmd) { try { return execSync(cmd, { cwd: process.cwd(), encoding: 'utf8' }).trim(); } catch { return ''; } }

// changed files across the range (added/modified/renamed), repo-relative
const raw = sh(`git diff --name-only ${range}`) || sh(`git diff --name-only HEAD~20..HEAD`);
const files = [...new Set(raw.split('\n').map(s => s.trim()).filter(Boolean))]
  .filter(f => ANNAL_EXT.has((f.match(/\.[a-z]+$/i) || [''])[0].toLowerCase()))
  // datasets/ is bulk ingested corpus (cookbooks, crypto-protocols, ml-libs, …),
  // not hand-authored code/docs — flagging it floods the annal review queue with
  // noise the AIs shouldn't be debug-reviewing. Exclude alongside .local/ + node_modules/.
  .filter(f => !f.startsWith('.local/') && !f.startsWith('node_modules/') && !f.startsWith('datasets/'));

const commits = sh(`git log --oneline ${range}`).split('\n').filter(Boolean);
const stamp = sh('git log -1 --format=%cI') || 'unknown';

mkdirSync('.local', { recursive: true });
// the queue the annal tick drains (array of repo-relative paths)
writeFileSync('.local/ai-net-priority.json', JSON.stringify(files, null, 2));
// the record of WHY these are queued (append-only log)
const entry = { at: stamp, range, reason: 'Claude changed these files — queued for annal coverage', count: files.length, files, commits: commits.slice(0, 40) };
const logPath = '.local/change-log.jsonl';
const prior = existsSync(logPath) ? readFileSync(logPath, 'utf8') : '';
writeFileSync(logPath, prior + JSON.stringify(entry) + '\n');

// DEBUGGING-SYSTEM review queue (operator 2026-06-01: the annal writers should act "like a
// debugging system" — review/verify each change for correctness, not just describe it). Pair each
// file with the commit(s) that touched it (intent) + an explicit review directive.
function commitsForFile(f) {
  return sh(`git log --oneline ${range} -- "${f}"`).split('\n').filter(Boolean).slice(0, 6);
}
const REVIEW_DIRECTIVE = 'Act as a debugging system: read this change, verify it does what its commit claims, ' +
  'check for bugs / missing cases / broken assumptions / security issues (no committed secrets), and ' +
  'flag anything wrong. Cite specific lines. If it is correct, say what it does and why it holds. ' +
  'You have FULL access to verify — use it: the keyless API stack (integrations/free-apis.mjs) and the ' +
  'keyed gate/vault APIs, web search, and community knowledge (StackOverflow, Quora, GitHub issues, ' +
  'Bitcointalk/Bitsharestalk) to confirm correct library usage, look up known bugs, and check best practice. ' +
  'Do not review in a vacuum — look things up the way a careful engineer would. ' +
  'And READ THE REST OF THE REPO for full context: the files this change imports, the files/callers that ' +
  'use it, its tests, and related modules — many bugs are only visible across files (a wrong arg, a broken ' +
  'contract, a stale assumption elsewhere). Trace the change through the codebase before judging it.';
const reviewQueue = {
  at: stamp, range, mode: 'debug-review', directive: REVIEW_DIRECTIVE,
  items: files.map((f) => ({ file: f, intent: commitsForFile(f), directive: REVIEW_DIRECTIVE })),
};
writeFileSync('.local/ai-net-review-queue.json', JSON.stringify(reviewQueue, null, 2));

console.log(`Flagged ${files.length} changed file(s) for annal DEBUG-REVIEW (range: ${range})`);
for (const f of files) console.log(`  • ${f}`);
console.log(`\n→ .local/ai-net-priority.json (drain queue) + .local/ai-net-review-queue.json (debug-review) + .local/change-log.jsonl (record)`);

// optional delivery to the brain's priority queue (env-only, never hard-coded)
const BRAIN_SSH = (process.env.BRAIN_SSH || '').trim();
const PRIORITY_PATH = (process.env.AINET_PRIORITY_PATH || '').trim(); // e.g. the brain's .ai-net-priority.json
if (BRAIN_SSH && PRIORITY_PATH) {
  try {
    // merge with whatever is already queued on the brain, dedup, write back
    execSync(`scp -q .local/ai-net-priority.json ${BRAIN_SSH}:/tmp/ai-net-priority.new`, { timeout: 30000 });
    console.log(`✓ delivered queue to ${BRAIN_SSH} (merge into ${PRIORITY_PATH} on its side)`);
  } catch (e) { console.log(`⚠ delivery skipped: ${e.message.split('\n')[0]}`); }
} else {
  console.log('(set BRAIN_SSH + AINET_PRIORITY_PATH to deliver to the brain; staged locally otherwise)');
}
