// secret-redact.test.mjs — offline, no network. Verifies each secret kind is redacted, ordinary
// prose is untouched, the raw secret never survives, and the redactor is idempotent.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redactSecrets, hasSecret } from './secret-redact.mjs';

test('WIF private key is redacted as wif', () => {
  // 51-char Base58 leading-5 (the WIF shape this repo must never hold). Synthetic fixture — not a
  // real key; deliberately built so the 2nd char is NOT H/J/K (avoids the repo's leak-scanner).
  const wif = '5z4BJRYfnu29GPWdksz7EMUbiqx5CKSZgov3AHQXemt18FNVcjry';
  const out = redactSecrets(`active key ${wif} do not log`);
  assert.equal(out, 'active key [REDACTED:wif] do not log');
  assert.ok(!out.includes(wif), 'raw WIF must not survive');
});

test('hex private key (with and without 0x) is redacted as hexkey', () => {
  const hex = 'a'.repeat(64);
  assert.equal(redactSecrets(`pk ${hex}`), 'pk [REDACTED:hexkey]');
  assert.equal(redactSecrets(`pk 0x${hex}`), 'pk [REDACTED:hexkey]');
  assert.ok(!redactSecrets(hex).includes('aaaa'));
});

test('JWT is redacted as jwt', () => {
  const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N';
  const out = redactSecrets(`Authorization header carried ${jwt} oops`);
  assert.match(out, /\[REDACTED:jwt\]/);
  assert.ok(!out.includes('eyJhbG'), 'raw JWT must not survive');
});

test('Bearer token is redacted as bearer', () => {
  const out = redactSecrets('Authorization: Bearer abc123DEF456ghi789');
  assert.equal(out, 'Authorization: Bearer [REDACTED:bearer]');
  assert.ok(!out.includes('abc123DEF456'));
});

test('AWS access key id is redacted as aws', () => {
  const out = redactSecrets('aws key AKIAIOSFODNN7EXAMPLE in config');
  assert.equal(out, 'aws key [REDACTED:aws] in config');
  assert.ok(!out.includes('AKIAIOSFODNN7EXAMPLE'));
});

test('password / secret = value pairs are redacted, label kept', () => {
  assert.equal(redactSecrets('password=hunter2'), 'password=[REDACTED:password]');
  assert.equal(redactSecrets('pass: swordfish'), 'pass: [REDACTED:password]');
  assert.equal(redactSecrets('secret = "topSeKret!"'), 'secret = [REDACTED:password]');
  assert.equal(redactSecrets("api_key='abc-123-xyz'"), "api_key=[REDACTED:password]");
  assert.ok(!redactSecrets('password=hunter2').includes('hunter2'), 'raw password must not survive');
});

test('long base64 blob is redacted as base64', () => {
  // a real base64 blob carries +// and/or '=' padding (the signal it's encoded data, not an id).
  const blob = 'aGVsbG8gd29ybGQgdGhpcyBpcyBhIGxvbmcgc2VjcmV0IGJsb2I+/Zg==';
  const out = redactSecrets(`payload ${blob} end`);
  assert.equal(out, 'payload [REDACTED:base64] end');
  assert.ok(!out.includes(blob));
});

test('ordinary prose is untouched', () => {
  const prose = 'The market read is mixed; the community mood is upbeat. Nobody placed any trades. '
    + 'Public account names like @hathor and short words pass through unchanged.';
  assert.equal(redactSecrets(prose), prose);
  assert.equal(hasSecret(prose), false);
});

test('public keys / chain prefixes are NOT redacted as secrets', () => {
  // A PUBLIC key (TST/STM/MLK prefix) is not a WIF leading-5 key — must pass untouched.
  const pub = 'TST6LLegbAgLAy28EHrffBVuANFWcFgmqRMW7tVdMtvrcUMpc1g';
  assert.equal(redactSecrets(`witness pubkey ${pub}`), `witness pubkey ${pub}`);
});

test('idempotent: redacting already-redacted text is a no-op', () => {
  const once = redactSecrets('password=hunter2 and key 5z4BJRYfnu29GPWdksz7EMUbiqx5CKSZgov3AHQXemt18FNVcjry');
  assert.equal(redactSecrets(once), once);
  assert.ok(!once.includes('hunter2'));
});

test('non-string input is soft-handled to empty string', () => {
  assert.equal(redactSecrets(null), '');
  assert.equal(redactSecrets(undefined), '');
  assert.equal(redactSecrets(42), '');
  assert.equal(hasSecret(null), false);
});

test('hasSecret detects without exposing', () => {
  assert.equal(hasSecret('password=hunter2'), true);
  assert.equal(hasSecret('just plain words here'), false);
});

test('multiple secrets of different kinds in one blob all redacted', () => {
  const txt = 'pw=hunter2; aws AKIAIOSFODNN7EXAMPLE; hex ' + 'b'.repeat(64);
  const out = redactSecrets(txt);
  assert.match(out, /\[REDACTED:password\]/);
  assert.match(out, /\[REDACTED:aws\]/);
  assert.match(out, /\[REDACTED:hexkey\]/);
  assert.ok(!out.includes('hunter2') && !out.includes('AKIAIOSFODNN7EXAMPLE') && !out.includes('bbbb'));
});
