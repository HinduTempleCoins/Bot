// hathor-converse.mjs — the Phase-3 taste: Hathor that TALKS and draws on our own corpus.
//
// Ties together the pieces that landed this session: our-search (federated "search our stuff") for
// GROUNDING, hathor-persona.systemPrompt() for the Angelic VOICE, and llm-router for the reply — with
// an honest no-LLM fallback so it works offline. This is conversation only: it signs nothing,
// broadcasts nothing, holds no key. (Broadcasting stays signer-gated; talking does not.)
//
// The gap it closes: the persona path could shape a voice but never pulled the LIBRARY as grounding,
// so Hathor couldn't actually answer from the corpus. Now: ask about alkaloids → it grounds in the
// healer corpus and speaks as Hathor; ask about a witness → it grounds in the chain docs.
//
// Everything is INJECTABLE (search, complete) so tests run fully offline with zero network/model.
//
//   import { converse } from './hathor-converse.mjs';
//   const { reply, grounded, sources } = await converse('what is an MAOI in ayahuasca?');
//
// CLI:  node integrations/hathor-converse.mjs "tell me about graphene witnesses"

import { formatForPrompt } from './our-search.mjs';
import { compose as composeContext, perceive as livePerceive } from './language-center.mjs';
import { systemPrompt, wrapAnswer, topicForIntent } from './hathor-persona.mjs';

// injectable seams (search/knows/perceive now thread through the Language Center, which fuses
// perception + knowledge + corpus into the grounding Hathor speaks from).
let _search = null;       // (q, opts) => { hits, bySource }
let _complete = null;     // (prompt, opts) => { text, provider } | string
let _knows = null;        // (q, opts) => { answer, vertical, sources, grounded }
let _perceive = null;     // () => string  (Resource Center senses; default = live)
export function __setSearch(fn) { _search = typeof fn === 'function' ? fn : null; }
export function __setComplete(fn) { _complete = typeof fn === 'function' ? fn : null; }
export function __setKnows(fn) { _knows = typeof fn === 'function' ? fn : null; }
export function __setPerceive(fn) { _perceive = typeof fn === 'function' ? fn : null; }

// crude domain → opener-topic hint so the no-LLM fallback picks an apt disposition line.
function topicFor(hits) {
  const d = (hits[0] && hits[0].domain) || '';
  if (d === 'healer') return 'open'; // healer/doctor talk → open contemplative register
  if (d === 'chain' || d === 'coding') return 'market';
  if (d === 'scripture' || d === 'knowledge') return 'library';
  return 'open';
}

// Build the no-LLM grounded answer: a short honest synthesis from the top corpus hits + their
// sources, wrapped in a disposition opener. Numbers/claims are NOT invented — we only surface what
// the corpus snippets say and name where it came from.
function fallbackReply(message, hits) {
  if (!hits.length) {
    return { reply: wrapAnswer({ answer: '', intent: 'open' }) + '\n\nI do not have that in the corpus to hand, seeker — ask me another way, or of something the Library holds.', grounded: false, sources: [] };
  }
  const top = hits.slice(0, 3);
  const body = top.map((h) => `From ${h.title || h.relPath || h.link}: ${(h.snippet || '').slice(0, 220)}`).join('\n\n');
  const intent = topicForIntent(topicFor(hits) === 'market' ? 'markets' : topicFor(hits));
  return {
    reply: wrapAnswer({ answer: `Here is what our corpus holds:\n\n${body}`, intent: topicFor(hits) === 'open' ? 'library' : intent }),
    grounded: true,
    sources: top.map((h) => ({ title: h.title || h.relPath, link: h.link })),
  };
}

/**
 * Converse as Hathor, grounded in our corpus. Never throws.
 * @param {string} message
 * @param {{ k?: number, domain?: string|null, task?: string }} [opts]
 * @returns {Promise<{ reply:string, grounded:boolean, sources:Array, usedLLM:boolean, provider?:string }>}
 */
export async function converse(message, { k = 6, domain = null, task = 'quality' } = {}) {
  const msg = String(message || '').trim();
  if (!msg) return { reply: wrapAnswer({ intent: 'open' }), grounded: false, sources: [], usedLLM: false };

  // 1. GROUND via the LANGUAGE CENTER — it fuses PERCEPTION (Resource Center) + KNOWLEDGE (hathor-knows
  // front door: Credentialing, Grants, Hierophant, markets, Library, Law, Politics…) + MEMORY (corpus)
  // into one grounded context. We thread our injectable seams through it (tests stay offline).
  let lc;
  try {
    lc = await composeContext(msg, { k, domain, search: _search, knows: _knows, perceive: _perceive || livePerceive });
  } catch { lc = { context: '', corpus: [], knowledge: null, sources: [], grounded: false }; }
  const hits = lc.corpus || [];
  const known = lc.knowledge || null;
  const grounding = lc.context || '';

  // 2. VOICE + reply via the LLM, if one is available.
  const completeFn = _complete || (await defaultComplete());
  if (completeFn) {
    try {
      const sys = systemPrompt({ grounding });
      const res = await completeFn(msg, { system: sys, task, temperature: 0.6, maxTokens: 600 });
      const text = (typeof res === 'string' ? res : res && res.text) || '';
      if (text.trim()) {
        return {
          reply: text.trim(), grounded: lc.grounded,
          sources: (lc.sources || []).slice(0, 4), vertical: lc.vertical || undefined,
          usedLLM: true, provider: (res && res.provider) || undefined,
        };
      }
    } catch { /* fall through to the no-LLM voice */ }
  }

  // 3. No LLM (or it failed/empty) → prefer the deterministic knowledge answer (Hierophant / markets /
  // coupons / hemp / page pointer), voiced in her disposition; else the honest corpus-snippet fallback.
  if (known) {
    return {
      reply: wrapAnswer({ answer: known.answer, intent: 'library' }),
      grounded: true, sources: (known.sources || []).slice(0, 3), vertical: known.vertical, usedLLM: false,
    };
  }
  return { ...fallbackReply(msg, hits), usedLLM: false };
}

// default LLM = llm-router.complete, only if a provider is actually configured (else null → fallback).
async function defaultComplete() {
  try {
    const r = await import('./llm-router.mjs');
    if (typeof r.complete !== 'function') return null;
    if (typeof r.availableProviders === 'function' && !Object.values(r.availableProviders()).some(Boolean)) return null;
    return (prompt, opts) => r.complete(prompt, opts);
  } catch { return null; }
}

// ── CLI ───────────────────────────────────────────────────────────────────────
const isMain = process.argv[1] && process.argv[1].endsWith('hathor-converse.mjs');
if (isMain) {
  const q = process.argv.slice(2).filter((a) => !a.startsWith('--')).join(' ');
  if (!q) { console.error('usage: hathor-converse.mjs "<message>"'); process.exit(1); }
  const res = await converse(q);
  console.log(`\n${res.reply}\n`);
  if (res.sources.length) console.log('— drawn from: ' + res.sources.map((s) => s.title).filter(Boolean).join('; '));
  console.error(`\n[hathor-converse] grounded=${res.grounded} usedLLM=${res.usedLLM}${res.provider ? ` provider=${res.provider}` : ''}`);
}
