import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseTranscript, buildContext, logSoapyTurn, loadConversations, __resetContextCache } from './soapy-context.mjs';

const L = (o) => JSON.stringify(o);
const jsonl = [
  L({ type: 'user', timestamp: '2026-09-29T08:00:00Z', message: { role: 'user', content: 'Queue the Carthage film <system-reminder>secret hook noise</system-reminder>' } }),
  L({ type: 'assistant', timestamp: '2026-09-29T08:00:05Z', message: { role: 'assistant', content: [{ type: 'thinking', thinking: 'private' }, { type: 'text', text: 'Queued Carthage as a 30-minute film.' }, { type: 'tool_use', name: 'Bash', input: { command: 'rm -rf /' } }] } }),
  L({ type: 'user', timestamp: '2026-09-29T08:01:00Z', message: { role: 'user', content: [{ type: 'tool_result', content: 'ok\n<system-reminder>\nThe user sent a new message while you were working:\nAlso the Phoenician colonies\n\nThis is how Claude Code surfaces messages\n</system-reminder>' }] } }),
  L({ type: 'user', isMeta: true, message: { role: 'user', content: 'meta noise' } }),
  'not json',
].join('\n');

test('parseTranscript keeps operator + assistant text, catches mid-turn messages, drops tools/thinking/meta/reminders', () => {
  const t = parseTranscript(jsonl);
  assert.deepEqual(t.map((x) => x.role), ['operator', 'assistant', 'operator']);
  assert.equal(t[0].text, 'Queue the Carthage film');
  assert.equal(t[1].text, 'Queued Carthage as a 30-minute film.');
  assert.equal(t[2].text, 'Also the Phoenician colonies');
  assert.ok(!JSON.stringify(t).includes('rm -rf') && !JSON.stringify(t).includes('private') && !JSON.stringify(t).includes('meta noise'));
});

test('buildContext: rules + memory + recent stretch within budget + relevant older passages', () => {
  const older = { file: 'a.jsonl', turns: [{ role: 'operator', text: 'We want Scheria and the Phaeacians in the queue', ts: '2026-09-28T10:00' }, { role: 'assistant', text: 'Added Scheria.', ts: '2026-09-28T10:01' }, ...Array.from({ length: 50 }, (_, i) => ({ role: 'assistant', text: `filler ${i} `.repeat(40), ts: '' }))] };
  const latest = { file: 'b.jsonl', turns: parseTranscript(jsonl) };
  const c = buildContext('what happened with Scheria?', { convs: [older, latest], memory: '### m.md\nwiki is Gemini territory', rules: '## Don\'t\n- no hathor.network', recentChars: 400, relatedChars: 2000 });
  assert.match(c.system, /CONTINUATION of the operator's working conversations/);
  assert.match(c.system, /wiki is Gemini territory/);
  assert.match(c.system, /no hathor\.network/);
  assert.match(c.system, /## The latest conversation[\s\S]*Also the Phoenician colonies/);
  assert.match(c.system, /## Earlier passages relevant[\s\S]*Scheria and the Phaeacians/);
  assert.ok(c.stats.recentTurns >= 1);
});

test('logSoapyTurn writes transcript-shaped lines the same parser reads back', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'soapy-'));
  assert.equal(logSoapyTurn({ sessionId: 's1', operator: 'Pause production', reply: 'Recorded for the working session.', now: new Date('2026-09-29T12:00:00Z') }, dir), true);
  __resetContextCache();
  const convs = loadConversations(dir);
  assert.equal(convs.length, 1);
  assert.deepEqual(convs[0].turns.map((t) => [t.role, t.text]), [['operator', 'Pause production'], ['assistant', 'Recorded for the working session.']]);
  assert.equal(logSoapyTurn({ operator: 'x', reply: 'y' }, '/nonexistent/dir/zzz'), false); // soft-fail
});
