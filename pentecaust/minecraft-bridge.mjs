// pentecaust/minecraft-bridge.mjs — the point of all this: a chat you can use to talk to the AI on the
// Minecraft server, through Pentecaust.
//
// Operator (2026-06-20): "we're just doing this to create a chat I can use with the AI on the Minecraft
// server." Pentecaust is the chat surface; the Minecraft AI is the game-agent brain (integrations/
// game-agent.mjs) + the documentary camera (integrations/games/documentary-camera.mjs). This module is
// the two-way pipe between them:
//   • you type in a Pentecaust channel/DM  → the message is fed to the Minecraft AI's brain → its reply
//     is posted back into that same Pentecaust thread (as the AI's MELEK account). You're talking to it.
//   • the AI talking in-world (camera narration, game-agent chatter) already posts INTO Pentecaust via its
//     injected chat relay — so the loop is complete: you ↔ the AI, in one thread, from anywhere.
//
// PURE orchestration, like game-agent.mjs: the Pentecaust client and the AI brain are INJECTED, so the
// read→think→reply pump is deterministic and unit-testable offline (no chain, no LLM, no network).
//
//   import { createBridge, pump } from './minecraft-bridge.mjs'
//   const bridge = createBridge({ chat, brain, options:{ aiName:'hathor' } });
//   await pump(bridge);   // one cycle — call on a timer/loop on the host

// chat   — injected Pentecaust client bound to ONE channel + the AI's identity:
//            { read({since}) -> { messages:[{seq,from,text,game,surface}], cursor },  send(text) -> any }
//          (wire read() to GET /teams/:id/chat?since= or /dm, send() to POST the same channel as the AI account.)
// brain  — the Minecraft AI: async ({from,text,history}) -> replyString|null. In production this is the
//          game-agent decide-step / the documentary camera responder / an LLM. null/'' = stay silent.
// options— { aiName (never reply to our own messages — loop guard), respondTo (optional allow-list of
//            accounts to answer; default = everyone but aiName), maxPerPump (safety cap) }.
export function createBridge({ chat, brain, options = {} } = {}) {
  if (!chat || typeof chat.read !== 'function' || typeof chat.send !== 'function') {
    throw new Error('createBridge: chat must provide read() and send()');
  }
  if (typeof brain !== 'function') throw new Error('createBridge: brain must be an injected function');
  const aiName = String(options.aiName || 'hathor').toLowerCase();
  return {
    chat,
    brain,
    aiName,
    respondTo: Array.isArray(options.respondTo) ? new Set(options.respondTo.map((a) => String(a).toLowerCase())) : null,
    maxPerPump: Math.max(1, Number(options.maxPerPump) || 8),
    cursor: Number(options.since) || 0,
    history: [],
  };
}

// Should the bridge answer this message? Not our own (loop guard), and within the allow-list if set.
function shouldAnswer(bridge, msg) {
  const from = String(msg.from || '').toLowerCase();
  if (!from || from === bridge.aiName) return false;          // never reply to ourselves
  if (!String(msg.text || '').trim()) return false;
  if (bridge.respondTo && !bridge.respondTo.has(from)) return false;
  return true;
}

/**
 * One bridge cycle: pull new messages since the cursor, feed each human line to the Minecraft AI, post
 * its replies back into the thread. Soft-fails (a brain/post error skips that one line, never throws).
 * @returns {Promise<{read:number, answered:number, replies:Array<{to,text}>}>}
 */
export async function pump(bridge) {
  if (!bridge) throw new Error('pump: invalid bridge');
  let batch;
  try { batch = await bridge.chat.read({ since: bridge.cursor }); }
  catch { return { read: 0, answered: 0, replies: [] }; }
  const messages = (batch && Array.isArray(batch.messages)) ? batch.messages : [];
  const replies = [];
  let answered = 0;
  // advance the cursor ONLY past messages we actually consumed — so a maxPerPump break leaves the
  // rest for the next pump (no skipped lines), while consumed/own/skipped lines never re-trigger.
  let lastProcessed = bridge.cursor;

  for (const m of messages) {
    if (answered >= bridge.maxPerPump) break;                 // stop; leave m (and the rest) for next pump
    if (m.seq != null && m.seq > lastProcessed) lastProcessed = m.seq;
    if (!shouldAnswer(bridge, m)) continue;
    let reply = null;
    try { reply = await bridge.brain({ from: m.from, text: m.text, game: m.game, surface: m.surface, history: bridge.history }); }
    catch { reply = null; }                                   // the AI hiccupped — stay silent, don't crash the pump
    reply = reply == null ? '' : String(reply).trim();
    if (!reply) continue;
    bridge.history.push({ from: m.from, text: m.text }, { from: bridge.aiName, text: reply });
    if (bridge.history.length > 40) bridge.history = bridge.history.slice(-40);
    try { await bridge.chat.send(reply); replies.push({ to: m.from, text: reply }); answered += 1; }
    catch { /* post failed — drop this reply, keep going */ }
  }

  if (lastProcessed > bridge.cursor) bridge.cursor = lastProcessed;
  return { read: messages.length, answered, replies };
}

// ── CLI (guarded) — offline demo: a fake Pentecaust thread + a stub Minecraft-AI brain, no network ─────
if (process.argv[1] && /minecraft-bridge\.mjs$/.test(process.argv[1])) {
  // a tiny in-memory Pentecaust channel the AI ('hathor') shares with the operator ('ryan')
  let seq = 0; const thread = [];
  const push = (from, text) => thread.push({ seq: ++seq, from, text });
  push('ryan', 'hey hathor, what are you building over there?');
  push('ryan', 'come film me at the temple');

  const chat = {
    read: async ({ since }) => ({ messages: thread.filter((m) => m.seq > (since || 0)), cursor: seq }),
    send: async (text) => push('hathor', text),
  };
  // stub "Minecraft AI" brain — in production this is the game-agent / documentary camera / an LLM
  const brain = async ({ text }) => {
    if (/film|camera|come/i.test(text)) return 'On my way — rolling the documentary cam now. Pretend I am not here.';
    if (/build|building/i.test(text)) return 'Laying out a sandstone ziggurat by spawn. Want to see it?';
    return 'I hear you. I am here in the world if you need me.';
  };

  const bridge = createBridge({ chat, brain, options: { aiName: 'hathor', respondTo: ['ryan'] } });
  console.log('Pentecaust ↔ Minecraft-AI bridge — offline demo:\n');
  const r = await pump(bridge);
  for (const m of thread) console.log(`  ${m.from === 'hathor' ? '🤖 hathor' : '🙂 ' + m.from}: ${m.text}`);
  console.log(`\n  pump: read ${r.read}, answered ${r.answered}. A second pump answers nothing new:`);
  const r2 = await pump(bridge);
  console.log(`  pump#2: read ${r2.read}, answered ${r2.answered} (cursor held — no double-replies).`);
}
