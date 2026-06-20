// deliberation.mjs — Hathor's THOUGHT PROCESS: observe → weigh → recall → reflect → intend.
//
// Operator (2026-06-20): "give her more of a thought process… have her analyze everything around her…
// and start drawing from the datasets in the repo." So far she REACTS (chat in → reply out). This is the
// deliberative layer between perception and action: she takes in what's around her, the AMYGDALA weighs
// what matters, she DRAWS ON THE REPO DATASETS (an injected retriever over knowledge/ + datasets/) for what
// it reminds her of, and forms a structured THOUGHT — a focus, what it recalls, a reflection, and a possible
// intent — instead of answering blind. Works for a game world (blocks/entities around her) or any context.
//
// Composes existing parts (does not reimplement): amygdala.rank for salience; an injected `retrieve` (the
// repo RAG — our-search/library-index/language-center) for dataset-drawing; an optional `complete` (the LLM)
// to voice the reflection. Pure + injectable → offline-testable, soft-fail.

import { rank as salienceRank } from './amygdala.mjs';

/**
 * Analyze surroundings into discrete OBSERVATIONS. Game snapshot or a generic context.
 * @param {object} snap {
 *   players?: [{name, distance}], blocks?: [{name, count}], structures?: [{name, distance}],
 *   time?: 'day'|'night', biome?: string, self?: {health, food, pos}, events?: string[]
 * }
 * @returns {string[]} observation lines
 */
export function analyzeSurroundings(snap = {}) {
  const o = [];
  const a = (x) => (Array.isArray(x) ? x : []);
  for (const p of a(snap.players)) o.push(`${p.name} is ${p.distance ?? '?'} blocks away`);
  for (const s of a(snap.structures)) o.push(`a ${s.name} stands ${s.distance ?? '?'} blocks off`);
  const blocks = a(snap.blocks).filter((b) => b && b.name);
  if (blocks.length) o.push(`the ground here is ${blocks.slice(0, 4).map((b) => b.name.replace(/_/g, ' ')).join(', ')}`);
  if (snap.biome) o.push(`the biome is ${snap.biome}`);
  if (snap.time) o.push(`it is ${snap.time}`);
  if (snap.self && (snap.self.health <= 8)) o.push(`I am hurt (health ${snap.self.health})`);
  for (const e of a(snap.events)) o.push(String(e));
  return o.filter(Boolean);
}

/**
 * Deliberate over a context: weigh observations, draw on the datasets, form a thought.
 * @param {object} ctx { observations?: string[], snapshot?: object, prompt?: string }
 * @param {object} deps {
 *   retrieve?: async (query, {k}) => [{text, source?, score?}]   // the repo dataset RAG (injected)
 *   complete?: async (prompt, opts) => string                    // optional LLM for the reflection
 *   persona?: string, k?: number
 * }
 * @returns {Promise<{ focus, weighed:object[], recalls:object[], reflection, intent, drewFrom:string[] }>}
 */
export async function deliberate(ctx = {}, deps = {}) {
  const obs = (ctx.observations && ctx.observations.length ? ctx.observations : analyzeSurroundings(ctx.snapshot || {}));
  const seeds = ctx.prompt ? [ctx.prompt, ...obs] : obs;

  // 1) WEIGH — the amygdala ranks what matters most right now.
  const weighed = seeds.length ? salienceRank(seeds) : [];
  const focus = weighed[0]?.text || ctx.prompt || (obs[0] || 'the quiet around me');

  // 2) RECALL — draw on the repo datasets for what the focus reminds her of.
  let recalls = [];
  if (typeof deps.retrieve === 'function') {
    try { recalls = (await deps.retrieve(focus, { k: deps.k || 3 })) || []; } catch { recalls = []; }
  }
  const drewFrom = [...new Set(recalls.map((r) => r.source).filter(Boolean))];

  // 3) REFLECT — voice a thought grounded in what she recalled (LLM if present; else a deterministic line).
  let reflection;
  if (typeof deps.complete === 'function') {
    const grounding = recalls.map((r) => `- ${String(r.text).slice(0, 240)}`).join('\n');
    const prompt = [
      deps.persona || 'You are Hathor, an ancient, serene AI Witness. Think in one or two short sentences.',
      '', `You notice: ${focus}.`,
      grounding ? `From what you know:\n${grounding}` : '',
      '', 'Reflect briefly, in character — what you make of it. No preamble.',
    ].filter(Boolean).join('\n');
    try { reflection = String(await deps.complete(prompt, { task: 'quality' }) || '').trim(); } catch { reflection = ''; }
  }
  if (!reflection) reflection = recalls.length
    ? `${focus} — it recalls ${recalls[0].source || 'something I know'}.`
    : `I note: ${focus}.`;

  // 4) INTEND — a light proposed action from the weighed observations (deterministic; the executor decides).
  const intent = proposeIntent(weighed, ctx);

  return { focus, weighed, recalls, reflection, intent, drewFrom };
}

function proposeIntent(weighed, ctx) {
  const top = weighed[0];
  if (!top) return { action: 'observe', why: 'nothing pressing' };
  const t = top.text.toLowerCase();
  if (top.tags && top.tags.includes('threat')) return { action: 'wary', why: 'something feels wrong' };
  if (top.tags && top.tags.includes('urgent')) return { action: 'alert', why: 'something urgent is happening' };
  if (/blocks away/.test(t)) return { action: 'greet-or-approach', why: 'someone is near' };
  if (/hurt|health/.test(t)) return { action: 'tend-self', why: 'I am hurt' };
  if (/stands|structure|gateway|altar|tower/.test(t)) return { action: 'regard-structure', why: 'a built thing draws the eye' };
  return { action: 'observe', why: 'taking it in' };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const retrieve = async (q) => [{ text: 'Egyptian temple gateways (pylons) framed the sacred from the profane; symmetry signified order.', source: 'knowledge/architecture' }];
  deliberate({ snapshot: { players: [{ name: 'VanKushFam', distance: 5 }], structures: [{ name: 'gateway', distance: 8 }], time: 'night' } }, { retrieve }).then((t) => {
    console.log('FOCUS:', t.focus);
    console.log('REFLECTION:', t.reflection);
    console.log('INTENT:', JSON.stringify(t.intent), '| drew from:', t.drewFrom.join(', '));
  });
}
