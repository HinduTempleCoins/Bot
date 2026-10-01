// senses.test.mjs — OFFLINE: a fake mineflayer bot; sight directions, hearing buffer, body, voice fallback, describe().
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { relDir, see, createHearing, feel, speak, createSenses, describe, pixelSight, SURFACE } from './senses.mjs';

const v = (x, y, z) => ({ x, y, z, offset(dx, dy, dz) { return v(x + dx, y + dy, z + dz); } });

function fakeBot() {
  const bot = new EventEmitter();
  bot.username = 'Sophia';
  bot.entity = { position: v(0, 64, 0), yaw: 0 };                     // facing -Z (north)
  bot.entities = {
    1: { type: 'player', username: 'Ryan', position: v(0, 64, -5) },     // straight ahead
    2: { type: 'mob', name: 'cow', position: v(-6, 64, 0) },             // to the bot's left (west when facing north)
    3: { type: 'mob', name: 'zombie', position: v(0, 64, 8) },           // behind
    4: { type: 'mob', name: 'far_thing', position: v(500, 64, 0) },      // out of range
  };
  bot.entities.self = bot.entity;
  bot.blockAtCursor = () => ({ name: 'oak_log', position: v(0, 64, -3) });
  bot.blockAt = (p) => (p.y < 64 ? { name: 'grass_block', biome: { name: 'plains' } } : { name: 'air', light: 15 });
  bot.time = { timeOfDay: 6000, isDay: true };
  bot.isRaining = false;
  bot.health = 18; bot.food = 14; bot.oxygenLevel = 20;
  bot.heldItem = { name: 'stone_axe' };
  bot.inventory = { items: () => [{ name: 'bread', count: 3 }, { name: 'oak_log', count: 10 }, { name: 'bread', count: 2 }] };
  bot.said = []; bot.chat = (t) => bot.said.push(t);
  return bot;
}

test('relDir: ahead, left, behind from the bot facing north', () => {
  assert.equal(relDir(v(0, 0, 0), 0, v(0, 0, -5)), 'ahead');
  assert.equal(relDir(v(0, 0, 0), 0, v(-6, 0, 0)), 'left');
  assert.equal(relDir(v(0, 0, 0), 0, v(6, 0, 0)), 'right');
  assert.equal(relDir(v(0, 0, 0), 0, v(0, 0, 8)), 'behind');
});

test('sight: nearby entities by distance with direction, the looked-at block, ground, biome, day', () => {
  const s = see(fakeBot());
  assert.ok(s.ok);
  assert.deepEqual(s.entities.map((e) => [e.name, e.direction]), [['Ryan', 'ahead'], ['cow', 'left'], ['zombie', 'behind']]);
  assert.equal(s.lookingAt.block, 'oak_log'); assert.equal(s.standingOn, 'grass_block'); assert.equal(s.biome, 'plains'); assert.equal(s.isDay, true);
});

test('hearing keeps chat and sounds with direction; ignores its own chat', () => {
  const bot = fakeBot(); const h = createHearing(bot);
  bot.emit('chat', 'Ryan', 'come here'); bot.emit('chat', 'Sophia', 'my own words');
  bot.emit('soundEffectHeard', 'minecraft:entity.zombie.ambient', v(0, 64, 8));
  const ev = h.heard();
  assert.equal(ev.length, 2);
  assert.equal(ev[0].text, 'come here'); assert.equal(ev[1].sound, 'entity.zombie.ambient'); assert.equal(ev[1].direction, 'behind');
});

test('body sense sums the inventory and reports held item', () => {
  const b = feel(fakeBot());
  assert.equal(b.health, 18); assert.equal(b.held, 'stone_axe');
  assert.deepEqual(b.inventory, ['oak_log×10', 'bread×5']);
});

test('voice: TTS when it works, chat when it does not; never throws', async () => {
  const bot = fakeBot();
  assert.deepEqual(await speak(bot, 'hello', { tts: async () => ({ ok: true }) }), { ok: true, via: 'voice' });
  assert.deepEqual(await speak(bot, 'hello', { tts: async () => { throw new Error('no voice'); } }), { ok: true, via: 'chat' });
  assert.deepEqual(bot.said, ['hello']);
});

test('pixel sight only with both hooks; perceive() + describe() make one paragraph tagged minecraft', async () => {
  assert.equal(await pixelSight({}), null);
  const bot = fakeBot();
  const senses = createSenses(bot, { screenshot: async () => Buffer.from('png'), caption: async () => 'a wooden house by a river' });
  bot.emit('chat', 'Ryan', 'look at the river');
  const p = await senses.perceive();
  assert.equal(p.surface, SURFACE);
  const d = describe(p);
  assert.match(d, /standing on grass_block in a plains/); assert.match(d, /Ryan \(player, 5 blocks ahead\)/);
  assert.match(d, /My eyes show: a wooden house by a river/); assert.match(d, /Ryan said "look at the river"/); assert.match(d, /health 18\/20/);
});

test('a broken bot never throws', async () => {
  assert.deepEqual(see({}), { ok: false });
  assert.equal(feel({}).health, null);
  const p = await createSenses({ on() {} }).perceive();
  assert.equal(typeof describe(p), 'string');
});
