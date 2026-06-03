import { test } from 'node:test';
import assert from 'node:assert';
import {
  createAgent, step, isLabeledAI, labelMessage, normalizeDecision,
  resolveInsecureCoding, GAMES, AI_LABEL,
} from './game-agent.mjs';

test('GAMES roster has Minecraft flagship + Luanti sovereign + buckets', () => {
  assert.equal(GAMES.minecraft.role, 'flagship');
  assert.equal(GAMES.luanti.role, 'sovereign');
  const roles = Object.values(GAMES).map((g) => g.role);
  assert.ok(roles.includes('bucket'), 'has at least one bucket');
  assert.equal(GAMES.minecraft.public, true, 'minecraft is a public-server game');
  assert.equal(GAMES.luanti.public, false, 'luanti is self-hostable/sovereign');
});

test('isLabeledAI / labelMessage: every message is flagged, idempotently', () => {
  assert.ok(!isLabeledAI('hello world'));
  assert.ok(isLabeledAI(labelMessage('hello world')));
  assert.ok(labelMessage('hi').includes(AI_LABEL));
  // idempotent: do not double-prefix
  const once = labelMessage('hi');
  assert.equal(labelMessage(once), once);
});

test('step routes observation → brain → action with an injected brain', async () => {
  const seen = [];
  const brain = async (ctx) => { seen.push(ctx); return 'mine stone'; };
  const agent = createAgent({ brain });
  const action = await step(agent, { biome: 'plains' });
  assert.equal(seen.length, 1, 'brain was called once');
  assert.deepEqual(seen[0].observation, { biome: 'plains' }, 'observation passed to brain');
  assert.equal(action.type, 'mine', 'brain decision became the action');
  assert.equal(agent.history.length, 1, 'step recorded into history');
});

test('every outbound chat message is AI-labeled (chat + game.say)', async () => {
  const sent = [];
  const said = [];
  const brain = async () => ({ type: 'chat', message: 'hello humans' });
  const chat = { send: async (t) => sent.push(t) };
  const game = { say: async (t) => said.push(t), act: async () => {} };
  const agent = createAgent({ brain, chat, game });
  const action = await step(agent, { chat: 'hi bot' });
  assert.ok(isLabeledAI(action.message), 'returned message is labeled');
  assert.equal(sent.length, 1);
  assert.ok(isLabeledAI(sent[0]), 'Discord bridge message is labeled');
  assert.ok(isLabeledAI(said[0]), 'in-game say is labeled');
});

test('agent is always labeled AI by construction', () => {
  const agent = createAgent({ brain: async () => 'noop' });
  assert.equal(agent.labeledAI, true);
});

test('insecure code-exec is OFF by default', () => {
  const agent = createAgent({ brain: async () => 'noop', options: { game: 'luanti' } });
  assert.equal(agent.codeExec, false, 'default allow_insecure_coding=false');
});

test('resolveInsecureCoding: default-deny, never on public, allowed only on private opt-in', () => {
  assert.equal(resolveInsecureCoding(), false, 'default deny');
  assert.equal(resolveInsecureCoding({ allow_insecure_coding: true, isPublic: true }), false, 'never on public');
  assert.equal(resolveInsecureCoding({ allow_insecure_coding: true, isPublic: false }), true, 'private + opt-in OK');
});

test('insecure coding cannot be enabled on a public server even if requested', () => {
  const agent = createAgent({
    brain: async () => 'noop',
    options: { game: 'minecraft', allow_insecure_coding: true }, // minecraft is public
  });
  assert.equal(agent.codeExec, false, 'public server overrides the opt-in');
});

test('a code action is refused (downgraded to noop) when codeExec is off', async () => {
  const acted = [];
  const brain = async () => ({ type: 'code', code: 'rm -rf /' });
  const game = { act: async (a) => acted.push(a), say: async () => {} };
  const agent = createAgent({ brain, game }); // codeExec false
  const action = await step(agent, {});
  assert.equal(action.type, 'noop', 'code downgraded to noop');
  assert.ok(action.refused, 'refusal reason attached');
  assert.equal(action.code, undefined, 'code payload stripped');
  assert.equal(acted.length, 0, 'game.act not called for refused code');
});

test('normalizeDecision handles strings, action/type objects, and nullish', () => {
  assert.equal(normalizeDecision('Move forward').type, 'move');
  assert.equal(normalizeDecision({ action: 'jump' }).type, 'jump');
  assert.equal(normalizeDecision({ type: 'chat', message: 'hi' }).type, 'chat');
  assert.equal(normalizeDecision({ message: 'hi' }).type, 'chat', 'message-only implies chat');
  assert.equal(normalizeDecision(null).type, 'noop');
  assert.equal(normalizeDecision('').type, 'noop');
});

test('createAgent requires an injected brain function', () => {
  assert.throws(() => createAgent({}), /brain/);
});
