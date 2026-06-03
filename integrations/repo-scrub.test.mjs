// repo-scrub.test.mjs — offline tests for the repo secret-scrub verifier.
// All fixtures are assembled at RUNTIME so this test file's own source never
// contains a real key literal (which would trip the scanner it tests).
//
// Run: node --test integrations/repo-scrub.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PATTERNS, scanText, scanRepo, isExcluded, report, __setSource,
} from './repo-scrub.mjs';

// --- runtime-assembled secret-shaped fixtures (no literals committed) -------
// WIF: '5' + [HJK] + 49 base58 chars.
const fakeWif = '5' + 'H' + 'mNfr9pXz4qLkW2vTbY8cDgJ7sRhQpUaEoBnMxVwZ1tCdFeG3i'; // shaped, not real
// OpenAI: 'sk-' + 20+ alnum.
const fakeOpenai = 's' + 'k' + '-' + 'AbCdEf0123456789GhIjKlMn';
// private IP infra leak (10.x range).
const fakeIp = '10.' + '20.30.40';

test('PATTERNS is a non-empty detector set with name + severity', () => {
  assert.ok(Array.isArray(PATTERNS) && PATTERNS.length > 0);
  for (const p of PATTERNS) {
    assert.equal(typeof p.pattern, 'string');
    assert.ok(['block', 'warn', 'info'].includes(p.severity));
    assert.ok(p.re instanceof RegExp);
  }
});

test('scanText flags a WIF-shaped string with a redacted snippet (raw NOT present)', () => {
  const text = `const k = "${fakeWif}";`;
  const findings = scanText(text, { path: 'witness/keys.js' });
  const wif = findings.find((f) => f.pattern === 'wif-private-key');
  assert.ok(wif, 'should flag the WIF');
  assert.equal(wif.severity, 'block');
  assert.equal(wif.line, 1);
  assert.equal(wif.path, 'witness/keys.js');
  // redaction: the raw secret must NOT appear in the finding snippet.
  assert.ok(!wif.snippet.includes(fakeWif), 'raw WIF must not survive in snippet');
  assert.ok(wif.snippet.includes('*') || wif.snippet.includes('…'), 'snippet must be masked');
});

test('scanText flags an sk- key, redacted', () => {
  const findings = scanText(`OPENAI=${fakeOpenai}`, { path: 'a.env' });
  const sk = findings.find((f) => f.pattern === 'openai-key');
  assert.ok(sk);
  assert.equal(sk.severity, 'block');
  assert.ok(!sk.snippet.includes(fakeOpenai), 'raw sk- key must not survive');
});

test('scanText flags a private-IP infra leak (warn), redacted', () => {
  const findings = scanText(`ssh user@${fakeIp}`, { path: 'docs/deploy.md' });
  const ip = findings.find((f) => f.pattern === 'private-ipv4');
  assert.ok(ip, 'should flag private IP');
  assert.equal(ip.severity, 'warn');
  assert.ok(!ip.snippet.includes(fakeIp), 'raw IP must not survive in snippet');
});

test('scanText flags an internal hostname infra leak', () => {
  const fakeHost = 'melek' + '-4'; // assembled so THIS test file stays clean
  const findings = scanText(`deploy to ${fakeHost} host`, { path: 'README.md' });
  assert.ok(findings.some((f) => f.pattern === 'internal-hostname' && f.severity === 'warn'));
});

test('scanText returns empty for clean text', () => {
  assert.deepEqual(scanText('just some ordinary prose, nothing secret here.', { path: 'x.md' }), []);
});

test('isExcluded skips .local/, node_modules, .git, and images', () => {
  assert.equal(isExcluded('.local/secrets.env'), true);
  assert.equal(isExcluded('node_modules/foo/index.js'), true);
  assert.equal(isExcluded('.git/config'), true);
  assert.equal(isExcluded('assets/logo.png'), true);
  assert.equal(isExcluded('integrations/repo-scrub.mjs'), false);
});

test('scanRepo skips a .local/ file even if it contains a key', async () => {
  const files = {
    '.local/secrets.env': `WIF=${fakeWif}`, // allowed in .local, must be skipped
    'README.md': 'a clean public file',
  };
  __setSource({
    async list() { return Object.keys(files); },
    async read(p) { return files[p] || ''; },
  });
  const res = await scanRepo();
  __setSource(null);
  assert.equal(res.clean, true, '.local key must not count as a finding');
  assert.equal(res.findings.length, 0);
  assert.equal(res.filesScanned, 1, 'only README.md scanned (.local skipped)');
});

test('scanRepo on a clean fileset → clean:true', async () => {
  const files = { 'a.md': 'hello world', 'b.js': 'export const x = 1;' };
  __setSource({
    async list() { return Object.keys(files); },
    async read(p) { return files[p] || ''; },
  });
  const res = await scanRepo();
  __setSource(null);
  assert.equal(res.clean, true);
  assert.equal(res.bySeverity.block, 0);
  assert.equal(res.bySeverity.warn, 0);
  assert.equal(res.filesScanned, 2);
});

test('scanRepo flags a tracked file with a secret → clean:false', async () => {
  const files = { 'witness/leak.js': `const k = "${fakeWif}";` };
  __setSource({
    async list() { return Object.keys(files); },
    async read(p) { return files[p] || ''; },
  });
  const res = await scanRepo();
  __setSource(null);
  assert.equal(res.clean, false);
  assert.equal(res.bySeverity.block, 1);
  assert.ok(res.findings.every((f) => !f.snippet.includes(fakeWif)), 'no raw secret in any finding');
});

test('scanRepo accepts an explicit files list (uses injected reader)', async () => {
  __setSource({
    async list() { throw new Error('list() must not be called when files passed'); },
    async read() { return 'clean content'; },
  });
  const res = await scanRepo({ files: ['only.md'] });
  __setSource(null);
  assert.equal(res.clean, true);
  assert.equal(res.filesScanned, 1);
});

test('report renders a clean verdict', () => {
  const out = report({ findings: [], filesScanned: 5, bySeverity: { block: 0, warn: 0, info: 0 }, clean: true });
  assert.match(out, /clean ✅/);
  assert.match(out, /REPORT ONLY/);
});

test('report renders findings by severity, redacted, paths only', () => {
  const result = {
    filesScanned: 3,
    clean: false,
    bySeverity: { block: 1, warn: 1, info: 0 },
    findings: [
      { pattern: 'wif-private-key', severity: 'block', line: 2, snippet: '5H…*****', path: 'witness/keys.js' },
      { pattern: 'private-ipv4', severity: 'warn', line: 7, snippet: '10.…***', path: 'docs/deploy.md' },
    ],
  };
  const out = report(result);
  assert.match(out, /NOT clean ❌/);
  assert.match(out, /wif-private-key/);
  assert.match(out, /witness\/keys\.js:2/);
  assert.match(out, /private-ipv4/);
  assert.ok(!out.includes(fakeWif));
});

test('module exposes no write/redact-file path (report-only by construction)', async () => {
  const mod = await import('./repo-scrub.mjs');
  const names = Object.keys(mod);
  // none of the exports should be a file-mutating operation
  for (const n of names) {
    assert.ok(!/write|redactFile|edit|fix|scrub(File|Repo)?Write|save/i.test(n), `unexpected mutating export: ${n}`);
  }
});
