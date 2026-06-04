// keys.test.js — GUARD-ONLY offline test for the Hathor key loader.
//
// ZERO-WIF: this test NEVER sets, materializes, prints, or asserts any private key. It only
// exercises the boolean guards (hasPostingKey/hasActiveKey) and the account default in the
// absence of any key env var. The module reads env once at import-time, so to guarantee a
// key-free environment regardless of how the test runner was launched, we import keys.js in a
// child process whose env has HATHOR_POSTING_KEY / HATHOR_ACTIVE_KEY / HATHOR_ACCOUNT removed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const keysPath = fileURLToPath(new URL('./keys.js', import.meta.url));

// Run a snippet importing keys.js in a child with the key env vars stripped; return parsed JSON.
function runWithCleanEnv(snippet) {
  const env = { ...process.env };
  delete env.HATHOR_POSTING_KEY;
  delete env.HATHOR_ACTIVE_KEY;
  delete env.HATHOR_ACCOUNT;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', snippet], {
    env, encoding: 'utf8',
  });
  assert.equal(r.status, 0, `child exited non-zero:\n${r.stderr}`);
  return JSON.parse(r.stdout.trim());
}

test('keys: has*Key() guards are false when no key env vars are set', () => {
  const out = runWithCleanEnv(`
    const m = await import(${JSON.stringify(keysPath)});
    // Only booleans cross the process boundary — never a key value.
    console.log(JSON.stringify({ posting: m.hasPostingKey(), active: m.hasActiveKey() }));
  `);
  assert.equal(out.posting, false);
  assert.equal(out.active, false);
});

test('keys: getAccount() returns the default "hathor" when HATHOR_ACCOUNT is unset', () => {
  const out = runWithCleanEnv(`
    const m = await import(${JSON.stringify(keysPath)});
    console.log(JSON.stringify({ account: m.getAccount() }));
  `);
  assert.equal(out.account, 'hathor');
});

test('keys: getPostingKey()/getActiveKey() throw (not return) when unconfigured', () => {
  // The child reports only the ERROR TYPE + a flag — never any key material — so we confirm the
  // guard throws rather than yielding a value.
  const out = runWithCleanEnv(`
    const m = await import(${JSON.stringify(keysPath)});
    const res = {};
    try { m.getPostingKey(); res.posting = 'returned'; } catch { res.posting = 'threw'; }
    try { m.getActiveKey(); res.active = 'returned'; } catch { res.active = 'threw'; }
    console.log(JSON.stringify(res));
  `);
  assert.equal(out.posting, 'threw');
  assert.equal(out.active, 'threw');
});
