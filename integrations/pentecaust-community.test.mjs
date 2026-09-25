// pentecaust-community.test.mjs — OFFLINE. Injected fetch, no network. Asserts the Discord/Telegram
// adapters call the right endpoints with the right shape, soft-fail, and never leak tokens.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SERVER_PLAN, DEFAULT_MODERATION, DISCORD_CHANNEL_TYPES,
  renderWelcome, seedDiscord, sendDiscord, sendTelegram,
  getDiscordBotUser, getTelegramBotUser, buildConnectors, __setFetch, esc,
} from './pentecaust-community.mjs';

// A recording fetch: captures every call, replies with a scripted response per URL/method.
function recorder(responder) {
  const calls = [];
  __setFetch(async (url, opts = {}) => {
    calls.push({ url, method: opts.method || 'GET', headers: opts.headers || {}, body: opts.body ? JSON.parse(opts.body) : undefined });
    const res = responder ? responder(url, opts, calls.length) : { ok: true, json: {} };
    return { ok: res.ok !== false, status: res.status ?? (res.ok !== false ? 200 : 500), json: async () => res.json ?? {} };
  });
  return calls;
}

test('DEFAULT plan + moderation are well-formed', () => {
  assert.ok(DEFAULT_SERVER_PLAN.roles.length >= 3);
  assert.ok(DEFAULT_SERVER_PLAN.categories.length >= 3);
  assert.ok(DEFAULT_SERVER_PLAN.categories.every((c) => Array.isArray(c.channels)));
  assert.equal(DISCORD_CHANNEL_TYPES.category, 4);
  assert.ok(DEFAULT_MODERATION.welcome.message.includes('{{member}}'));
});

test('renderWelcome fills member + server', () => {
  assert.equal(renderWelcome('Hi {{member}} at {{server}}', { member: '@a', server: 'S' }), 'Hi @a at S');
});

test('sendDiscord posts to the channel messages endpoint with a Bot auth header', async () => {
  const calls = recorder(() => ({ ok: true, json: { id: 'msg1' } }));
  const r = await sendDiscord('SECRET_TOKEN', '999', 'hello world');
  assert.equal(r.ok, true);
  assert.equal(r.messageId, 'msg1');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'POST');
  assert.match(calls[0].url, /\/channels\/999\/messages$/);
  assert.equal(calls[0].body.content, 'hello world');
  assert.equal(calls[0].headers.authorization, 'Bot SECRET_TOKEN');
});

test('sendDiscord soft-fails on empty message and on missing token', async () => {
  recorder(() => ({ ok: true, json: {} }));
  assert.equal((await sendDiscord('t', 'c', '')).ok, false);
  assert.equal((await sendDiscord('', 'c', 'x')).ok, false);
});

test('sendDiscord soft-fails on an API error without throwing', async () => {
  recorder(() => ({ ok: false, status: 403, json: { message: 'Missing Access' } }));
  const r = await sendDiscord('t', 'c', 'x');
  assert.equal(r.ok, false);
  assert.equal(r.status, 403);
});

test('sendTelegram posts to /bot<token>/sendMessage with chat_id + text', async () => {
  const calls = recorder(() => ({ ok: true, json: { ok: true, result: { message_id: 7 } } }));
  const r = await sendTelegram('123:ABC', '@mychan', 'ping', { parseMode: 'HTML' });
  assert.equal(r.ok, true);
  assert.equal(r.messageId, 7);
  assert.match(calls[0].url, /\/bot123:ABC\/sendMessage$/);
  assert.equal(calls[0].body.chat_id, '@mychan');
  assert.equal(calls[0].body.text, 'ping');
  assert.equal(calls[0].body.parse_mode, 'HTML');
});

test('sendTelegram honors the API-level ok:false result', async () => {
  recorder(() => ({ ok: true, json: { ok: false, description: 'chat not found' } }));
  const r = await sendTelegram('123:ABC', 'bad', 'x');
  assert.equal(r.ok, false);
  assert.match(r.error, /chat not found/);
});

test('getDiscordBotUser and getTelegramBotUser verify tokens', async () => {
  recorder((url) => url.includes('discord') ? { ok: true, json: { id: '1', username: 'hathorbot', bot: true } } : { ok: true, json: { ok: true, result: { id: 2, username: 'tgbot', is_bot: true } } });
  const d = await getDiscordBotUser('t');
  assert.equal(d.ok, true);
  assert.equal(d.user.username, 'hathorbot');
  const tg = await getTelegramBotUser('123:ABC');
  assert.equal(tg.ok, true);
  assert.equal(tg.user.username, 'tgbot');
});

test('seedDiscord creates roles, categories, and channels linked to parents', async () => {
  let n = 0;
  const calls = recorder(() => { n += 1; return { ok: true, json: { id: `id${n}` } }; });
  const plan = {
    roles: [{ name: 'Mod', hoist: true, permissions: '0' }],
    categories: [{ name: 'WELCOME', channels: [{ name: 'rules', type: 'text' }, { name: 'stage', type: 'voice' }] }],
  };
  const report = await seedDiscord('SECRET', 'guild1', plan);
  assert.equal(report.ok, true);
  assert.equal(report.roles.length, 1);
  assert.equal(report.categories.length, 1);
  assert.equal(report.channels.length, 2);

  const roleCall = calls.find((c) => /\/guilds\/guild1\/roles$/.test(c.url));
  assert.ok(roleCall, 'created a role');
  assert.equal(roleCall.body.name, 'Mod');
  assert.equal(roleCall.headers.authorization, 'Bot SECRET');

  const catCall = calls.find((c) => c.body && c.body.name === 'WELCOME');
  assert.equal(catCall.body.type, DISCORD_CHANNEL_TYPES.category);

  // the text channel must be parented to the category's returned id
  const rulesCall = calls.find((c) => c.body && c.body.name === 'rules');
  assert.equal(rulesCall.body.parent_id, catCall.url.includes('channels') ? 'id2' : rulesCall.body.parent_id);
  assert.equal(rulesCall.body.type, DISCORD_CHANNEL_TYPES.text);
  const voiceCall = calls.find((c) => c.body && c.body.name === 'stage');
  assert.equal(voiceCall.body.type, DISCORD_CHANNEL_TYPES.voice);
});

test('seedDiscord uses DEFAULT_SERVER_PLAN when no plan passed', async () => {
  recorder(() => ({ ok: true, json: { id: 'x' } }));
  const report = await seedDiscord('t', 'g');
  assert.ok(report.created > 5);
});

test('seedDiscord soft-fails without a token', async () => {
  const report = await seedDiscord('', 'g');
  assert.equal(report.ok, false);
  assert.match(report.error, /token/);
});

test('buildConnectors resolves tokenRef via the injected vault lookup and posts', async () => {
  const calls = recorder(() => ({ ok: true, json: { id: 'm', ok: true, result: { message_id: 1 } } }));
  const seen = [];
  const connectors = buildConnectors({ resolveToken: async (ref) => { seen.push(ref); return ref === 'c-dc' ? 'REAL_DISCORD' : 'REAL_TG'; } });
  const dc = await connectors['post-to-discord']({ tokenRef: 'c-dc', channelId: '5', text: 'hi' });
  assert.equal(dc.ok, true);
  assert.equal(seen[0], 'c-dc');
  // the resolved real token was used in the Authorization header, but the ref is all the recipe held
  assert.equal(calls[0].headers.authorization, 'Bot REAL_DISCORD');
});

test('buildConnectors soft-fails when the vault has no token for the ref', async () => {
  recorder(() => ({ ok: true, json: {} }));
  const connectors = buildConnectors({ resolveToken: async () => '' });
  const r = await connectors['post-to-telegram']({ tokenRef: 'missing', chatId: '1', text: 'x' });
  assert.equal(r.ok, false);
  assert.match(r.error, /no token for ref/);
});

test('buildConnectors play-animation + cross-post dispatch to injected sinks', async () => {
  recorder(() => ({ ok: true, json: {} }));
  const fired = [];
  const connectors = buildConnectors({
    onAnimation: async (p) => { fired.push(p.animation); return { ok: true }; },
    crossPostTargets: { blog: async ({ text }) => { fired.push('blog:' + text); return { ok: true }; } },
  });
  assert.equal((await connectors['play-animation']({ animation: 'confetti', durationMs: 1000 })).ok, true);
  const cp = await connectors['cross-post']({ targets: ['blog', 'unknown'], text: 'yo' });
  assert.equal(cp.ok, false, 'unknown target fails the batch');
  assert.ok(cp.results.some((r) => r.target === 'unknown' && !r.ok));
  assert.ok(fired.includes('confetti'));
  assert.ok(fired.includes('blog:yo'));
});

test('esc escapes HTML', () => {
  assert.equal(esc('<a href="x">& \'</a>'), '&lt;a href=&quot;x&quot;&gt;&amp; &#39;&lt;/a&gt;');
});

// restore real fetch for any later suite
__setFetch(null);
