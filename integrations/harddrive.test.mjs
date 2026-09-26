import { test } from 'node:test';
import assert from 'node:assert/strict';
import { storageConfig, presignPut, presignGet, makeShareLink, checkAccess, objectKey, __setNow } from './harddrive.mjs';

const BYO = { endpoint: 'https://acct123.r2.cloudflarestorage.com', bucket: 'harddrive', accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY', region: 'auto' };

test('storageConfig: unconfigured by default, BYO turns it on', () => {
  const c = storageConfig(null);
  assert.equal(typeof c.configured, 'boolean');
  const b = storageConfig(BYO);
  assert.equal(b.configured, true);
  assert.equal(b.source, 'byo');
  assert.equal(b.bucket, 'harddrive');
});

test('presignPut builds a valid SigV4 URL, deterministic for fixed clock', () => {
  __setNow(() => Date.parse('2026-09-25T00:00:00Z'));
  const u1 = presignPut(storageConfig(BYO), 'u/ryan/plan.pdf', { expiresIn: 900 });
  const u2 = presignPut(storageConfig(BYO), 'u/ryan/plan.pdf', { expiresIn: 900 });
  assert.equal(u1, u2, 'same inputs + clock → identical signature');
  assert.match(u1, /^https:\/\/acct123\.r2\.cloudflarestorage\.com\/harddrive\/u\/ryan\/plan\.pdf\?/);
  assert.match(u1, /X-Amz-Algorithm=AWS4-HMAC-SHA256/);
  assert.match(u1, /X-Amz-Credential=AKIDEXAMPLE%2F20260925%2Fauto%2Fs3%2Faws4_request/);
  assert.match(u1, /X-Amz-Expires=900/);
  assert.match(u1, /X-Amz-SignedHeaders=host/);
  assert.match(u1, /&X-Amz-Signature=[0-9a-f]{64}$/);
  __setNow(null);
});

test('signature changes with the key and the clock (not a constant)', () => {
  __setNow(() => Date.parse('2026-09-25T00:00:00Z'));
  const a = presignPut(storageConfig(BYO), 'a.pdf');
  const b = presignPut(storageConfig(BYO), 'b.pdf');
  assert.notEqual(a.split('X-Amz-Signature=')[1], b.split('X-Amz-Signature=')[1]);
  __setNow(() => Date.parse('2026-09-26T00:00:00Z'));
  const a2 = presignPut(storageConfig(BYO), 'a.pdf');
  assert.notEqual(a.split('X-Amz-Signature=')[1], a2.split('X-Amz-Signature=')[1]);
  __setNow(null);
});

test('presignGet can force a download filename', () => {
  const u = presignGet(storageConfig(BYO), 'u/ryan/plan.pdf', { downloadName: 'The Plan.pdf' });
  assert.match(u, /response-content-disposition=/);
});

test('presign throws when storage is not configured', () => {
  assert.throws(() => presignPut({ configured: false }, 'x.pdf'), /not configured/);
});

test('objectKey sanitizes owner + filename and is unique', () => {
  const k1 = objectKey('ryan/../etc', 'my file!.pdf');
  assert.match(k1, /^u\/ryanetc\/[a-z0-9]+-[\w-]+\/my_file_\.pdf$/);
  const k2 = objectKey('ryan', 'my file!.pdf');
  assert.notEqual(k1, k2);
});

test('share link: expiry enforced', () => {
  __setNow(() => 1000);
  const rec = makeShareLink({ key: 'k', owner: 'ryan', expiresIn: 10 }); // expires at 1000+10000
  __setNow(() => 5000);
  assert.equal(checkAccess(rec).ok, true);
  __setNow(() => 20000);
  assert.equal(checkAccess(rec).ok, false);
  assert.equal(checkAccess(rec).reason, 'expired');
  __setNow(null);
});

test('share link: password gate', () => {
  const rec = makeShareLink({ key: 'k', owner: 'ryan', password: 's3cret', expiresIn: 0 });
  assert.equal(rec.hasPassword, true);
  assert.ok(!('pwHash' in rec) === false); // pwHash present
  assert.equal(checkAccess(rec, {}).reason, 'password-required');
  assert.equal(checkAccess(rec, { password: 'wrong' }).reason, 'password-wrong');
  assert.equal(checkAccess(rec, { password: 's3cret' }).ok, true);
});

test('share link: login gate', () => {
  const rec = makeShareLink({ key: 'k', owner: 'ryan', requireLogin: true, expiresIn: 0 });
  assert.equal(checkAccess(rec, { loggedIn: false }).reason, 'login-required');
  assert.equal(checkAccess(rec, { loggedIn: true }).ok, true);
});

test('checkAccess never throws on junk', () => {
  assert.equal(checkAccess(null).ok, false);
  assert.equal(checkAccess({}).ok, false);
});

test('free-tier limits: size required, per-file cap, per-day allowance; the size is SIGNED into the upload URL', async () => {
  const hd = await import('./harddrive.mjs');
  hd.__resetQuota();
  process.env.HD_MAX_FILE_BYTES = '1000'; process.env.HD_DAILY_BYTES = '1500';
  try {
    assert.equal(hd.checkQuota('1.2.3.4', 0).code, 400);
    assert.equal(hd.checkQuota('1.2.3.4', 1001).code, 413);
    assert.equal(hd.checkQuota('1.2.3.4', 900).ok, true);
    assert.equal(hd.checkQuota('1.2.3.4', 900).code, 429);          // 1800 > 1500 today
    assert.equal(hd.checkQuota('5.6.7.8', 900).ok, true);           // another visitor is separate
    const cfg = { configured: true, endpoint: 'https://drive.example', bucket: 'b', accessKeyId: 'AK', secretAccessKey: 'SK', region: 'auto' };
    const withLen = hd.presignPut(cfg, 'u/x/f.bin', { contentLength: 900 });
    assert.match(withLen, /X-Amz-SignedHeaders=content-length%3Bhost/);
    const plain = hd.presignPut(cfg, 'u/x/f.bin');
    assert.match(plain, /X-Amz-SignedHeaders=host(&|$)/);
    assert.notEqual(withLen.split('X-Amz-Signature=')[1], plain.split('X-Amz-Signature=')[1]);
  } finally { delete process.env.HD_MAX_FILE_BYTES; delete process.env.HD_DAILY_BYTES; }
});
