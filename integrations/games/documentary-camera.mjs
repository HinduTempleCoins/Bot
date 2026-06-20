// documentary-camera.mjs — a roaming "cameraman" operator for our Minecraft server.
//
// Operator (2026-06-20): "could you install some kind of like documentary camera to follow them
// around, and they can interact with it like it's a friend with a camera if they want."
//
// This is that camera. It is a SECOND bot (its own labeled-AI account, distinct from Hathor the
// player) whose whole job is to film the humans: lock onto a subject, follow at a cinematic
// distance, frame the shot to match what they're doing, narrate documentary-style, and — the part
// that makes it a *friend* and not a drone — talk back when you talk to it ("come here", "film
// this", "who are you", "go away"). Opt-in by construction: if you tell it to leave, it leaves.
//
// PURE ORCHESTRATION, like game-agent.mjs. It owns NO real game socket and NO real LLM. The camera
// rig, the narrator brain, and the chat relay are all INJECTED. The perceive→decide→act loop is
// deterministic and unit-testable offline (no mineflayer, no network, no keys).
//
// THE REAL WIRING (described, not run here — lives on the box that runs the mineflayer bots):
//   • follow      → mineflayer-pathfinder GoalFollow(subjectEntity, range) at the shot's distance.
//   • look/aim    → bot.lookAt(subject.position.offset(0, 1.6, 0)) each tick (keep them framed).
//   • the "lens"  → prismarine-viewer renders the bot's POV to a browser/phone — that IS the camera
//                   feed (the catalog's "watch her from a phone" path in minecraft-ai-projects.mjs).
//   • peaceful    → no pvp plugin; the camera never attacks. It backs up during combat for a safe shot.
//   • account     → a separate openly-labeled bot account; never a human's, never Hathor's player slot.
//
//   import { createCamera, observe, interpretAddress, pickShot, narrate, SHOTS } from './documentary-camera.mjs'
//   const cam = createCamera({ rig, narrator, chat, options:{ name:'mehit-cam' } });   // all injected
//   const action = await observe(cam, { subject:'steve', activity:'mining', biome:'caves' });

import { labelMessage, isLabeledAI, AI_LABEL } from '../game-agent.mjs';

export { isLabeledAI, AI_LABEL };

// ── shot grammar: how the camera frames each activity ─────────────────────────────────────────────
// range = blocks the camera holds from the subject (pathfinder GoalFollow distance). Closer for detail
// work, wider for action so the camera (and operator) stay safe and the whole scene is in frame.
export const SHOTS = {
  establishing: { id: 'establishing', range: 8, angle: 'wide',            for: 'idle' },
  tracking:     { id: 'tracking',     range: 4, angle: 'behind',          for: 'walking' },
  closeup:      { id: 'closeup',      range: 2, angle: 'over-shoulder',   for: 'mining' },
  build:        { id: 'build',        range: 3, angle: 'over-shoulder',   for: 'building' },
  action:       { id: 'action',       range: 6, angle: 'wide-safe',       for: 'fighting' },
  medium:       { id: 'medium',       range: 3, angle: 'eye-level',       for: 'talking' },
};

// Map a subject's activity → a shot. Unknown/blank activity → an establishing wide shot.
const ACTIVITY_SHOT = {
  idle: 'establishing', stand: 'establishing', afk: 'establishing',
  walk: 'tracking', walking: 'tracking', run: 'tracking', running: 'tracking', sprint: 'tracking', travel: 'tracking',
  mine: 'closeup', mining: 'closeup', dig: 'closeup', digging: 'closeup', harvest: 'closeup', gather: 'closeup',
  build: 'build', building: 'build', place: 'build', placing: 'build',
  fight: 'action', fighting: 'action', combat: 'action', attack: 'action', pvp: 'action',
  talk: 'medium', talking: 'medium', chat: 'medium', trade: 'medium',
};
export function pickShot(activity) {
  const key = ACTIVITY_SHOT[String(activity || '').toLowerCase()] || 'establishing';
  return SHOTS[key];
}

// ── interaction: is this chat line addressed to the camera, and what does it want? ─────────────────
// The camera answers to its own name, to "camera"/"cameraman"/"film crew", or to any line flagged as a
// direct/whisper message ({ direct:true }). A line that is addressed but matches no known intent still
// gets a friendly acknowledgement (intent 'acknowledge') — a friend, not a command parser.
const ADDRESS_RE = /\b(camera|cameraman|camera-?man|film crew|filmcrew)\b/i;
const INTENTS = [
  { intent: 'follow_other', re: /\b(?:film|follow|shoot|get|go film)\s+(?!me\b|this\b)([a-z0-9_]{2,16})\b/i, target: 1 },
  { intent: 'follow_me',    re: /\b(follow me|film me|come here|come with me|shoot me|over here|with me)\b/i },
  { intent: 'go_away',      re: /\b(go away|leave me|stop filming|stop following|cut it|piss off|get lost|turn it off|camera off)\b/i },
  { intent: 'come_closer',  re: /\b(come closer|closer|zoom in|get closer|push in)\b/i },
  { intent: 'back_up',      re: /\b(back up|back off|give me space|too close|wider|pull back|zoom out)\b/i },
  { intent: 'film_this',    re: /\b(film this|get this|are you (?:getting|filming) this|you seeing this|capture this|this moment)\b/i },
  { intent: 'who_are_you',  re: /\b(who are you|what are you|are you (?:a )?(?:bot|ai)|your name)\b/i },
];

/**
 * Decide whether a chat line is talking to the camera and what it's asking for. PURE; never throws.
 * @param {string} text   the chat message
 * @param {{selfName?:string, from?:string, direct?:boolean}} ctx
 * @returns {{addressed:boolean, intent:string|null, target:string|null, from:string|null}}
 */
export function interpretAddress(text, ctx = {}) {
  const s = String(text == null ? '' : text);
  const from = ctx.from != null ? String(ctx.from) : null;
  const name = ctx.selfName ? String(ctx.selfName).toLowerCase() : null;
  const named = !!name && new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(s);
  const addressed = !!ctx.direct || named || ADDRESS_RE.test(s);
  if (!addressed) return { addressed: false, intent: null, target: null, from };
  for (const m of INTENTS) {
    const hit = s.match(m.re);
    if (hit) return { addressed: true, intent: m.intent, target: m.target ? hit[m.target] : null, from };
  }
  return { addressed: true, intent: 'acknowledge', target: null, from };
}

// ── documentary narration (deterministic templates; an injected narrator LLM overrides) ───────────
// Generic nature-doc register — observational, warm, a little wry. Never claims to be human.
const N_OPEN = ['Here we observe', 'And here', 'Notice', 'Observe', 'In the wild we find', 'Before us'];
const ACTIVITY_LINE = {
  establishing: (s, b) => `the ${b || 'world'} stretches out, and somewhere in it, ${s} — our subject for today.`,
  tracking:     (s, b) => `${s} is on the move, crossing the ${b || 'terrain'} with purpose. We follow, quietly.`,
  closeup:      (s, b) => `${s} works the ${b || 'stone'} block by block — patient, methodical, utterly absorbed.`,
  build:        (s, b) => `${s} lays one block upon the next. A structure takes shape. We are witnessing creation.`,
  action:       (s, b) => `danger. ${s} squares up — the camera keeps a respectful distance and lets the moment unfold.`,
  medium:       (s, b) => `${s} pauses to speak. In these quiet exchanges, the real story is often told.`,
};
/**
 * One documentary line for the current shot. PURE + deterministic (no randomness): the opener is chosen
 * from the camera's tick counter so successive lines vary without Date.now()/Math.random().
 * @param {{activity?:string, subject?:string, biome?:string}} obs
 * @param {{self?:{name?:string,ticks?:number}, shotId?:string}} ctx
 */
export function narrate(obs = {}, ctx = {}) {
  const shotId = ctx.shotId || pickShot(obs.activity).id;
  const subject = obs.subject || (ctx.self && ctx.self.subject) || 'our subject';
  const biome = obs.biome || null;
  const open = N_OPEN[((ctx.self && ctx.self.ticks) || 0) % N_OPEN.length];
  const body = (ACTIVITY_LINE[shotId] || ACTIVITY_LINE.establishing)(subject, biome);
  return `${open} ${body}`;
}

// ── camera factory ────────────────────────────────────────────────────────────────────────────────
// rig      — injected mc client: { follow(subject,{range}), lookAt(subject), stop() } (any subset).
// narrator — optional injected async fn (ctx) → string; falls back to the deterministic templates.
// chat     — injected relay: { send(text) } (server chat and/or a Discord room).
// options  — { name, narrateEvery (cadence; default 3), subject (start locked on someone) }.
export function createCamera({ rig, narrator, chat, options = {} } = {}) {
  return {
    name: options.name || 'mehit-cam',
    rig: rig || null,
    narrator: typeof narrator === 'function' ? narrator : null,
    chat: chat || null,
    labeledAI: true,                 // always — every line goes through labelMessage()
    state: options.subject ? 'filming' : 'scouting',
    subject: options.subject || null,
    shot: null,
    ticks: 0,
    narrateEvery: Math.max(1, Number(options.narrateEvery) || 3),
    sinceNarration: 0,
    history: [],
  };
}

// Narrate on a cadence (every Nth filming tick) so the camera is present, not chatty.
function shouldNarrate(cam) { return cam.sinceNarration >= cam.narrateEvery; }

// Send a line out, AI-labeled, to the chat relay and the in-game say (if the rig exposes one).
async function relay(cam, text) {
  const line = labelMessage(text);
  if (cam.chat && typeof cam.chat.send === 'function') await cam.chat.send(line);
  if (cam.rig && typeof cam.rig.say === 'function') await cam.rig.say(line);
  return line;
}

// Point the rig at a subject at the shot's distance (real: GoalFollow + lookAt). Soft no-op if unwired.
async function frame(cam, subject, shot) {
  if (cam.rig && typeof cam.rig.follow === 'function') await cam.rig.follow(subject, { range: shot.range });
  if (cam.rig && typeof cam.rig.lookAt === 'function') await cam.rig.lookAt(subject);
}

// Handle a line addressed to the camera. Returns the interaction action (with an AI-labeled reply).
async function handleAddress(cam, addr, obs) {
  const out = { type: 'interact', intent: addr.intent, subject: cam.subject };
  switch (addr.intent) {
    case 'follow_me':
      cam.subject = addr.from || cam.subject; cam.state = 'filming'; cam.sinceNarration = cam.narrateEvery;
      if (cam.subject) await frame(cam, cam.subject, pickShot(obs.activity));
      out.subject = cam.subject; out.message = `Rolling on you${cam.subject ? `, ${cam.subject}` : ''}. Pretend I'm not here.`;
      break;
    case 'follow_other':
      cam.subject = addr.target; cam.state = 'filming'; cam.sinceNarration = cam.narrateEvery;
      await frame(cam, cam.subject, pickShot(obs.activity));
      out.subject = cam.subject; out.message = `Cutting to ${cam.subject}. New star of the show.`;
      break;
    case 'go_away':
      cam.subject = null; cam.state = 'dismissed';
      if (cam.rig && typeof cam.rig.stop === 'function') await cam.rig.stop();
      out.subject = null; out.message = `Camera off — all yours. Just say "camera, come here" when you want me back.`;
      break;
    case 'come_closer':
      cam.shot = 'closeup'; if (cam.subject) await frame(cam, cam.subject, SHOTS.closeup);
      out.message = `Pushing in.`;
      break;
    case 'back_up':
      cam.shot = 'establishing'; if (cam.subject) await frame(cam, cam.subject, SHOTS.establishing);
      out.message = `Pulling back, giving you room.`;
      break;
    case 'film_this':
      out.message = narrate(obs, { self: cam, shotId: cam.shot || pickShot(obs.activity).id }) + ' — got it. This is going in the documentary.';
      break;
    case 'who_are_you':
      out.message = `I'm ${cam.name}, the house cameraman — an openly-AI film crew of one. I follow, I film, I narrate. Tell me to go and I will.`;
      break;
    default:
      out.message = `Heard you. I'm just here filming — tell me "follow me", "film this", or "go away" and I'll do it.`;
  }
  out.message = await relay(cam, out.message);
  cam.history.push({ addr, action: out });
  return out;
}

/**
 * One observe→decide→act tick. PURE control flow; all side effects go through the injected rig/chat.
 *   observation: { subject?, activity?, biome?, chat?:{from,text,direct?} }
 * Returns an action: { type:'interact'|'film'|'scout'|'noop', ... , message? } — message always AI-labeled.
 */
export async function observe(cam, observation = {}) {
  if (!cam) throw new Error('observe: invalid camera');
  const obs = observation || {};
  cam.ticks++;

  // 1) INTERACTION first — if someone talked to the camera, that always takes priority.
  if (obs.chat && obs.chat.text != null) {
    const addr = interpretAddress(obs.chat.text, { selfName: cam.name, from: obs.chat.from, direct: obs.chat.direct });
    if (addr.addressed) return handleAddress(cam, addr, obs);
  }

  // A dismissed camera stays out of the way until invited back (only an address re-arms it, above).
  if (cam.state === 'dismissed') { const a = { type: 'noop', state: 'dismissed' }; cam.history.push({ obs, action: a }); return a; }

  // 2) ACQUIRE a subject if we don't have one.
  if (!cam.subject) {
    if (obs.subject) { cam.subject = obs.subject; cam.state = 'filming'; cam.sinceNarration = cam.narrateEvery; }
    else { const a = { type: 'scout', state: 'scouting' }; cam.history.push({ obs, action: a }); return a; }
  }
  // A new subject can also be handed in mid-roll.
  if (obs.subject && obs.subject !== cam.subject) { cam.subject = obs.subject; cam.sinceNarration = cam.narrateEvery; }

  // 3) FILM: choose the shot for the activity, frame it, and narrate on cadence.
  const shot = pickShot(obs.activity);
  cam.shot = shot.id; cam.state = 'filming';
  await frame(cam, cam.subject, shot);
  cam.sinceNarration++;

  const action = { type: 'film', subject: cam.subject, shot: shot.id, angle: shot.angle, range: shot.range };
  if (shouldNarrate(cam)) {
    let line = cam.narrator ? await cam.narrator({ subject: cam.subject, activity: obs.activity, biome: obs.biome, shot: shot.id }) : null;
    if (!line) line = narrate(obs, { self: cam, shotId: shot.id });
    action.message = await relay(cam, line);
    cam.sinceNarration = 0;
  }
  cam.history.push({ obs, action });
  return action;
}

// A glanceable status line — what the camera is doing right now (for a "what's it filming" overlay).
export function summary(cam) {
  if (!cam) return { state: 'none' };
  return {
    name: cam.name, state: cam.state, subject: cam.subject, shot: cam.shot,
    labeledAI: cam.labeledAI, ticks: cam.ticks,
  };
}

// ── CLI (guarded) — offline demo: a stub rig + stub chat, no game, no network, no keys ──────────────
if (process.argv[1] && process.argv[1].endsWith('documentary-camera.mjs')) {
  const transcript = [];
  const rig = { follow: async () => {}, lookAt: async () => {}, stop: async () => {}, say: async () => {} };
  const chat = { send: async (t) => transcript.push(t) };
  const cam = createCamera({ rig, chat, options: { name: 'mehit-cam', narrateEvery: 2 } });

  const script = [
    { subject: 'steve', activity: 'idle', biome: 'plains' },
    { activity: 'walking' },
    { activity: 'mining', biome: 'caves' },
    { chat: { from: 'steve', text: 'mehit-cam come closer' } },
    { activity: 'building' },
    { chat: { from: 'alex', text: 'camera, film alex instead' } },
    { activity: 'fighting' },
    { chat: { from: 'alex', text: 'mehit-cam are you getting this?!' } },
    { chat: { from: 'alex', text: 'ok camera go away' } },
    { activity: 'mining' }, // ignored — dismissed until invited back
  ];

  console.log(`Documentary camera "${cam.name}" — openly-AI film crew (label ${AI_LABEL}). Offline demo:\n`);
  for (const obs of script) {
    const a = await observe(cam, obs);
    const tag = a.type.padEnd(8);
    const detail = a.type === 'film' ? `shot=${a.shot} range=${a.range} subject=${a.subject}`
      : a.type === 'interact' ? `intent=${a.intent} subject=${a.subject}`
      : a.type;
    console.log(`  ${tag} ${detail}${a.message ? `\n           “${a.message}”` : ''}`);
  }
  console.log(`\nFinal: ${JSON.stringify(summary(cam))}`);
  console.log(`\nAll ${transcript.length} outbound lines AI-labeled: ${transcript.every(isLabeledAI) ? '✓' : '✗ LEAK'}`);
}
