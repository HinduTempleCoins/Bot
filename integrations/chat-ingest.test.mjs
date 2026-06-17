// chat-ingest.test.mjs — offline. Uses a temp dir + SYNTHETIC secret-shaped values (built at runtime so
// no real key/IP/host literal lives in the repo). node --test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sanitizeText, classifyDoc, ingestDir } from './chat-ingest.mjs';

// synthetic, non-real values whose SHAPE matches the redaction patterns
const FAKE_WIF = '5J' + 'a'.repeat(49);             // WIF-shaped (base58), not a real key
const FAKE_IP = [10, 20, 30, 40].join('.');         // built so no IPv4 literal is in source
const FAKE_PRIV = '0x' + 'b'.repeat(64);            // 32-byte-hex-shaped
const FAKE_HOST = 'server-3';                        // matches the GENERIC_HOST pattern (not a real host)

test('sanitizeText redacts keys, IPs, emails, hosts (synthetic inputs)', () => {
  const { clean, redactions } = sanitizeText(`key ${FAKE_WIF} at ${FAKE_IP} on ${FAKE_HOST}, mail dev@x.example, priv ${FAKE_PRIV}`);
  assert.match(clean, /\[WIF-REDACTED\]/);
  assert.match(clean, /\[IP-REDACTED\]/);
  assert.match(clean, /\[EMAIL-REDACTED\]/);
  assert.match(clean, /\[HOST-REDACTED\]/);
  assert.match(clean, /\[PRIVKEY-REDACTED\]/);
  assert.ok(!clean.includes(FAKE_WIF) && !clean.includes(FAKE_IP));
  assert.ok(Object.values(redactions).reduce((a, b) => a + b, 0) >= 5);
});

test('env REDACT_HOSTS adds named hosts to the redaction set', () => {
  const prev = process.env.REDACT_HOSTS;
  process.env.REDACT_HOSTS = 'coolbox,otherbox';
  const { clean } = sanitizeText('deployed to coolbox and otherbox');
  assert.ok(!clean.includes('coolbox') && !clean.includes('otherbox'));
  assert.match(clean, /\[HOST-REDACTED\]/);
  if (prev === undefined) delete process.env.REDACT_HOSTS; else process.env.REDACT_HOSTS = prev;
});

test('classifyDoc keeps a real paper, skips secrets/short/non-text', () => {
  const paper = { name: 'phoenician-bridge.md', text: 'A'.repeat(500) + '\nReal research content about the corpus.\n'.repeat(10) };
  assert.equal(classifyDoc(paper).keep, true);
  assert.equal(classifyDoc({ name: 'private-keys.md', text: 'x'.repeat(600) }).keep, false); // private-by-name
  assert.equal(classifyDoc({ name: 'note.md', text: 'short' }).keep, false);                 // too-short
  assert.equal(classifyDoc({ name: 'pic.png', text: 'x'.repeat(600) }).keep, false);         // not-a-text-doc
  // secret-heavy dump: many keys relative to size
  const dump = { name: 'd.md', text: Array.from({ length: 30 }, () => FAKE_PRIV).join('\n') + '\n' + 'x'.repeat(420) };
  assert.equal(classifyDoc(dump).keep, false);
});

test('ingestDir stages clean papers + a manifest; skips the private ones', () => {
  const src = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-src-'));
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-dest-'));
  fs.writeFileSync(path.join(src, 'paper.md'), 'Research on the convergence. ' + 'content '.repeat(120) + ' contact dev@x.example');
  fs.writeFileSync(path.join(src, 'secret.env'), 'KEY=' + FAKE_WIF);
  fs.writeFileSync(path.join(src, 'tiny.md'), 'hi');
  const r = ingestDir(src, dest);
  assert.equal(r.kept.length, 1);
  assert.equal(r.kept[0].name, 'paper.md');
  const staged = fs.readFileSync(path.join(dest, 'paper.md'), 'utf8');
  assert.match(staged, /\[EMAIL-REDACTED\]/);          // redaction applied to the staged copy
  assert.ok(fs.existsSync(path.join(dest, 'manifest.json')));
  assert.ok(r.skipped.find((s) => s.file === 'secret.env'));
  assert.ok(r.skipped.find((s) => s.file === 'tiny.md' && s.reason === 'too-short'));
});

test('ingestDir dryRun classifies without writing', () => {
  const src = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-src2-'));
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-dest2-'));
  fs.writeFileSync(path.join(src, 'p.md'), 'A real paper. ' + 'words '.repeat(120));
  const r = ingestDir(src, dest, { dryRun: true });
  assert.equal(r.kept.length, 1);
  assert.ok(!fs.existsSync(path.join(dest, 'p.md'))); // nothing written
});
