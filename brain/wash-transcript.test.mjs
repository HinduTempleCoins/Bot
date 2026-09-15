import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { wash, isSynthetic, washFile } from './wash-transcript.mjs';

test('wash: strips every non-loopback IPv4 and keeps loopback', () => {
  const out = wash('ssh root@203.0.113.9 then curl http://127.0.0.1:7777/healthz');
  assert.ok(!out.includes('203.0.113.9'));
  assert.ok(out.includes('[REDACTED:ip]'));
  assert.ok(out.includes('127.0.0.1'), 'loopback is not a server address');
});

test('wash: strips key material of every shape we have actually leaked', () => {
  assert.ok(wash('pass is iqgw lemr yfmk jtsq').includes('[REDACTED:app-password]'));
  assert.ok(wash('a'.repeat(63) + '1').includes('[REDACTED:hex-secret]'));
  assert.ok(wash('-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n-----END OPENSSH PRIVATE KEY-----')
    .includes('[REDACTED:key-block]'));
});

test('wash: leaves ordinary prose alone', () => {
  const s = 'PRANA should not be 1 node. Get our Blockchains Working.';
  assert.equal(wash(s), s);
});

test('isSynthetic: harness-injected turns are not operator precedent', () => {
  assert.ok(isSynthetic('Another Claude session sent a message: ...'));
  assert.ok(isSynthetic('This session is being continued from a previous conversation.'));
  assert.ok(isSynthetic('<system-reminder>hi</system-reminder>'));
  assert.ok(!isSynthetic('Fix the blockchains.'));
});

test('washFile: keeps operator words, digests the assistant, drops tool traffic', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'wash-'));
  const src = join(dir, 'in.jsonl'), dst = join(dir, 'out.jsonl');
  writeFileSync(src, [
    JSON.stringify({ type: 'user', uuid: '1', message: { role: 'user', content: 'Fix PRANA on 198.51.100.7' } }),
    JSON.stringify({ type: 'user', uuid: '2', message: { role: 'user', content: [{ type: 'tool_result', content: 'huge output' }] } }),
    JSON.stringify({ type: 'user', uuid: '3', message: { role: 'user', content: 'This session is being continued from a previous conversation.' } }),
    JSON.stringify({ type: 'assistant', uuid: '4', message: { role: 'assistant', content: [{ type: 'text', text: 'x'.repeat(5000) }, { type: 'tool_use', input: { secret: 'y' } }] } }),
  ].join('\n') + '\n');

  const s = await washFile(src, dst, { digest: 100 });
  assert.equal(s.operator, 1);
  assert.equal(s.assistant, 1);
  assert.equal(s.synthetic, 1);

  const lines = readFileSync(dst, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(lines[0].message.content, 'Fix PRANA on [REDACTED:ip]');
  assert.equal(lines[1].message.content.length, 100, 'assistant turn is digested, not stored whole');
  assert.ok(!readFileSync(dst, 'utf8').includes('huge output'), 'tool results never reach the store');
});
