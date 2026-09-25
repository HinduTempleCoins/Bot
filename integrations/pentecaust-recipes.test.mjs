// pentecaust-recipes.test.mjs — OFFLINE. No network. Pure engine: validation, matching, templating,
// and dispatch to injected connectors. Asserts secrets never live in a recipe and never leak to reports.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TRIGGERS, ACTIONS, triggerTypes, actionTypes,
  validateRecipe, matchTrigger, renderTemplate, runRecipe,
  looksLikeRawToken, COND_OPS, esc,
} from './pentecaust-recipes.mjs';

const goodRecipe = () => ({
  id: 'r1', name: 'Big donation', enabled: true,
  trigger: { type: 'donation', conditions: [{ field: 'amount', op: 'gte', value: 10 }] },
  actions: [
    { type: 'play-animation', animation: 'confetti', durationMs: 3000 },
    { type: 'post-to-discord', tokenRef: 'creator42-discord', channelId: '111', template: '{{from}} gave {{amount}} {{currency}}' },
    { type: 'post-to-telegram', tokenRef: 'creator42-telegram', chatId: '@grp', template: 'Donation: {{amount}}' },
  ],
});

test('vocabulary is well-formed', () => {
  assert.deepEqual(triggerTypes().sort(), ['donation', 'new-chain-post', 'schedule', 'went-live']);
  assert.ok(actionTypes().includes('post-to-discord'));
  assert.ok(actionTypes().includes('cross-post'));
  for (const [k, v] of Object.entries(TRIGGERS)) assert.equal(v.type, k);
  for (const spec of Object.values(ACTIONS)) assert.ok(Array.isArray(spec.params) && Array.isArray(spec.secretParams));
});

test('validateRecipe accepts a good recipe', () => {
  const v = validateRecipe(goodRecipe());
  assert.equal(v.valid, true, JSON.stringify(v.errors));
});

test('validateRecipe rejects unknown trigger and empty actions', () => {
  assert.equal(validateRecipe({ trigger: { type: 'nope' }, actions: [{ type: 'play-animation', animation: 'x' }] }).valid, false);
  assert.equal(validateRecipe({ trigger: { type: 'donation' }, actions: [] }).valid, false);
  assert.equal(validateRecipe(null).valid, false);
});

test('validateRecipe rejects a RAW TOKEN pasted where a vault ref belongs', () => {
  const r = goodRecipe();
  // build a telegram-token-shaped string at runtime so the literal isn't a token in source
  r.actions[1].tokenRef = '1234567890' + ':' + 'AAH' + 'x'.repeat(30);
  const v = validateRecipe(r);
  assert.equal(v.valid, false);
  assert.ok(v.errors.some((e) => /RAW TOKEN/.test(e)), 'flags the raw token');
});

test('validateRecipe requires channelId / chatId / targets / animation', () => {
  const missingChan = validateRecipe({ trigger: { type: 'went-live' }, actions: [{ type: 'post-to-discord', tokenRef: 'ref' }] });
  assert.ok(missingChan.errors.some((e) => /channelId/.test(e)));
  const badCross = validateRecipe({ trigger: { type: 'went-live' }, actions: [{ type: 'cross-post', targets: [] }] });
  assert.ok(badCross.errors.some((e) => /targets/.test(e)));
});

test('looksLikeRawToken catches Discord + Telegram shapes, passes vault slugs', () => {
  assert.equal(looksLikeRawToken('1234567890:AAH' + 'x'.repeat(30)), true);
  assert.equal(looksLikeRawToken('MTk4Nj' + 'a'.repeat(20) + '.Cl2FMQ.' + 'b'.repeat(25)), true);
  assert.equal(looksLikeRawToken('creator42-discord'), false);
  assert.equal(looksLikeRawToken(''), false);
});

test('matchTrigger honors type, enabled flag, and conditions', () => {
  const r = goodRecipe();
  assert.equal(matchTrigger(r, { type: 'donation', amount: 25 }), true);
  assert.equal(matchTrigger(r, { type: 'donation', amount: 5 }), false, 'below threshold');
  assert.equal(matchTrigger(r, { type: 'went-live' }), false, 'wrong type');
  assert.equal(matchTrigger({ ...r, enabled: false }, { type: 'donation', amount: 25 }), false, 'disabled');
});

test('COND_OPS cover the operator set', () => {
  assert.equal(COND_OPS.gte(10, 10), true);
  assert.equal(COND_OPS.lt(3, 5), true);
  assert.equal(COND_OPS.contains('Hello World', 'world'), true);
  assert.equal(COND_OPS.in('a', ['a', 'b']), true);
  assert.equal(COND_OPS.ne('x', 'y'), true);
});

test('renderTemplate fills dot-paths, drops unknowns, stays plain text', () => {
  const s = renderTemplate('{{from}} gave {{amount}} {{missing}} to {{nested.name}}', { from: 'alice', amount: 25, nested: { name: 'show' } });
  assert.equal(s, 'alice gave 25  to show');
  // ampersand is NOT html-escaped (chat body, not HTML)
  assert.equal(renderTemplate('{{a}}', { a: 'you & me' }), 'you & me');
});

test('runRecipe dispatches matched actions to injected connectors', async () => {
  const calls = [];
  const connectors = {
    'play-animation': async (p) => { calls.push(['anim', p.animation]); return { ok: true }; },
    'post-to-discord': async (p) => { calls.push(['discord', p.channelId, p.text, p.tokenRef]); return { ok: true, messageId: 'm1' }; },
    'post-to-telegram': async (p) => { calls.push(['tg', p.chatId, p.text]); return { ok: true }; },
  };
  const report = await runRecipe(goodRecipe(), { type: 'donation', amount: 25, currency: 'USD', from: 'alice' }, { connectors });
  assert.equal(report.triggered, true);
  assert.equal(report.ok, true);
  assert.equal(report.actions.length, 3);
  assert.deepEqual(calls[1], ['discord', '111', 'alice gave 25 USD', 'creator42-discord']);
  // payload carries the tokenRef by NAME only — the connector resolves the real secret itself
  assert.ok(calls[1][3] === 'creator42-discord');
});

test('runRecipe does not fire when the event misses the trigger', async () => {
  const report = await runRecipe(goodRecipe(), { type: 'donation', amount: 2 }, { connectors: {} });
  assert.equal(report.triggered, false);
  assert.equal(report.actions.length, 0);
});

test('runRecipe isolates a failing/throwing connector', async () => {
  const connectors = {
    'play-animation': async () => { throw new Error('overlay down'); },
    'post-to-discord': async () => ({ ok: false, error: 'rate limited' }),
    'post-to-telegram': async () => ({ ok: true }),
  };
  const report = await runRecipe(goodRecipe(), { type: 'donation', amount: 25 }, { connectors });
  assert.equal(report.triggered, true);
  assert.equal(report.ok, false);
  assert.equal(report.actions[0].ok, false);
  assert.match(report.actions[0].error, /overlay down/);
  assert.equal(report.actions[1].ok, false);
  assert.equal(report.actions[2].ok, true);
});

test('runRecipe skips actions with no connector rather than throwing', async () => {
  const report = await runRecipe(goodRecipe(), { type: 'donation', amount: 25 }, { connectors: {} });
  assert.ok(report.actions.every((a) => a.skipped));
});

test('runRecipe redacts any secret a connector echoes back', async () => {
  const connectors = { 'post-to-discord': async () => ({ ok: true, token: 'SUPERSECRET', messageId: 'm' }) };
  const r = { id: 'x', enabled: true, trigger: { type: 'went-live' }, actions: [{ type: 'post-to-discord', tokenRef: 'ref', channelId: '1', template: 'live' }] };
  const report = await runRecipe(r, { type: 'went-live' }, { connectors });
  assert.equal(report.actions[0].result.token, '[redacted]');
  assert.notEqual(JSON.stringify(report).includes('SUPERSECRET'), true);
});

test('dryRun renders payloads without invoking connectors', async () => {
  let called = false;
  const report = await runRecipe(goodRecipe(), { type: 'donation', amount: 25, from: 'bob', currency: 'EUR' }, { connectors: { 'post-to-discord': async () => { called = true; return { ok: true }; } }, dryRun: true });
  assert.equal(called, false);
  assert.ok(report.actions.every((a) => a.dryRun && a.ok));
});

test('esc escapes HTML for any HTML surface', () => {
  assert.equal(esc('<b>&"\'</b>'), '&lt;b&gt;&amp;&quot;&#39;&lt;/b&gt;');
});
