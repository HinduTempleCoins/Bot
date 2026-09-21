// sync-recovered.test.mjs — fully offline. In-memory fake fs; no network, no real disk, no keys.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  apiEventToEntry, washApiSessionText, stageDigest, syncRecovered, handler,
} from './sync-recovered.mjs';

const NOW = 1_700_000_000_000;

// ── apiEventToEntry ──────────────────────────────────────────────────────────────────────────────
test('apiEventToEntry keeps a real operator turn and washes it', () => {
  const ev = {
    event_type: 'user', created_at: '2026-09-14T00:00:00Z', event_id: 'e1',
    payload: { type: 'user', message: { role: 'user', content: 'send it from 203.0.113.9 please' } },
  };
  const entry = apiEventToEntry(ev);
  assert.equal(entry.type, 'user');
  assert.equal(entry.message.role, 'user');
  assert.match(entry.message.content, /\[REDACTED:ip\]/);   // IP redacted by the shared wash()
  assert.doesNotMatch(entry.message.content, /203\.0\.113\.9/);
});

test('apiEventToEntry drops tool_result user turns (not the operator)', () => {
  const ev = { payload: { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', content: 'x' }] } } };
  assert.equal(apiEventToEntry(ev), null);
});

test('apiEventToEntry drops harness-injected synthetic turns', () => {
  const ev = { payload: { type: 'user', message: { role: 'user', content: '[Subagent hand-back] done' } } };
  assert.equal(apiEventToEntry(ev), null);
});

test('apiEventToEntry keeps an assistant turn, truncated to the digest length', () => {
  const long = 'A'.repeat(5000);
  const entry = apiEventToEntry({ payload: { type: 'assistant', message: { content: [{ type: 'text', text: long }] } } }, { digest: 100 });
  assert.equal(entry.type, 'assistant');
  assert.equal(entry.message.content.length, 100);
});

test('apiEventToEntry drops side-chain (subagent) user turns but keeps assistant', () => {
  assert.equal(apiEventToEntry({ payload: { type: 'user', isSidechain: true, message: { content: 'hi' } } }), null);
  const a = apiEventToEntry({ payload: { type: 'assistant', parent_tool_use_id: 'x', message: { content: [{ type: 'text', text: 'ok' }] } } });
  assert.equal(a.type, 'assistant');
});

test('apiEventToEntry returns null for control/system/junk', () => {
  assert.equal(apiEventToEntry({ event_type: 'control_request', payload: { type: 'control_request' } }), null);
  assert.equal(apiEventToEntry(null), null);
  assert.equal(apiEventToEntry({}), null);
});

// ── washApiSessionText ───────────────────────────────────────────────────────────────────────────
test('washApiSessionText converts an array of events to washed jsonl with stats', () => {
  const arr = [
    { payload: { type: 'user', message: { content: 'what did we do?' } } },
    { payload: { type: 'assistant', message: { content: [{ type: 'text', text: 'we shipped X' }] } } },
    { payload: { type: 'system', message: { content: 'noise' } } },
    { event_type: 'control_request', payload: { type: 'control_request' } },
  ];
  const { jsonl, stats } = washApiSessionText(JSON.stringify(arr));
  assert.equal(stats.events, 4);
  assert.equal(stats.operator, 1);
  assert.equal(stats.assistant, 1);
  assert.equal(stats.dropped, 2);
  const lines = jsonl.trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(lines.length, 2);
  assert.equal(lines[0].message.content, 'what did we do?');
});

test('washApiSessionText soft-fails to empty on bad JSON', () => {
  const { jsonl, stats } = washApiSessionText('not json');
  assert.equal(jsonl, '');
  assert.equal(stats.events, 0);
});

test('washApiSessionText handles {events:[...]} wrapper shape', () => {
  const { stats } = washApiSessionText(JSON.stringify({ events: [{ payload: { type: 'user', message: { content: 'hi there' } } }] }));
  assert.equal(stats.operator, 1);
});

// ── stageDigest ──────────────────────────────────────────────────────────────────────────────────
test('stageDigest names the annal so annal-harvester SIGNAL (/^_synthesis/) matches', () => {
  const s = stageDigest('DIGEST_melek4_sept13-17.md', '# recovered window\nkey 203.0.113.5', { now: NOW });
  assert.match(s.name, /^_synthesis\.recovered-/);
  assert.match(s.name, /\.md$/);
  assert.match(s.body, /recovered corpus/);
  assert.doesNotMatch(s.body, /203\.0\.113\.5/);   // re-washed for safety
});

test('stageDigest keeps a name already starting with _synthesis', () => {
  assert.equal(stageDigest('_synthesis.foo.md', 'x').name, '_synthesis.foo.md');
});

// ── syncRecovered (fake fs) ──────────────────────────────────────────────────────────────────────
function fakeFs(files) {
  const written = {};
  const dirs = {};
  for (const [p, v] of Object.entries(files)) {
    const d = p.slice(0, p.lastIndexOf('/'));
    (dirs[d] = dirs[d] || []).push(p.slice(p.lastIndexOf('/') + 1));
  }
  return {
    written,
    mkdirSync() {},
    readdirSync(d) { if (dirs[d]) return dirs[d]; throw new Error('ENOENT'); },
    readFileSync(p) { if (p in files) return files[p]; throw new Error('ENOENT ' + p); },
    writeFileSync(p, data) { written[p] = data; },
    statSync(p) { return { size: Buffer.byteLength(files[p] || ''), mtimeMs: NOW }; },
  };
}

test('syncRecovered washes sessions → transcripts and digests → annals', () => {
  const files = {
    'sess/cse_A.api.json': JSON.stringify([
      { payload: { type: 'user', message: { content: 'remember the legal case' } } },
      { payload: { type: 'assistant', message: { content: [{ type: 'text', text: 'the Paxton review' }] } } },
    ]),
    'sess/notes.txt': 'ignored — wrong extension',
    'dig/DIGEST_one.md': '# digest one\ncontent',
    'dig/DIGEST_two.md': '# digest two\ncontent',
    'dig/gmail-lists.md': 'a@b.com\nc@d.com — raw PII list, must NOT be staged as an annal',
  };
  const fsmod = fakeFs(files);
  const m = syncRecovered({ sessionsDir: 'sess', digestsDir: 'dig', outDir: 'out', fsmod, now: NOW });

  assert.equal(m.stats.sessions, 1);
  assert.equal(m.stats.digests, 2);   // gmail-lists.md filtered out (not a DIGEST_/synthesis file)
  assert.ok(!Object.keys(fsmod.written).some((p) => /gmail-lists/.test(p)));
  assert.deepEqual(m.transcripts, ['cse_A.jsonl']);
  assert.equal(m.annals.length, 2);
  assert.ok(m.annals.every((n) => n.startsWith('_synthesis.recovered-')));
  // files actually written to the right compartments
  assert.ok('out/transcripts/cse_A.jsonl' in fsmod.written);
  assert.ok(Object.keys(fsmod.written).some((p) => p.startsWith('out/annals/_synthesis.recovered-DIGEST_one')));
  assert.match(fsmod.written['out/transcripts/cse_A.jsonl'], /the Paxton review/);
});

test('syncRecovered soft-fails on missing dirs and returns an empty manifest', () => {
  const m = syncRecovered({ sessionsDir: 'nope', digestsDir: 'gone', outDir: 'out', fsmod: fakeFs({}), now: NOW });
  assert.equal(m.stats.sessions, 0);
  assert.equal(m.stats.digests, 0);
  assert.deepEqual(m.transcripts, []);
  assert.deepEqual(m.annals, []);
});

test('syncRecovered skips an over-large session rather than OOM', () => {
  const files = { 'sess/big.api.json': '[]' };
  const fsmod = fakeFs(files);
  fsmod.statSync = () => ({ size: 999 * 1024 * 1024 });
  const m = syncRecovered({ sessionsDir: 'sess', digestsDir: 'x', outDir: 'out', fsmod, now: NOW });
  assert.equal(m.stats.sessions, 0);
  assert.ok(m.skipped.some((s) => /too large/.test(s)));
});

test('handler emits the manifest as JSON', () => {
  let body = '', code = 0;
  const res = { writeHead(c) { code = c; }, end(b) { body = b; } };
  handler({}, res, { transcripts: ['a.jsonl'], annals: [], skipped: [], stats: { sessions: 1 } });
  assert.equal(code, 200);
  assert.deepEqual(JSON.parse(body).transcripts, ['a.jsonl']);
});
