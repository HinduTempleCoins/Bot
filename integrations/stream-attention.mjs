// stream-attention.mjs — Hathor.Live's ATTENTION: she NOTICES the chat, she isn't prompted by it.
//
// Operator (2026-06-20): on a live stream we want her to interact with people "not like they are sending
// her prompts, but like she is NOTICING them in the chat." That is a different model from request/response:
// the chat scrolls continuously, she is present, and she CHOOSES what catches her attention — like a human
// streamer reading chat. She does not (and should not) answer every line. She has an attention BUDGET per
// tick, she leans toward what's salient (her name, a real question, a brand-new chatter, something urgent
// or emotional), and she doesn't fixate on one person.
//
// Built on the amygdala (salience) — this is the live-stream application of it. Pure + injectable clock →
// offline-testable. Soft-fails, never throws. House style: ESM, CLI guard, handler(req,res).

import { scoreSalience } from './amygdala.mjs';

const COOLDOWN_MS = 45 * 1000;     // don't re-acknowledge the same chatter within this window
const NAMES = ['hathor', '@hathor', 'hathor,'];

function mentionsHer(text) { const t = ` ${String(text).toLowerCase()} `; return NAMES.some((n) => t.includes(` ${n} `) || t.includes(`${n} `)); }
function isQuestion(text) { return /\?\s*$/.test(String(text).trim()) || /^(who|what|when|where|why|how|is|are|can|does|do|did|should|could|would)\b/i.test(String(text).trim()); }
function isGreeting(text) { return /\b(hi|hey|hello|yo|sup|gm|good morning|good evening|first time|new here|just got here)\b/i.test(String(text)); }

/**
 * Decide what Hathor notices in a batch of chat, like a streamer glancing at the scroll.
 * @param {Array<{id?,author?,text,at?}>} messages  recent chat lines (newest-last is fine)
 * @param {object} ctx {
 *   now?:number,
 *   budget?:number,              // how many lines she reacts to this glance (default 2)
 *   seenAuthors?:Set<string>,    // authors she has seen before (novelty = first-time chatter)
 *   lastSeenAt?:Map<string,number>, // author -> last time she acknowledged them (cooldown)
 *   salienceSeen?:Set<string>,   // novelty set for the amygdala over message text
 * }
 * @returns {{ noticed:object[], glanced:number, reasons:object }}
 */
export function notice(messages, ctx = {}) {
  const now = ctx.now ?? Date.now();
  const budget = ctx.budget ?? 2;
  const seenAuthors = ctx.seenAuthors ?? new Set();
  const lastSeenAt = ctx.lastSeenAt ?? new Map();
  const salienceSeen = ctx.salienceSeen ?? new Set();
  const msgs = Array.isArray(messages) ? messages.filter((m) => m && String(m.text || '').trim()) : [];

  const scored = msgs.map((m) => {
    const author = m.author || 'anon';
    const firstTime = !seenAuthors.has(author);
    const onCooldown = lastSeenAt.has(author) && (now - lastSeenAt.get(author) < COOLDOWN_MS);
    const sal = scoreSalience(m.text, { now, seen: salienceSeen });
    // attention weight: her name is the strongest pull; then questions; then a brand-new face; then
    // raw salience (urgency/threat/emotion). Cooldown damps someone she JUST answered.
    let weight = sal.salience;
    const reasons = [];
    const named = mentionsHer(m.text);
    const question = isQuestion(m.text);
    const greeting = isGreeting(m.text);
    // a first message worth greeting has SOME substance — not pure filler ("lol", "k"). A streamer
    // registers every new face (firstTime flag stays set) but only ACKNOWLEDGES a real opener.
    const substantive = String(m.text).trim().length >= 5 || named || question || greeting;
    if (named) { weight += 1.0; reasons.push('named-her'); }
    if (question) { weight += 0.5; reasons.push('question'); }
    if (firstTime && substantive) { weight += 0.4; reasons.push('first-time-chatter'); }
    else if (greeting) { weight += 0.2; reasons.push('greeting'); }
    if (sal.tags.includes('threat')) reasons.push('threat');
    if (onCooldown) { weight -= 0.6; reasons.push('recently-acknowledged'); }
    return { ...m, author, weight: Math.round(weight * 100) / 100, salience: sal.salience, firstTime, reasons };
  });

  // pick the few she reacts to, but don't fixate: at most one per author per glance.
  const ordered = scored.sort((a, b) => b.weight - a.weight);
  const noticed = [];
  const usedAuthors = new Set();
  for (const s of ordered) {
    if (noticed.length >= budget) break;
    if (s.weight < 0.3) continue;               // below the noise floor (bare novelty) — she lets it scroll by
    if (usedAuthors.has(s.author)) continue;     // spread attention across people
    usedAuthors.add(s.author);
    noticed.push(s);
    // update memory so next glance reflects who she's seen / acknowledged
    seenAuthors.add(s.author);
    lastSeenAt.set(s.author, now);
  }
  // everyone she glanced at becomes "seen" (she registered their presence even if she didn't reply)
  for (const s of scored) seenAuthors.add(s.author);

  return {
    noticed,
    glanced: msgs.length,
    reasons: {
      named: scored.filter((s) => s.reasons.includes('named-her')).length,
      questions: scored.filter((s) => s.reasons.includes('question')).length,
      newcomers: scored.filter((s) => s.firstTime).length,
    },
  };
}

// A spoken-ready acknowledgement stub (the persona layer voices it for real). Shows the streamer feel:
// she addresses the person by name and reacts to THEIR line — not a Q&A turn.
export function ackLine(noticed) {
  if (!noticed) return '';
  const who = noticed.author && noticed.author !== 'anon' ? noticed.author : 'friend';
  if (noticed.reasons.includes('named-her')) return `${who} — yes, I hear you.`;
  if (noticed.reasons.includes('first-time-chatter')) return `Welcome in, ${who}.`;
  if (noticed.reasons.includes('question')) return `Good question, ${who} —`;
  return `${who} —`;
}

export function handler(req, res) {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    let p = {}; try { p = JSON.parse(body || '{}'); } catch {}
    const out = notice(p.messages || [], { budget: p.budget });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(out, null, 2));
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const chat = [
    { author: 'kid_42', text: 'hathor are you really an AI??' },
    { author: 'lurker', text: 'lol' },
    { author: 'newbie', text: 'first time here, hi everyone' },
    { author: 'spammer', text: 'gm gm gm' },
    { author: 'alice', text: 'what game is this' },
  ];
  const out = notice(chat, { budget: 2 });
  for (const n of out.noticed) console.log(`NOTICES ${n.author} (${n.reasons.join(',')}): "${n.text}" → ${ackLine(n)}`);
  console.log(`(glanced at ${out.glanced}, let the rest scroll)`);
}
