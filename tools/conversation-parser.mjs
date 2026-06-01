// conversation-parser.mjs — turn a raw conversation into a MoM (Minutes of Meeting) the brief
// writer consumes, PRESERVING THE OPERATOR'S OWN WORDS. Operator 2026-06-01: his words make the
// briefs coherent — so this does NOT paraphrase. It extracts the operator's actual decision/ask
// sentences verbatim and files them under Decisions / Action items, the format brief-builder reads.
//
//   node tools/conversation-parser.mjs <file.md> [outDir]   # writes <name>.mom.md
//   cat convo.md | node tools/conversation-parser.mjs -      # stdin -> stdout
//   import { parseConversation, toMoM } from './conversation-parser.mjs'

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { basename, join } from 'node:path';

// signal phrases that mark an operator decision or directive (kept verbatim, not summarised).
const DECISION = /\b(we (?:need|want|should|have to|are going to)|let'?s|i (?:want|need|decided|think)|the plan is|priority|going forward|from now on|decided)\b/i;
const ACTION = /\b(make sure|go ahead and|don'?t|do not|never|always|build|add|set up|wire|fix|deploy|create|get .* (?:up|done|set up)|put .* in|use the)\b/i;
const NOISE = /^(ok|okay|thanks|thank you|yes|no|cool|nice|great|lol|haha)\b[.! ]*$/i;

// split into utterances. Claude exports / curated md vary; we handle: explicit "Human:/Assistant:"
// or "**You**/**Claude**" markers, else treat every paragraph as a candidate (speaker unknown).
function utterances(text) {
  const lines = text.split(/\r?\n/);
  const turns = [];
  let speaker = null, buf = [];
  const flush = () => { if (buf.length) { turns.push({ speaker, text: buf.join(' ').trim() }); buf = []; } };
  for (const ln of lines) {
    const m = ln.match(/^\s*(?:\*\*)?(human|you|operator|user|ryan|assistant|claude|ai)(?:\*\*)?\s*[:\)]/i);
    if (m) { flush(); const s = m[1].toLowerCase(); speaker = /assistant|claude|ai/.test(s) ? 'assistant' : 'operator'; buf.push(ln.replace(/^\s*(?:\*\*)?\w+(?:\*\*)?\s*[:\)]\s*/i, '')); }
    else buf.push(ln);
  }
  flush();
  return turns;
}

// sentence split that keeps the operator's phrasing intact.
function sentences(s) { return s.split(/(?<=[.!?])\s+|\n+/).map((x) => x.trim()).filter(Boolean); }

/**
 * Extract the operator's decisions + action items, VERBATIM. If speakers are marked we use only
 * operator turns; if not, we scan everything (the signal phrases are operator-shaped anyway).
 * Returns { decisions:[], actions:[], speakersKnown }.
 */
export function parseConversation(text) {
  const turns = utterances(text);
  const speakersKnown = turns.some((t) => t.speaker);
  const pool = speakersKnown ? turns.filter((t) => t.speaker === 'operator') : turns;
  const decisions = new Set(), actions = new Set();
  for (const t of pool) {
    for (const sent of sentences(t.text)) {
      if (sent.length < 8 || sent.length > 320 || NOISE.test(sent)) continue;
      if (ACTION.test(sent)) actions.add(sent);
      else if (DECISION.test(sent)) decisions.add(sent);
    }
  }
  return { decisions: [...decisions], actions: [...actions], speakersKnown };
}

/** Render the MoM in the format brief-builder reads (## Decisions / ## Action items). */
export function toMoM(parsed, { title = 'Conversation', at = '' } = {}) {
  const L = [`# MoM — ${title}`, at ? `_${at}_` : '', ''];
  L.push('## Decisions', ...(parsed.decisions.length ? parsed.decisions.map((d) => `- ${d}`) : ['- (none extracted)']), '');
  L.push('## Action items', ...(parsed.actions.length ? parsed.actions.map((a) => `- [ ] ${a}`) : ['- (none extracted)']), '');
  if (!parsed.speakersKnown) L.push('', '> Speakers were not marked; extracted from operator-signal phrases across the whole text.');
  return L.filter((x) => x !== undefined).join('\n');
}

if (process.argv[1] && process.argv[1].endsWith('conversation-parser.mjs')) {
  const arg = process.argv[2];
  if (!arg) { console.error('usage: conversation-parser.mjs <file.md|-> [outDir]'); process.exit(1); }
  const text = arg === '-' ? readFileSync(0, 'utf8') : readFileSync(arg, 'utf8');
  const parsed = parseConversation(text);
  const title = arg === '-' ? 'stdin' : basename(arg).replace(/\.[^.]+$/, '');
  const mom = toMoM(parsed, { title });
  if (arg === '-' || !process.argv[3]) { console.log(mom); }
  else { mkdirSync(process.argv[3], { recursive: true }); const out = join(process.argv[3], `${title}.mom.md`); writeFileSync(out, mom); console.log(`wrote ${out} — ${parsed.decisions.length} decisions, ${parsed.actions.length} action items`); }
}
