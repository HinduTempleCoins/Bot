// documentary-camera.test.mjs — OFFLINE. No game, no LLM, no network. A stub rig + stub chat capture
// the camera's motor calls and outbound lines. Every line must be AI-labeled; the camera must obey
// "go away" and re-arm only when invited back.
import { test } from 'node:test';
import assert from 'node:assert';
import {
  createCamera, observe, interpretAddress, pickShot, narrate, summary, SHOTS, isLabeledAI,
} from './documentary-camera.mjs';

function stub() {
  const calls = { follow: [], lookAt: [], stop: 0 };
  const lines = [];
  const rig = {
    follow: async (s, o) => calls.follow.push({ s, range: o && o.range }),
    lookAt: async (s) => calls.lookAt.push(s),
    stop: async () => { calls.stop++; },
    say: async () => {},
  };
  const chat = { send: async (t) => lines.push(t) };
  return { rig, chat, calls, lines };
}

test('pickShot maps activities to shots; unknown → establishing wide', () => {
  assert.equal(pickShot('mining').id, 'closeup');
  assert.equal(pickShot('walking').id, 'tracking');
  assert.equal(pickShot('building').id, 'build');
  assert.equal(pickShot('fighting').id, 'action');
  assert.equal(pickShot('idle').id, 'establishing');
  assert.equal(pickShot('something-weird').id, 'establishing');
  // closer shots for detail work, wider for action (safety)
  assert.ok(SHOTS.closeup.range < SHOTS.action.range);
});

test('acquires a subject and frames the shot at the right distance', async () => {
  const { rig, chat, calls } = stub();
  const cam = createCamera({ rig, chat, options: { name: 'mehit-cam' } });
  assert.equal(cam.state, 'scouting');
  const a = await observe(cam, { subject: 'steve', activity: 'mining', biome: 'caves' });
  assert.equal(a.type, 'film');
  assert.equal(a.subject, 'steve');
  assert.equal(a.shot, 'closeup');
  assert.equal(cam.state, 'filming');
  assert.equal(calls.follow.at(-1).range, SHOTS.closeup.range);   // GoalFollow distance for a close-up
  assert.equal(calls.lookAt.at(-1), 'steve');                     // keeps them framed
});

test('scouts (no motor) when there is no subject yet', async () => {
  const { rig, chat, calls } = stub();
  const cam = createCamera({ rig, chat });
  const a = await observe(cam, { activity: 'idle' });
  assert.equal(a.type, 'scout');
  assert.equal(calls.follow.length, 0);
});

test('narrates on a cadence, not every tick — and every line is AI-labeled', async () => {
  const { rig, chat, lines } = stub();
  const cam = createCamera({ rig, chat, options: { narrateEvery: 3 } });
  for (let i = 0; i < 6; i++) await observe(cam, { subject: 'steve', activity: 'walking' });
  assert.ok(lines.length >= 1 && lines.length <= 3, `cadence-gated narration, got ${lines.length}`);
  assert.ok(lines.every(isLabeledAI), 'every narration line carries the [AI] label');
});

test('"follow me" locks onto the speaker', async () => {
  const { rig, chat } = stub();
  const cam = createCamera({ rig, chat, options: { name: 'mehit-cam' } });
  const a = await observe(cam, { chat: { from: 'dora', text: 'mehit-cam follow me' } });
  assert.equal(a.type, 'interact');
  assert.equal(a.intent, 'follow_me');
  assert.equal(cam.subject, 'dora');
  assert.ok(isLabeledAI(a.message));
});

test('"film <player>" cuts to a named subject', async () => {
  const { rig, chat } = stub();
  const cam = createCamera({ rig, chat, options: { subject: 'steve' } });
  const a = await observe(cam, { chat: { from: 'steve', text: 'camera, film alex' } });
  assert.equal(a.intent, 'follow_other');
  assert.equal(cam.subject, 'alex');
});

test('"go away" stops the camera and it stays out until invited back', async () => {
  const { rig, chat, calls } = stub();
  const cam = createCamera({ rig, chat, options: { subject: 'steve', name: 'mehit-cam' } });
  const bye = await observe(cam, { chat: { from: 'steve', text: 'mehit-cam go away' } });
  assert.equal(bye.intent, 'go_away');
  assert.equal(cam.subject, null);
  assert.equal(cam.state, 'dismissed');
  assert.equal(calls.stop, 1);
  // dismissed: a normal activity tick is a no-op (it does NOT resume filming on its own)
  const idle = await observe(cam, { subject: 'steve', activity: 'mining' });
  assert.equal(idle.type, 'noop');
  assert.equal(idle.state, 'dismissed');
  // invited back by name → films again
  const back = await observe(cam, { chat: { from: 'steve', text: 'mehit-cam come here' } });
  assert.equal(back.intent, 'follow_me');
  assert.equal(cam.subject, 'steve');
});

test('come closer / back up change the framing distance', async () => {
  const { rig, chat, calls } = stub();
  const cam = createCamera({ rig, chat, options: { subject: 'steve', name: 'cam' } });
  await observe(cam, { chat: { from: 'steve', text: 'cam come closer' } });
  assert.equal(calls.follow.at(-1).range, SHOTS.closeup.range);
  await observe(cam, { chat: { from: 'steve', text: 'cam back up' } });
  assert.equal(calls.follow.at(-1).range, SHOTS.establishing.range);
});

test('"who are you" answers honestly as an AI cameraman', async () => {
  const { rig, chat } = stub();
  const cam = createCamera({ rig, chat, options: { name: 'mehit-cam' } });
  const a = await observe(cam, { chat: { from: 'steve', text: 'who are you mehit-cam?' } });
  assert.equal(a.intent, 'who_are_you');
  assert.match(a.message, /AI/);
  assert.match(a.message, /mehit-cam/);
});

test('addressed-but-unknown still gets a friendly acknowledge (a friend, not a parser)', () => {
  const r = interpretAddress('camera you are doing great lol', { selfName: 'mehit-cam' });
  assert.equal(r.addressed, true);
  assert.equal(r.intent, 'acknowledge');
});

test('ignores chatter NOT addressed to the camera', () => {
  const r = interpretAddress('hey steve follow me to the cave', { selfName: 'mehit-cam', from: 'alex' });
  assert.equal(r.addressed, false);
  assert.equal(r.intent, null);
});

test('a whisper/direct message counts as addressed even without the name', () => {
  const r = interpretAddress('come here', { selfName: 'mehit-cam', from: 'steve', direct: true });
  assert.equal(r.addressed, true);
  assert.equal(r.intent, 'follow_me');
});

test('narration is deterministic and varies by tick (no Date.now/Math.random)', () => {
  const a = narrate({ subject: 'steve', activity: 'mining', biome: 'caves' }, { self: { ticks: 0 } });
  const b = narrate({ subject: 'steve', activity: 'mining', biome: 'caves' }, { self: { ticks: 0 } });
  const c = narrate({ subject: 'steve', activity: 'mining', biome: 'caves' }, { self: { ticks: 1 } });
  assert.equal(a, b);                 // same inputs → same output (deterministic/offline)
  assert.notEqual(a, c);              // opener rotates with the tick counter
  assert.match(a, /steve/);
});

test('summary reports the live framing for an overlay', async () => {
  const { rig, chat } = stub();
  const cam = createCamera({ rig, chat, options: { name: 'mehit-cam' } });
  await observe(cam, { subject: 'steve', activity: 'building' });
  const s = summary(cam);
  assert.equal(s.name, 'mehit-cam');
  assert.equal(s.state, 'filming');
  assert.equal(s.subject, 'steve');
  assert.equal(s.shot, 'build');
  assert.equal(s.labeledAI, true);
});

test('soft-fails with no rig wired (pure orchestration, never throws)', async () => {
  const cam = createCamera({});                 // no rig, no chat
  const a = await observe(cam, { subject: 'steve', activity: 'mining' });
  assert.equal(a.type, 'film');                 // still decides the shot
  assert.equal(a.subject, 'steve');
});
