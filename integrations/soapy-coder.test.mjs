// soapy-coder.test.mjs — offline tests for the always-free AI coding assistant. Fully offline: an
// in-memory fs replaces the memory file, and an injected router replaces llm-router so NOTHING hits the
// network. Asserts the "always free" and "persistent memory" contracts.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ask, remember, recall, forget, capabilities, buildSystem, BASE_SYSTEM,
  proposeJob, handler, __setAuth, __setRouter, __setFs, __setJobRunner,
} from './soapy-coder.mjs';

// in-memory fs (single JSON file) + a fixed file path
function memFs() {
  let mem = null;
  return {
    fs: { read: () => mem, write: (_p, s) => { mem = s; return true; } },
    file: '/in-memory/soapy-coder-memory.json',
    peek: () => mem,
  };
}
function mockRes() {
  return { code: 0, headers: null, body: '', writeHead(c, h) { this.code = c; this.headers = h; }, end(b) { this.body = b == null ? '' : String(b); } };
}

test('remember + recall: persistent, newest-last, per-project', () => {
  const m = memFs();
  __setFs(m.fs);
  const opts = { file: m.file };
  remember({ project: 'alpha', role: 'user', text: 'first' }, opts);
  remember({ project: 'alpha', role: 'assistant', text: 'second' }, opts);
  remember({ project: 'beta', role: 'user', text: 'other' }, opts);
  return recall('alpha', opts).then((h) => {
    assert.equal(h.length, 2);
    assert.equal(h[1].text, 'second');
    return recall('beta', opts).then((hb) => { assert.equal(hb.length, 1); assert.equal(hb[0].text, 'other'); });
  }).finally(() => __setFs(null));
});

test('remember: empty text is ignored', () => {
  const m = memFs(); __setFs(m.fs);
  const r = remember({ project: 'x', text: '   ' }, { file: m.file });
  assert.equal(r.ok, false);
  __setFs(null);
});

test('forget clears a project', async () => {
  const m = memFs(); __setFs(m.fs);
  const opts = { file: m.file };
  remember({ project: 'p', text: 'a' }, opts);
  forget('p', opts);
  assert.equal((await recall('p', opts)).length, 0);
  __setFs(null);
});

test('capabilities(): freeOnly is always true; fal/modal/codespace marked not-live by default', () => {
  const c = capabilities();
  assert.equal(c.freeOnly, true);
  assert.equal(c.memory, true);
  // keyless backstop → llm always has at least one usable provider
  assert.equal(typeof c.llmReady, 'boolean');
  assert.match(c.fal.note, /not live/);
  assert.ok('wired' in c.codespace);
});

test('ask: routes through the injected router, never sets a paid preference', async () => {
  const m = memFs(); __setFs(m.fs);
  let seenOpts = null;
  __setRouter(async (prompt, opts) => { seenOpts = opts; return { text: 'here is the fix', provider: 'groq', model: 'llama' }; });
  const r = await ask('how do I add a test?', { project: 'proj', file: m.file });
  assert.equal(r.ok, true);
  assert.equal(r.reply, 'here is the fix');
  assert.equal(r.provider, 'groq');
  // never a paid/gemini preference
  assert.ok(!('prefer' in (seenOpts || {})) || seenOpts.prefer !== 'gemini');
  assert.match(seenOpts.system, /ALWAYS FREE|always free/i);
  // the exchange was persisted (user + assistant)
  const h = await recall('proj', { file: m.file });
  assert.equal(h.length, 2);
  __setRouter(null); __setFs(null);
});

test('ask: recalled memory is folded into the prompt', async () => {
  const m = memFs(); __setFs(m.fs);
  const opts = { file: m.file };
  remember({ project: 'ctx', role: 'user', text: 'we use ESM only' }, opts);
  let seenPrompt = '';
  __setRouter(async (prompt) => { seenPrompt = prompt; return { text: 'ok', provider: 'p', model: 'm' }; });
  await ask('add a module', { project: 'ctx', file: m.file });
  assert.match(seenPrompt, /we use ESM only/);
  __setRouter(null); __setFs(null);
});

test('ask: empty message → { ok:false, reason:empty }', async () => {
  const r = await ask('   ');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'empty');
});

test('ask: router returns no text → soft-fail, no throw', async () => {
  const m = memFs(); __setFs(m.fs);
  __setRouter(async () => ({ text: '', error: 'all providers failed' }));
  const r = await ask('x', { project: 'z', file: m.file });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'all providers failed');
  __setRouter(null); __setFs(null);
});

test('buildSystem: carries house-style context + optional extra', () => {
  assert.match(BASE_SYSTEM, /esc\(\)/);
  const s = buildSystem({ extraContext: 'FILE: foo.mjs' });
  assert.match(s, /FILE: foo\.mjs/);
});

test('proposeJob: delegates to the injected runner, never shells out here', async () => {
  let got = null;
  __setJobRunner(async (cmd, args) => { got = { cmd, args }; return { ok: true, id: 'job-1' }; });
  const r = await proposeJob('git status', null);
  assert.equal(r.ok, true);
  assert.equal(got.cmd, 'git status');
  __setJobRunner(null);
});

test('handler: default-deny 401; authed serves page, capabilities, send', async () => {
  __setAuth(() => false);
  let res = mockRes();
  await handler({ url: '/coder', method: 'GET' }, res);
  assert.equal(res.code, 401);

  __setAuth(() => true);
  const m = memFs(); __setFs(m.fs);
  __setRouter(async () => ({ text: 'reply', provider: 'groq', model: 'llama' }));

  res = mockRes();
  await handler({ url: '/coder', method: 'GET' }, res);
  assert.equal(res.code, 200);
  assert.match(res.body, /Soapy Coder/);
  assert.match(res.body, /Always free/i);

  res = mockRes();
  await handler({ url: '/coder/capabilities', method: 'GET' }, res);
  assert.equal(JSON.parse(res.body).freeOnly, true);

  res = mockRes();
  await handler({ url: '/coder/send', method: 'POST', body: { text: 'hi', project: 'h', file: m.file } }, res, { file: m.file });
  assert.equal(JSON.parse(res.body).ok, true);

  __setAuth(() => false); __setRouter(null); __setFs(null);
});
