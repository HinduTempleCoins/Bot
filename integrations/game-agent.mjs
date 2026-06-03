// game-agent.mjs — the AI-run game-server connector (queue #198). An agent that lives in a
// server-browser game (Minecraft via Mindcraft/Mineflayer; Luanti/Minetest) and acts like a
// player, bridged to a Discord room.
//
// This module is PURE orchestration. It owns NO real game socket and NO real LLM — the game
// client, the brain (LLM fn, e.g. an injected Ollama call), and the chat bridge (Discord) are
// all INJECTED. The perceive→decide→act loop is deterministic and unit-testable offline.
//
//   import { createAgent, step, isLabeledAI, GAMES } from './game-agent.mjs'
//   const agent = createAgent({ game, brain, chat });   // all three injected
//   const action = await step(agent, observation);      // perceive → brain → act
//
// SANDBOX guard (load-bearing):
//   1. Agents are OPENLY LABELED as AI. Every outbound chat message is prefixed/flagged so no
//      human is ever fooled into thinking a person is playing. isLabeledAI() enforces it.
//   2. Arbitrary code execution (Mineflayer/Mindcraft "insecure coding") is DISABLED by default
//      (allow_insecure_coding=false) and MUST never be enabled on a public server. Enabling it
//      requires an explicit opt-in AND a non-public server, or the request is refused.

// ---- target games (the connector roster) -----------------------------------------------------
// flagship   — the big public game we meet players in.
// sovereign  — the open-source game we can self-host and fully control (no EULA over the agent).
// bucket     — categories we can slot additional servers into later.
export const GAMES = {
  minecraft: {
    id: 'minecraft',
    name: 'Minecraft',
    role: 'flagship',
    bridge: 'mindcraft', // Mindcraft on top of Mineflayer
    transport: 'mineflayer',
    public: true, // public servers exist → insecure coding must stay OFF here
    note: 'Flagship server-browser game; agent joins as a player via Mineflayer/Mindcraft.',
  },
  luanti: {
    id: 'luanti',
    name: 'Luanti (Minetest)',
    role: 'sovereign',
    bridge: 'luanti-mod',
    transport: 'minetest-protocol',
    public: false, // self-hosted by default → safe to opt into coding on a private box
    note: 'Open-source, self-hostable; our sovereign sandbox where we own the rules.',
  },
  // buckets for future servers, slotted by genre.
  sandbox_bucket: { id: 'sandbox_bucket', name: 'Sandbox/voxel servers', role: 'bucket', public: true },
  social_bucket: { id: 'social_bucket', name: 'Social/roleplay worlds', role: 'bucket', public: true },
};

// The visible label every human sees. Short, unmissable, machine-detectable.
export const AI_LABEL = '[AI]';
const LABEL_RE = /\[ai\]/i;

// A chat string counts as labeled-AI iff it carries the AI flag. This is the gate every outbound
// message passes through — there is no path to send an unlabeled message.
export function isLabeledAI(text) {
  return LABEL_RE.test(String(text || ''));
}

// Apply the label idempotently: prefix once, never double-prefix.
export function labelMessage(text) {
  const t = String(text == null ? '' : text);
  return isLabeledAI(t) ? t : `${AI_LABEL} ${t}`.trimEnd();
}

// ---- safety: insecure-coding gate ------------------------------------------------------------
// codeExec is OFF unless explicitly enabled AND the server is non-public. Returns the resolved
// boolean (never throws); a refused enable simply resolves to false.
export function resolveInsecureCoding({ allow_insecure_coding = false, isPublic = true } = {}) {
  if (!allow_insecure_coding) return false; // default-deny
  if (isPublic) return false; // never on a public server, even if asked
  return true;
}

// ---- agent factory ----------------------------------------------------------------------------
// game  — injected game client: { observe?(), act(action), say?(text) } (any subset; pure here).
// brain — injected LLM fn: async (prompt|context) → decision. Decision may be a string action,
//         or { action, message } / { type, message } shape.
// chat  — injected Discord bridge: { send(text) } (relays agent chatter to the Discord room).
export function createAgent({ game, brain, chat, options = {} } = {}) {
  if (typeof brain !== 'function') throw new Error('createAgent: brain must be an injected LLM function');
  const target = GAMES[options.game] || GAMES.minecraft;
  const isPublic = options.isPublic != null ? !!options.isPublic : !!target.public;
  const codeExec = resolveInsecureCoding({
    allow_insecure_coding: !!options.allow_insecure_coding,
    isPublic,
  });

  return {
    id: options.id || `hathor-${target.id}`,
    game: game || null,
    brain,
    chat: chat || null,
    target,
    labeledAI: true, // always, by construction
    isPublic,
    codeExec, // resolved; false by default and on any public server
    history: [],
  };
}

// ---- the loop: perceive → decide (brain) → act -----------------------------------------------
// step(agent, observation) → action
//   perceive: fold the observation into a brain prompt/context.
//   decide:   call the injected brain.
//   act:      normalize the decision into an action; if it carries a message, send it through the
//             chat bridge and/or the game's say() — ALWAYS AI-labeled.
export async function step(agent, observation) {
  if (!agent || typeof agent.brain !== 'function') throw new Error('step: invalid agent');

  // perceive
  const context = {
    role: 'You are an openly-labeled AI player. You may never pretend to be human.',
    agentId: agent.id,
    game: agent.target.id,
    observation,
    codeExecEnabled: agent.codeExec,
  };

  // decide (injected brain — pure/offline in tests)
  const decision = await agent.brain(context);

  // normalize the brain's output into a concrete action
  const action = normalizeDecision(decision);

  // safety: if the brain asks to run code but codeExec is disabled, drop it to a no-op.
  if (action.type === 'code' && !agent.codeExec) {
    action.type = 'noop';
    action.refused = 'code execution disabled (allow_insecure_coding=false or public server)';
    delete action.code;
  }

  // act: any outbound message is AI-labeled and routed to chat + game say().
  if (action.message != null && action.message !== '') {
    const labeled = labelMessage(action.message);
    action.message = labeled;
    if (agent.chat && typeof agent.chat.send === 'function') await agent.chat.send(labeled);
    if (agent.game && typeof agent.game.say === 'function') await agent.game.say(labeled);
  }

  // act: hand the motor action to the game client, if one is wired.
  if (agent.game && typeof agent.game.act === 'function' && action.type !== 'noop') {
    await agent.game.act(action);
  }

  agent.history.push({ observation, action });
  return action;
}

// Turn whatever the brain returned into a uniform action object.
//   "mine stone"                          → { type: 'mine', raw: 'mine stone' }
//   { action: 'move', message: 'hi' }     → { type: 'move', message: 'hi' }
//   { type: 'chat', message: 'hello' }    → { type: 'chat', message: 'hello' }
export function normalizeDecision(decision) {
  if (decision == null) return { type: 'noop' };
  if (typeof decision === 'string') {
    const s = decision.trim();
    if (!s) return { type: 'noop' };
    const verb = s.split(/\s+/)[0].toLowerCase();
    return { type: verb || 'noop', raw: s };
  }
  if (typeof decision === 'object') {
    const type = String(decision.type || decision.action || (decision.message ? 'chat' : 'noop')).toLowerCase();
    const out = { ...decision, type };
    delete out.action;
    if (out.message != null) out.message = String(out.message);
    return out;
  }
  return { type: 'noop' };
}

// ---- CLI (guarded) ---------------------------------------------------------------------------
if (process.argv[1] && process.argv[1].endsWith('game-agent.mjs')) {
  // Offline demo with a stub brain + stub chat — no real game, no network, no keys.
  const transcript = [];
  const brain = async (ctx) => {
    if (/\bhello\b/i.test(JSON.stringify(ctx.observation || ''))) return { type: 'chat', message: 'hello, I am a bot here to help' };
    return 'mine stone';
  };
  const chat = { send: async (t) => transcript.push(t) };
  const game = { say: async () => {}, act: async () => {} };

  console.log('Game-agent connector — target roster:');
  for (const g of Object.values(GAMES)) {
    console.log(`  • ${g.name.padEnd(20)} role=${(g.role || '').padEnd(10)} public=${g.public ? 'yes' : 'no '}  ${g.note || ''}`);
  }

  const agent = createAgent({ game, brain, chat, options: { game: 'minecraft' } });
  console.log(`\nAgent ${agent.id}  labeledAI=${agent.labeledAI}  codeExec=${agent.codeExec} (insecure coding default-off)`);

  for (const obs of [{ chat: 'player says hello' }, { biome: 'mountains' }]) {
    const action = await step(agent, obs);
    console.log(`  step → ${action.type}${action.message ? `  msg="${action.message}"` : ''}`);
  }
  console.log('\nDiscord bridge transcript (all AI-labeled):');
  for (const line of transcript) console.log(`  ${isLabeledAI(line) ? '✓' : '✗'} ${line}`);
}
