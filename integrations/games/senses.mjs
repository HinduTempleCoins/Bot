// senses.mjs — the sensory organs for the AI characters in our worlds (Minecraft first, via mineflayer; then our own
// world). Each sense turns a live bot into structured perception the brain can read; describe() folds it into one
// compact text for the LLM. This is what makes a character perceive the world instead of only reading chat.
//
//   SIGHT  — what is in the view cone (blocks and creatures, with direction and distance), what is underfoot, light,
//            time of day, weather, biome; plus a PIXEL hook (screenshot → caption) for when the viewer runs headless.
//   HEARING— chat and in-game sound events, with direction and distance, kept in a short rolling buffer.
//   BODY   — health, hunger, air, burning, being hurt, what is held, inventory summary.
//   VOICE  — speak(): an injected TTS (e.g. our Piper narrator voice) to a voice channel, with chat as the fallback.
//
// Every bot-facing call is soft (a missing API on a server version never throws). The bot, the captioner and the TTS
// are INJECTED, so the whole module tests offline with a fake bot. Memory compartment: every percept carries
// surface:'minecraft' (see hathor-limb.mjs) so the game never bleeds into the blog or Discord threads.
//
//   import { createSenses } from './senses.mjs'
//   const senses = createSenses(bot, { caption, tts });   // caption(pngBuffer)->text, tts(text)->{ok}
//   const p = await senses.perceive();  brain(describe(p));

export const SURFACE = 'minecraft';

const safe = (fn, d = null) => { try { const v = fn(); return v === undefined ? d : v; } catch { return d; } };
const round = (n, k = 1) => Math.round(n * 10 ** k) / 10 ** k;

/** compass-relative direction of a point from the bot, using the bot's yaw (mineflayer: yaw 0 = facing -Z/north). */
export function relDir(botPos, yaw, target) {
  const dx = target.x - botPos.x, dz = target.z - botPos.z;
  const ang = Math.atan2(-dx, -dz);                                  // world angle where 0 = -Z
  let rel = ang - yaw;
  while (rel > Math.PI) rel -= 2 * Math.PI;
  while (rel < -Math.PI) rel += 2 * Math.PI;
  const deg = rel * 180 / Math.PI;
  const a = Math.abs(deg);
  if (a <= 30) return 'ahead';
  if (a >= 150) return 'behind';
  return deg > 0 ? (a < 90 ? 'ahead-left' : 'left') : (a < 90 ? 'ahead-right' : 'right');
}

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

/** SIGHT: entities and notable blocks around, with direction; the block looked at; the ground; light; sky. */
export function see(bot, { range = 24, max = 12 } = {}) {
  const me = safe(() => bot.entity.position, null);
  if (!me) return { ok: false };
  const yaw = safe(() => bot.entity.yaw, 0);
  const ents = Object.values(safe(() => bot.entities, {}) || {})
    .filter((e) => e && e !== bot.entity && e.position && dist(e.position, me) <= range)
    .map((e) => ({ kind: e.type === 'player' ? 'player' : (e.name || e.mobType || e.type || 'thing'),
      name: e.username || e.displayName || e.name || '', distance: round(dist(e.position, me)), direction: relDir(me, yaw, e.position) }))
    .sort((a, b) => a.distance - b.distance).slice(0, max);
  const looking = safe(() => bot.blockAtCursor(range), null);
  const under = safe(() => bot.blockAt(me.offset(0, -1, 0)), null);
  return {
    ok: true,
    entities: ents,
    lookingAt: looking ? { block: looking.name, distance: round(dist(looking.position, me)) } : null,
    standingOn: under ? under.name : null,
    biome: safe(() => (under && under.biome && under.biome.name) || null, null),
    light: safe(() => bot.blockAt(me).light, null),
    timeOfDay: safe(() => bot.time.timeOfDay, null),
    isDay: safe(() => bot.time.isDay, null),
    raining: safe(() => bot.isRaining, false),
  };
}

/** HEARING: a rolling buffer of chat and sound events. Attach once; read with heard(). */
export function createHearing(bot, { keep = 20 } = {}) {
  const buf = [];
  const push = (ev) => { buf.push({ ...ev, at: Date.now() }); if (buf.length > keep) buf.shift(); };
  const where = (pos) => {
    const me = safe(() => bot.entity.position, null);
    return me && pos ? { distance: round(dist(pos, me)), direction: relDir(me, safe(() => bot.entity.yaw, 0), pos) } : {};
  };
  safe(() => bot.on('chat', (username, message) => { if (username !== bot.username) push({ type: 'chat', from: username, text: String(message).slice(0, 300) }); }));
  safe(() => bot.on('whisper', (username, message) => push({ type: 'whisper', from: username, text: String(message).slice(0, 300) })));
  safe(() => bot.on('soundEffectHeard', (name, pos) => push({ type: 'sound', sound: String(name).replace(/^minecraft:/, ''), ...where(pos) })));
  safe(() => bot.on('hardcodedSoundEffectHeard', (id, cat, pos) => push({ type: 'sound', sound: `sound#${id}`, ...where(pos) })));
  return { heard: (sinceMs = 60000) => buf.filter((e) => Date.now() - e.at <= sinceMs), _push: push };
}

/** BODY: how the character feels. */
export function feel(bot) {
  const inv = safe(() => bot.inventory.items(), []) || [];
  const counts = {};
  for (const it of inv) counts[it.name] = (counts[it.name] || 0) + (it.count || 1);
  return {
    health: safe(() => bot.health, null), food: safe(() => bot.food, null), oxygen: safe(() => bot.oxygenLevel, null),
    onFire: safe(() => Boolean(bot.entity.onFire || (bot.entity.metadata && bot.entity.metadata[0] & 1)), false),
    held: safe(() => (bot.heldItem ? bot.heldItem.name : null), null),
    inventory: Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${k}×${v}`),
  };
}

/** PIXEL SIGHT: screenshot → caption, both injected (prismarine-viewer headless + a vision model). Null if absent. */
export async function pixelSight({ screenshot, caption } = {}) {
  if (typeof screenshot !== 'function' || typeof caption !== 'function') return null;
  try { const png = await screenshot(); return png ? String(await caption(png)).slice(0, 400) : null; } catch { return null; }
}

/** VOICE: TTS when available (to a voice channel), chat otherwise. Never throws. */
export async function speak(bot, text, { tts } = {}) {
  const t = String(text || '').slice(0, 240);
  if (!t) return { ok: false };
  if (typeof tts === 'function') {
    try { const r = await tts(t); if (r && r.ok) return { ok: true, via: 'voice' }; } catch { /* fall back */ }
  }
  return safe(() => { bot.chat(t); return { ok: true, via: 'chat' }; }, { ok: false });
}

export function createSenses(bot, { caption, screenshot, tts } = {}) {
  const hearing = createHearing(bot);
  return {
    surface: SURFACE,
    hearing,
    async perceive() {
      return { surface: SURFACE, at: Date.now(), sight: see(bot), heard: hearing.heard(), body: feel(bot), view: await pixelSight({ screenshot, caption }) };
    },
    speak: (text) => speak(bot, text, { tts }),
  };
}

/** one compact paragraph for the brain prompt */
export function describe(p) {
  if (!p) return '';
  const s = p.sight || {}, b = p.body || {};
  const parts = [];
  if (s.ok) {
    parts.push(`I am standing on ${s.standingOn || 'something'}${s.biome ? ` in a ${s.biome.replace(/_/g, ' ')}` : ''}; it is ${s.isDay === false ? 'night' : 'day'}${s.raining ? ' and raining' : ''}.`);
    if (s.lookingAt) parts.push(`I am looking at ${s.lookingAt.block} ${s.lookingAt.distance} blocks away.`);
    if (s.entities && s.entities.length) parts.push(`I see ${s.entities.map((e) => `${e.name || e.kind} (${e.kind === 'player' ? 'player, ' : ''}${e.distance} blocks ${e.direction})`).join(', ')}.`);
  }
  if (p.view) parts.push(`My eyes show: ${p.view}`);
  const h = (p.heard || []).slice(-5);
  if (h.length) parts.push(`I heard: ${h.map((e) => (e.type === 'sound' ? `${e.sound}${e.direction ? ` ${e.direction}` : ''}` : `${e.from} said "${e.text}"`)).join('; ')}.`);
  parts.push(`I feel: health ${b.health ?? '?'}/20, hunger ${b.food ?? '?'}/20${b.onFire ? ', ON FIRE' : ''}${b.held ? `, holding ${b.held}` : ''}${b.inventory && b.inventory.length ? `; carrying ${b.inventory.join(', ')}` : ''}.`);
  return parts.join(' ');
}
