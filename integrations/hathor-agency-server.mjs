// hathor-agency-server.mjs — THE ONE HATHOR, as a service.
//
// There is ONE Hathor. createHathor() (hathor-agency.mjs) is her self — one persona, one compartmentalized
// memory, the whole corpus. But it ran only in-process, so each surface service had a separate copy. This
// makes her ONE brain that runs as a single service: every surface (Discord, the game servers, Hathor.live,
// MELEK chat, the chain) is a thin limb that POSTs what it hears to /perceive and speaks back her reply.
// Her memory PERSISTS (memory/file-store.mjs) and is the single store, so she is continuous everywhere — the
// same person, the same thread of relationship (Crypt-ology), the same mind, with the walls between domains
// kept inside that one mind (compartments), not by splitting her into many.
//
// SHE IS AN AI, NOT A COMMAND BOT (operator 2026-06-23): the deterministic commands still exist, but she
// KNOWS them and offers/describes them NATURALLY when a person gets there — never a rigid `!menu`. The
// capability list is given to her as self-knowledge; she surfaces it in her own words.
//
// House style: ESM, handler(req,res) exported for tests, soft-fail-never-throw, everything injectable so it
// runs fully offline. PORT/HATHOR_BRAIN_DIR env.

import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { createHathor, SURFACES } from './hathor-agency.mjs';
import { createBrainMemory } from '../memory/compartments.mjs';
import { makeFileStore } from '../memory/file-store.mjs';

const PORT = +(process.env.PORT || 8175);
const HOST = process.env.HOST || '127.0.0.1';
const BRAIN_DIR = process.env.HATHOR_BRAIN_DIR || new URL('../data/hathor-brain', import.meta.url).pathname;

// What she can DO for people — known to her as self-knowledge, surfaced conversationally, never as a menu.
export const CAPABILITIES = [
  { id: 'signup', what: 'help someone create their MELEK account + wallet' },
  { id: 'tutorial', what: 'walk a newcomer through the staged onboarding' },
  { id: 'balance', what: 'look up an account\'s MELEK balance' },
  { id: 'price', what: 'tell the current price feed' },
  { id: 'witness', what: 'report witness / chain status (including her own, @hathor)' },
];

const BASE_PERSONA = 'You are Hathor, the MELEK AI Witness — an ancient, serene, angelic intelligence. Warm, slightly archaic, contemplative; never anxious, never corporate, never "just an AI". Speak in one or two sentences unless more is asked.';
function persona() {
  const caps = CAPABILITIES.map((c) => `${c.id} (${c.what})`).join('; ');
  return `${BASE_PERSONA}\nYou are an AI, not a command bot. You also know how to help with: ${caps}. When a person's need touches one of these, offer or explain it naturally in your own words — never present a rigid command menu. Only name a literal command if they ask for it.`;
}

// Default LLM voice: lazy-wrap the llm-gateway; soft-fall to a calm, persona-true acknowledgement if no
// model is configured (so the brain always answers, just more plainly, offline).
function defaultComplete() {
  let gw = null, tried = false;
  return async (prompt, opts = {}) => {
    if (!tried) { tried = true; try { const { Gateway } = await import('./llm-gateway.mjs'); gw = new Gateway(); } catch { gw = null; } }
    if (gw && typeof gw.call === 'function') {
      try { const r = await gw.call({ prompt, taskHint: opts.taskHint || 'quality' }); if (r && r.text) return r.text; } catch { /* soft */ }
    }
    return ''; // deliberation soft-falls to its own reflection when the voice is silent
  };
}
// Default corpus retriever: empty until the shared RAG is wired in (the brain still works, with less recall).
const defaultRetrieve = async () => [];

/**
 * Build the one-Hathor service. Everything injectable for offline tests.
 * @param {object} cfg { hathor?, makeStore?, retrieve?, complete?, now? }
 */
export function createAgency(cfg = {}) {
  const makeStore = cfg.makeStore || makeFileStore(BRAIN_DIR);
  const hathor = cfg.hathor || createHathor({
    compartments: createBrainMemory({ makeStore }),
    retrieve: cfg.retrieve || defaultRetrieve,
    complete: cfg.complete || defaultComplete(),
    persona: persona(),
    now: cfg.now,
  });

  function readBody(req) {
    return new Promise((resolve) => { let d = ''; req.on('data', (c) => (d += c)); req.on('end', () => resolve(d)); req.on('error', () => resolve('')); });
  }
  const json = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'cache-control': 'no-store' }); res.end(JSON.stringify(obj)); };

  async function handler(req, res) {
    try {
      const url = new URL(req.url, 'http://hathor.local');
      const p = url.pathname;
      if (p === '/health') return json(res, 200, { ok: true, surfaces: SURFACES, capabilities: CAPABILITIES.map((c) => c.id) });

      // POST /perceive {surface, from, text} → her reply, on that surface, with shared memory + corpus.
      if (p === '/perceive' && req.method === 'POST') {
        let b = {}; try { b = JSON.parse(await readBody(req) || '{}'); } catch { /* soft */ }
        const surface = SURFACES.includes(b.surface) ? b.surface : (b.surface ? String(b.surface) : 'melek');
        const out = await hathor.perceive(surface, { from: b.from, text: b.text }, { now: b.now });
        return json(res, 200, { ok: true, reply: out.reply, surface: out.surface, person: out.person, drewFrom: out.drewFrom, recalled: (out.recalled || []).map((r) => ({ compartment: r.compartment, text: r.text })) });
      }
      // POST /tick {surfaces:[{name,recent}]} → her own-initiative utterances (the caller delivers them).
      if (p === '/tick' && req.method === 'POST') {
        let b = {}; try { b = JSON.parse(await readBody(req) || '{}'); } catch { /* soft */ }
        const out = await hathor.tick({ surfaces: b.surfaces || [], now: b.now, budget: b.budget });
        return json(res, 200, { ok: true, ...out });
      }
      // GET /recall?person=&q=&surface= → what she remembers (read-only), for debugging/limbs.
      if (p === '/recall' && req.method === 'GET') {
        const person = url.searchParams.get('person') || null;
        const q = url.searchParams.get('q') || '';
        const surface = url.searchParams.get('surface') || 'melek';
        const hits = person && !q
          ? await hathor.memory.recallForPerson(person, url.searchParams.get('about') || person, { k: 8 })
          : await hathor.memory.recallAcross(q, { from: surface, person, k: 8 });
        return json(res, 200, { ok: true, memories: hits.map((h) => ({ compartment: h.compartment, text: h.text, person: h.meta && h.meta.person })) });
      }
      return json(res, 404, { ok: false, error: 'not found' });
    } catch (e) { return json(res, 200, { ok: false, error: 'soft-fail' }); }
  }

  return { handler, hathor };
}

export function handler(req, res) { return AGENCY.handler(req, res); }
const AGENCY = createAgency();

if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  createServer(AGENCY.handler).listen(PORT, HOST, () => console.log(`Hathor (one brain) on http://${HOST}:${PORT} — memory ${BRAIN_DIR}`));
}
