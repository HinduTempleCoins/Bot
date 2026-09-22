// soapy-conference.test.mjs — fully offline. No network, no disk outside injected fakes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  hathorVoice, loraVoice, gatherSince, wake, recordContribution, handler, esc,
} from './soapy-conference.mjs';

const NOW = 1_700_000_000_000;

function fakeRes() {
  return {
    code: 0, headers: null, body: '',
    writeHead(c, h) { this.code = c; this.headers = h; },
    end(b) { this.body = b || ''; },
  };
}

test('esc() escapes every interpolation vector', () => {
  assert.equal(esc('<a href="x">&\'</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
  assert.equal(esc(null), '');
});

test('hathorVoice speaks from the LoRA when the window is open', async () => {
  let seen = null;
  const voice = hathorVoice({
    generate: async (prompt, opts) => { seen = { prompt, opts }; return { ok: true, text: '  I am Hathor.  ' }; },
    fallback: async () => 'SHOULD NOT BE REACHED',
  });
  assert.equal(await voice('who are you'), 'I am Hathor.');   // trimmed, and the LoRA wins
  assert.equal(seen.prompt, 'who are you');
  assert.equal(seen.opts.maxTokens, 240);
});

test('hathorVoice falls back to the local stack when the GPU window is closed', async () => {
  const cold = hathorVoice({
    generate: async () => ({ ok: false, reason: 'no-url' }),   // scaled to zero — normal, not an error
    fallback: async () => 'from the decades stack',
  });
  assert.equal(await cold('x'), 'from the decades stack');

  const threw = hathorVoice({
    generate: async () => { throw new Error('cold start timeout'); },
    fallback: async () => 'still answered',
  });
  assert.equal(await threw('x'), 'still answered');
});

test('hathorVoice returns empty rather than borrowing another voice', async () => {
  const nothing = hathorVoice({});
  assert.equal(await nothing('x'), '');                       // no LoRA, no fallback → silence

  const allDown = hathorVoice({
    generate: async () => ({ ok: false }),
    fallback: async () => { throw new Error('smol down'); },
  });
  assert.equal(await allDown('x'), '');                       // never throws out of the voice

  assert.equal(await hathorVoice({ generate: async () => ({ ok: true, text: 'x' }) })(''), '');
});

test('loraVoice binds without importing the LoRA client at module load', async () => {
  const voice = await loraVoice({ generate: async () => ({ ok: true, text: 'bound' }) });
  assert.equal(await voice('x'), 'bound');
});

test('gatherSince returns only files touched inside the window, newest first', async () => {
  const files = {
    '/a/new.md': { mtimeMs: NOW - 1000, text: 'fresh annal' },
    '/a/old.md': { mtimeMs: NOW - 40 * 60 * 60 * 1000, text: 'stale annal' },
    '/a/skip.txt': { mtimeMs: NOW, text: 'not markdown' },
    '/b/brief.md': { mtimeMs: NOW - 2000, text: 'a brief' },
  };
  const got = await gatherSince({
    now: NOW,
    dirs: { annals: '/a', briefs: '/b' },
    readdir: async (d) => Object.keys(files).filter((f) => f.startsWith(d + '/')).map((f) => f.split('/').pop()),
    stat: async (p) => ({ mtimeMs: files[p].mtimeMs }),
    readFile: async (p) => files[p].text,
  });
  assert.equal(got.annals.length, 1);                        // old.md excluded, skip.txt excluded
  assert.match(got.annals[0], /fresh annal/);
  assert.equal(got.briefs.length, 1);
  assert.match(got.briefs[0], /a brief/);
});

test('gatherSince soft-fails on a missing directory', async () => {
  const got = await gatherSince({
    now: NOW,
    dirs: { annals: '/nope', briefs: '/nope' },
    readdir: async () => { throw new Error('ENOENT'); },
  });
  assert.deepEqual(got.annals, []);
  assert.deepEqual(got.briefs, []);
});

test('wake speaks only when tick clears the salience floor', async () => {
  const quiet = await wake({
    now: NOW,
    hathor: { tick: async () => ({ initiatives: [] }) },      // nothing salient
    gather: async () => ({ annals: ['a'], briefs: [], at: NOW }),
  });
  assert.equal(quiet.spoke, false);
  assert.equal(quiet.contribution, '');
  assert.equal(quiet.saw, 1);

  const loud = await wake({
    now: NOW,
    hathor: { tick: async () => ({ initiatives: [{ surface: 'conference', utterance: 'The pool has no miners.' }] }) },
    gather: async () => ({ annals: ['a', 'b'], briefs: ['c'], at: NOW }),
  });
  assert.equal(loud.spoke, true);
  assert.equal(loud.contribution, 'The pool has no miners.');
  assert.equal(loud.saw, 3);
});

test('wake passes the conference surface and a zero cooldown to tick', async () => {
  let args = null;
  await wake({
    now: NOW,
    hathor: { tick: async (a) => { args = a; return { initiatives: [] }; } },
    gather: async () => ({ annals: ['x'], briefs: ['y'], at: NOW }),
  });
  assert.equal(args.surfaces[0].name, 'conference');
  assert.deepEqual(args.surfaces[0].recent, ['y', 'x']);      // briefs first, then annals
  assert.equal(args.cooldownMs, 0);                           // a scheduled wake never self-throttles
  assert.equal(args.now, NOW);
});

test('wake soft-fails when the brain is absent or throws', async () => {
  const none = await wake({ now: NOW });
  assert.equal(none.spoke, false);
  assert.equal(none.error, 'no hathor');

  const broken = await wake({
    now: NOW,
    hathor: { tick: async () => { throw new Error('brain down'); } },
    gather: async () => ({ annals: [], briefs: [], at: NOW }),
  });
  assert.equal(broken.spoke, false);                          // no throw escapes
});

test('recordContribution writes only when she actually spoke', async () => {
  const written = [];
  const opts = {
    dir: '/conf',
    mkdir: async () => {},
    writeFile: async (p, t) => { written.push({ p, t }); },
  };
  const silent = await recordContribution({ spoke: false, at: NOW }, opts);
  assert.equal(silent.written, false);
  assert.equal(written.length, 0);

  const spoke = await recordContribution(
    { spoke: true, contribution: 'Miners are at zero.', at: NOW, saw: 4 }, opts,
  );
  assert.equal(spoke.written, true);
  assert.equal(written.length, 1);
  assert.match(written[0].t, /Miners are at zero\./);
  assert.match(written[0].t, /read 4 item\(s\)/);
  assert.match(written[0].p, /^\/conf\/soapy-/);
});

test('handler: healthz, unknown route, and never throwing', async () => {
  const ok = fakeRes();
  await handler({ url: '/healthz', method: 'GET', headers: {} }, ok);
  assert.equal(ok.code, 200);
  assert.equal(JSON.parse(ok.body).ok, true);

  const missing = fakeRes();
  await handler({ url: '/nope', method: 'GET', headers: {} }, missing);
  assert.equal(missing.code, 404);

  const bad = fakeRes();
  await handler({ url: null, method: 'GET', headers: {} }, bad);  // malformed → soft, not a throw
  assert.equal(bad.code, 200);
  assert.equal(JSON.parse(bad.body).ok, false);
});
