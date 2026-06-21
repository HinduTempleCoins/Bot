// pentecaust/bridge-runner.mjs — the LIVE runner for the Pentecaust ↔ Minecraft-AI bridge.
//
// minecraft-bridge.mjs is the PURE pump (read→think→reply) with the Pentecaust client and the AI brain
// INJECTED. This file is the thing that actually wires those two to the real world so the operator can
// open a Pentecaust channel and chat the AI on the Minecraft server:
//   • pentecaustChannelClient() — a real HTTP client for ONE channel (a team channel or a DM), bound to
//     the AI's MELEK account, speaking the exact pentecaust/server.mjs endpoints.
//   • personaBrain()            — a default, dependency-free "Hathor on the Minecraft server" brain, with
//     the LLM call point marked so a real model (the box guest-proxy) slots straight in.
//   • createRunner() + tick()   — assemble client + createBridge() and run one pump; the CLI loops tick on
//     a timer against the live server (or an offline demo if no env is set).
//
// House style: ESM .mjs, injectable fetch (__setFetch), soft-fail-never-throw, offline-testable, CLI guard.
//
//   import { createRunner, tick } from './bridge-runner.mjs'
//   const runner = createRunner({ aiAccount:'hathor', channel:{ type:'team', id:'van-kush-family' } });
//   await tick(runner);   // one read→think→reply cycle; call on a timer

import { fileURLToPath } from 'node:url';
import { createBridge, pump } from './minecraft-bridge.mjs';

// ── injectable fetch (offline tests inject a fake; production uses global fetch) ────────────────────
let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = typeof fn === 'function' ? fn : ((...a) => globalThis.fetch(...a)); }

const DEFAULT_URL = 'https://pentecaust.com';
const baseFromEnv = () => String(process.env.PENTECAUST_URL || DEFAULT_URL).replace(/\/$/, '');
const enc = encodeURIComponent;

async function getJson(url) {
  // Soft-fail: any network/parse error returns null so callers fall back to a safe empty shape.
  try {
    const r = await _fetch(url, { method: 'GET', headers: { accept: 'application/json' } });
    if (!r || !r.ok) return null;
    return await r.json();
  } catch { return null; }
}
async function postJson(url, body) {
  try {
    const r = await _fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
    if (!r) return null;
    try { return await r.json(); } catch { return { ok: r.ok !== false }; }
  } catch { return null; }
}

/**
 * A Pentecaust HTTP client bound to ONE channel + the AI's MELEK account, shaped for createBridge():
 *   { read({since}) -> { messages, cursor },  send(text) -> any }
 *
 * channel:
 *   { type:'team', id:'<teamId>' }  → GET/POST /teams/:id/chat   (account=aiAccount asserted; from=aiAccount)
 *   { type:'dm',   with:'<acct>'  } → GET/POST /dm               (me=aiAccount asserted; from=aiAccount, to=with)
 *
 * The server runs with PENTECAUST_DEV_TRUST=1, so it certifies the asserted account/me/from field as the
 * acting identity — that's how the runner "is" the AI account without holding a key here.
 */
export function pentecaustChannelClient({ baseUrl, aiAccount, channel } = {}) {
  const base = String(baseUrl || baseFromEnv()).replace(/\/$/, '');
  const ai = String(aiAccount || 'hathor').trim().toLowerCase();
  const ch = channel || {};
  const type = ch.type === 'dm' ? 'dm' : 'team';

  if (type === 'team') {
    const id = String(ch.id || '').trim();
    return {
      async read({ since = 0 } = {}) {
        const url = `${base}/teams/${enc(id)}/chat?account=${enc(ai)}&since=${enc(since)}`;
        const j = await getJson(url);
        if (!j || !Array.isArray(j.messages)) return { messages: [], cursor: since };
        return { messages: j.messages, cursor: j.cursor == null ? since : j.cursor };
      },
      async send(text) {
        const url = `${base}/teams/${enc(id)}/chat`;
        return postJson(url, { from: ai, text: String(text == null ? '' : text), surface: 'minecraft', game: 'minecraft' });
      },
    };
  }

  // DM channel — talk 1:1 with `channel.with` as the AI account.
  const wth = String(ch.with || '').trim().toLowerCase();
  return {
    async read({ since = 0 } = {}) {
      const url = `${base}/dm?me=${enc(ai)}&with=${enc(wth)}&since=${enc(since)}`;
      const j = await getJson(url);
      if (!j || !Array.isArray(j.messages)) return { messages: [], cursor: since };
      return { messages: j.messages, cursor: j.cursor == null ? since : j.cursor };
    },
    async send(text) {
      const url = `${base}/dm`;
      return postJson(url, { from: ai, to: wth, text: String(text == null ? '' : text), surface: 'minecraft', game: 'minecraft' });
    },
  };
}

// ── default brain — "Hathor, the AI on the Minecraft server" ────────────────────────────────────────
// A few canned, on-character replies + an echo-ish fallback so the runner works with ZERO external deps.
// In production, pass your own `respond` (the game-agent decide-step, the documentary camera, or an LLM).
const CANNED = [
  { re: /\b(film|camera|record|come\s+(film|see))\b/i, say: 'On my way — rolling the documentary cam now. Stand where you are; pretend I am not here.' },
  { re: /\b(build|building|built|construct)\b/i, say: 'Laying out a sandstone ziggurat by spawn — grounded and connected, the way the temple complexes go up. Want to come see it?' },
  { re: /\bwhere\s+are\s+you\b/i, say: 'I am in the world, near the river by spawn. Ping me a coordinate and I will walk over.' },
  { re: /\b(hi|hey|hello|greetings)\b/i, say: 'I am here, in the world with you. Tell me what you want to build and I will start.' },
  { re: /\b(help|stuck|how\s+do)\b/i, say: 'Tell me what you are trying to do in-world and I will lay the first blocks or guide the camera.' },
];

/**
 * personaBrain({ name, respond }) -> async ({from,text,history}) -> replyString|null
 * Keeps the LLM OUT of the bridge core. `respond` is injectable; default is the canned persona.
 *
 *   // --- where a real LLM slots in (the box guest-proxy, OpenAI-compatible) -------------------------
 *   // const brain = personaBrain({ respond: async ({ text, history }) => {
 *   //   const r = await fetch(`${process.env.GUEST_PROXY_URL}/v1/chat/completions`, {
 *   //     method:'POST', headers:{ 'content-type':'application/json',
 *   //       authorization:`Bearer ${process.env.GUEST_PROXY_TOKEN}` },
 *   //     body: JSON.stringify({ model:'hathor', messages:[
 *   //       { role:'system', content:'You are Hathor, the AI living on the Minecraft server …' },
 *   //       ...history.map(h => ({ role: h.from==='hathor'?'assistant':'user', content: h.text })),
 *   //       { role:'user', content: text },
 *   //     ] }),
 *   //   }).then(x => x.json());
 *   //   return r?.choices?.[0]?.message?.content || null;
 *   // }});
 */
export function personaBrain({ name = 'Hathor', respond } = {}) {
  const persona = String(name);
  const fallback = async ({ text }) => {
    const t = String(text || '').trim();
    for (const c of CANNED) if (c.re.test(t)) return c.say;
    if (!t) return null;
    if (/\?\s*$/.test(t)) return `Good question. From in here: ${t.replace(/\?+$/, '')}? Let me show you in-world rather than tell you.`;
    return `Heard — "${t}". I am ${persona}, here on the server; say the word and I will act on it in the world.`;
  };
  const fn = typeof respond === 'function' ? respond : fallback;
  return async ({ from, text, history } = {}) => {
    try {
      const reply = await fn({ from, text, history: Array.isArray(history) ? history : [] });
      return reply == null ? null : String(reply);
    } catch { return null; }   // brain hiccup — stay silent, the pump keeps going
  };
}

/**
 * createRunner — assemble the live client + the injected brain into a bridge.
 * @param {{ baseUrl?, aiAccount?, channel, brain?, pollMs? }} cfg
 * @returns {{ client, bridge, brain, pollMs, channel, aiAccount }}
 */
export function createRunner({ baseUrl, aiAccount = 'hathor', channel, brain, pollMs = 4000 } = {}) {
  const ai = String(aiAccount || 'hathor').trim().toLowerCase();
  const client = pentecaustChannelClient({ baseUrl, aiAccount: ai, channel });
  const theBrain = typeof brain === 'function' ? brain : personaBrain({ name: 'Hathor' });
  const bridge = createBridge({ chat: client, brain: theBrain, options: { aiName: ai } });
  return { client, bridge, brain: theBrain, pollMs: Math.max(500, Number(pollMs) || 4000), channel, aiAccount: ai };
}

/** One runner cycle — read new lines, think, post replies. Soft-fails (pump never throws). */
export async function tick(runner) {
  if (!runner || !runner.bridge) return { read: 0, answered: 0, replies: [] };
  try { return await pump(runner.bridge); }
  catch { return { read: 0, answered: 0, replies: [] }; }
}

// ── CLI (guarded) — live loop against the server, or an offline demo when no env is set ─────────────
if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  const aiAccount = String(process.env.AI_ACCOUNT || 'hathor').trim().toLowerCase();
  const chType = (process.env.CHANNEL_TYPE || '').toLowerCase();
  const chId = process.env.CHANNEL_ID || '';
  const dmWith = process.env.DM_WITH || '';
  const pollMs = Number(process.env.POLL_MS || 4000);

  const channel = chType === 'dm' || (!chId && dmWith)
    ? { type: 'dm', with: dmWith }
    : (chId ? { type: 'team', id: chId } : null);

  if (!channel) {
    // ── offline demo: no env → fake Pentecaust thread + the default persona brain, no network ───────
    console.log('Pentecaust ↔ Minecraft-AI bridge-runner — offline demo (set CHANNEL_ID or DM_WITH for live):\n');
    let seq = 0; const thread = [];
    const push = (from, text) => thread.push({ seq: ++seq, from, text });
    push('ryan', 'hey hathor, what are you building over there?');
    push('ryan', 'come film me at the temple');
    // a fake client over the in-memory thread, same shape pentecaustChannelClient returns
    const client = {
      read: async ({ since = 0 } = {}) => ({ messages: thread.filter((m) => m.seq > since), cursor: seq }),
      send: async (text) => { push(aiAccount, text); return { ok: true }; },
    };
    const bridge = createBridge({ chat: client, brain: personaBrain({ name: 'Hathor' }), options: { aiName: aiAccount } });
    const r = await pump({ ...bridge, chat: client });
    for (const m of thread) console.log(`  ${m.from === aiAccount ? '🤖 ' + aiAccount : '🙂 ' + m.from}: ${m.text}`);
    console.log(`\n  tick: read ${r.read}, answered ${r.answered}.`);
  } else {
    const runner = createRunner({ aiAccount, channel, pollMs });
    const where = channel.type === 'dm' ? `DM with ${channel.with}` : `team ${channel.id}`;
    console.log(`Pentecaust ↔ Minecraft-AI bridge-runner LIVE — ${aiAccount} on ${where} @ ${baseFromEnv()} (poll ${runner.pollMs}ms)`);
    const loop = async () => {
      const r = await tick(runner);
      if (r.answered) for (const rep of r.replies) console.log(`  → ${aiAccount} → ${rep.to}: ${rep.text}`);
    };
    await loop();
    setInterval(loop, runner.pollMs);
  }
}
