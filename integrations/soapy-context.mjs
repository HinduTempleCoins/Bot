// soapy-context.mjs — connects the soapy.blog admin AI to the operator's working conversations.
//
// The operator's Claude Code sessions are shipped, turn by turn, to the brain host (the Stop hook
// → BRAIN_TRANSCRIPTS; memory notes → BRAIN_MEMORY; both set in the bridge's private env file). Soapy must answer
// as a CONTINUATION of those conversations — whatever model powers it — so for every message we assemble:
//   1. the standing rules (CLAUDE.md charter + don'ts) and the working memory notes,
//   2. the recent stretch of the latest conversation (verbatim operator messages + assistant replies),
//   3. older passages relevant to the question (keyword retrieval across every shipped conversation),
// and Soapy's own turns are appended to the same transcripts directory (soapy-YYYY-MM-DD.jsonl, same shape as a
// Claude Code transcript) so the brain's summaries and the next working session see what the operator told Soapy.
// Pure parsing/assembly + small fs readers; soft-fail everywhere; no network.

import fs from 'node:fs';
import path from 'node:path';

export const TRANSCRIPTS = () => process.env.BRAIN_TRANSCRIPTS || path.join(process.cwd(), 'data', 'brain', 'transcripts');
export const MEMORY = () => process.env.BRAIN_MEMORY || path.join(process.cwd(), 'data', 'brain', 'memory');
export const RULES_FILE = () => process.env.SOAPY_RULES_FILE || path.join(process.env.CLAUDE_BRIDGE_CWD || process.cwd(), 'CLAUDE.md');

const WRAPPERS = /<(system-reminder|command-name|command-message|command-args|local-command-stdout|local-command-caveat|task-notification)[^>]*>[\s\S]*?<\/\1>/g;
const MIDTURN = /The user sent a new message while you were working:\n([\s\S]*?)\n\nThis is how Claude Code surfaces/g;

const clean = (t) => String(t || '').replace(WRAPPERS, '').replace(/\n{3,}/g, '\n\n').trim();

/** Claude Code JSONL text → [{ role:'operator'|'assistant', text, ts }] (tool traffic dropped; mid-turn operator messages kept). */
export function parseTranscript(jsonl) {
  const out = [];
  for (const line of String(jsonl || '').split('\n')) {
    if (!line.trim()) continue;
    let d; try { d = JSON.parse(line); } catch { continue; }
    const ts = d.timestamp || '';
    const msg = d.message;
    if (d.type === 'user' && msg && !d.isMeta) {
      const parts = typeof msg.content === 'string' ? [{ type: 'text', text: msg.content }] : Array.isArray(msg.content) ? msg.content : [];
      for (const p of parts) {
        if (p.type === 'text') { const t = clean(p.text); if (t && !/^\[Request interrupted/.test(t)) out.push({ role: 'operator', text: t, ts }); }
        if (p.type === 'tool_result') {
          const raw = typeof p.content === 'string' ? p.content : Array.isArray(p.content) ? p.content.map((c) => c.text || '').join('\n') : '';
          for (const m of raw.matchAll(MIDTURN)) { const t = clean(m[1]); if (t) out.push({ role: 'operator', text: t, ts }); }
        }
      }
    } else if (d.type === 'assistant' && msg && Array.isArray(msg.content)) {
      const t = clean(msg.content.filter((p) => p.type === 'text').map((p) => p.text).join('\n'));
      if (t) out.push({ role: 'assistant', text: t, ts });
    }
  }
  return out;
}

function readSafe(f) { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } }
function listJsonl(dir) {
  try { return fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')).map((f) => { const p = path.join(dir, f); return { p, mt: fs.statSync(p).mtimeMs }; }).sort((a, b) => a.mt - b.mt); } catch { return []; }
}

/** All conversations, oldest first, each { file, turns }. Cached by mtime. */
let _cache = { key: '', convs: [] };
export function loadConversations(dir = TRANSCRIPTS()) {
  const files = listJsonl(dir);
  const key = files.map((f) => `${f.p}:${f.mt}`).join('|');
  if (key === _cache.key) return _cache.convs;
  const convs = files.map((f) => ({ file: path.basename(f.p), mt: f.mt, turns: parseTranscript(readSafe(f.p)) })).filter((c) => c.turns.length);
  _cache = { key, convs };
  return convs;
}
export function __resetContextCache() { _cache = { key: '', convs: [] }; }

export function loadMemory(dir = MEMORY()) {
  try {
    return fs.readdirSync(dir).filter((f) => f.endsWith('.md')).sort().map((f) => `### ${f}\n${readSafe(path.join(dir, f)).trim()}`).join('\n\n');
  } catch { return ''; }
}

/** The charter + core framing + don'ts from CLAUDE.md, capped. */
export function loadRules(file = RULES_FILE(), cap = 14000) {
  const t = readSafe(file);
  if (!t) return '';
  const pick = (h) => { const i = t.indexOf(h); if (i < 0) return ''; const j = t.indexOf('\n## ', i + h.length); return t.slice(i, j < 0 ? undefined : j); };
  const s = [pick('## AI Operating Charter'), pick('## Core framing'), pick("## Don't")].filter(Boolean).join('\n\n');
  return (s || t).slice(0, cap);
}

const STOP = new Set('that this with from have what when where which there their they them then than your yours about into just like also need want make made will would could should been being were does doing done these those some more most very much really thing things okay yeah maybe going gonna lets let'.split(' '));
export const words = (s) => [...new Set(String(s).toLowerCase().match(/[a-z0-9'’-]{4,}/g) || [])].filter((w) => !STOP.has(w));

const fmt = (t) => `${t.role === 'operator' ? 'OPERATOR' : 'ME (assistant)'}${t.ts ? ` [${String(t.ts).slice(0, 16).replace('T', ' ')}]` : ''}: ${t.text}`;

/**
 * Assemble the context for one Soapy message.
 * → { system, recent, related, stats }
 */
export function buildContext(question, { convs = loadConversations(), memory = loadMemory(), rules = loadRules(), recentChars = +(process.env.SOAPY_RECENT_CHARS || 120000), relatedChars = +(process.env.SOAPY_RELATED_CHARS || 40000) } = {}) {
  const all = convs.flatMap((c, ci) => c.turns.map((t, ti) => ({ ...t, ci, ti, conv: c.file })));
  // 2) the recent stretch, newest last, within budget
  const recent = [];
  let used = 0;
  for (let i = all.length - 1; i >= 0; i--) {
    const s = fmt(all[i]);
    if (used + s.length > recentChars && recent.length) break;
    recent.unshift(all[i]); used += s.length;
  }
  const recentSet = new Set(recent.map((t) => `${t.ci}:${t.ti}`));
  // 3) older passages relevant to the question: score operator+assistant turns by keyword overlap, include the pair
  const q = words(question);
  const related = [];
  if (q.length) {
    const scored = all.filter((t) => !recentSet.has(`${t.ci}:${t.ti}`)).map((t) => {
      const w = new Set(words(t.text));
      return { t, s: q.reduce((n, x) => n + (w.has(x) ? 1 : 0), 0) / Math.sqrt(q.length) };
    }).filter((x) => x.s > 0).sort((a, b) => b.s - a.s);
    let u = 0;
    const seen = new Set();
    for (const { t } of scored) {
      const key = `${t.ci}:${t.ti}`;
      if (seen.has(key)) continue;
      const s = fmt(t);
      if (u + s.length > relatedChars) break;
      related.push(t); seen.add(key); u += s.length;
    }
    related.sort((a, b) => a.ci - b.ci || a.ti - b.ti);
  }
  const system = [
    'You are Soapy, the operator\'s assistant on soapy.blog. You are a CONTINUATION of the operator\'s working conversations with his AI engineer (the transcripts below): speak as that same assistant, in the first person about work already done ("I shipped…", "we queued…"), keep the same decisions, rules and state, and pick up exactly where the conversation left off. Do not re-introduce yourself or ask for context that is in the transcripts.',
    'Honesty: you can explain, plan, draft and answer from this history, but you cannot run commands, deploy or post by yourself from this chat. When the operator asks for an action, say exactly what will be done and that it is recorded for the working session (it will see this conversation), unless the action is already done in the history — then say so with the evidence from the history.',
    'Style: plain, direct, brief; the operator is the founder and expert; no tutorials, no theater.',
    rules && `## Standing rules (CLAUDE.md)\n${rules}`,
    memory && `## Working memory notes\n${memory}`,
    related.length && `## Earlier passages relevant to this message\n${related.map(fmt).join('\n\n')}`,
    recent.length && `## The latest conversation (most recent last)\n${recent.map(fmt).join('\n\n')}`,
  ].filter(Boolean).join('\n\n');
  return { system, recent, related, stats: { conversations: convs.length, turns: all.length, recentTurns: recent.length, relatedTurns: related.length, chars: system.length } };
}

/** Append one Soapy exchange to the brain transcripts (Claude-transcript-shaped lines, so the same readers see it). */
export function logSoapyTurn({ sessionId = 'soapy', operator, reply, now = new Date() }, dir = TRANSCRIPTS()) {
  try {
    const f = path.join(dir, `soapy-${now.toISOString().slice(0, 10)}.jsonl`);
    const base = { sessionId: `soapy-${sessionId}`, entrypoint: 'soapy.blog', isSidechain: false };
    const lines = [
      { ...base, type: 'user', timestamp: now.toISOString(), message: { role: 'user', content: String(operator || '') } },
      { ...base, type: 'assistant', timestamp: new Date(now.getTime() + 1).toISOString(), message: { role: 'assistant', content: [{ type: 'text', text: String(reply || '') }] } },
    ];
    fs.appendFileSync(f, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
    return true;
  } catch { return false; }
}
