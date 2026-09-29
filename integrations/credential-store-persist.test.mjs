// Persistence for the BYO-key vault (credential-store) + tenant registry (tenant-grants): a restart must
// not lose a user's connected key, and the file on disk must never contain the plaintext key.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'cred-persist-'));
process.env.CREDENTIAL_STORE_PATH = join(dir, 'creds.json');
process.env.TENANT_GRANTS_PATH = join(dir, 'grants.json');
process.env.VAULT_MASTER_KEY = 'a'.repeat(64);

test('a stored key survives a "restart" and only ciphertext is on disk', async () => {
  const v1 = await import('./credential-store.mjs?run=1');
  const g1 = await import('./tenant-grants.mjs?run=1');
  v1.store({ name: 'alice::fal', secret: 'fal-SECRET-123', scope: 'genai:image' });
  g1.connectCapability('alice', { provider: 'fal', capability: 'alice::fal', scopes: ['genai:image'] });

  const raw = readFileSync(process.env.CREDENTIAL_STORE_PATH, 'utf8');
  assert.doesNotMatch(raw, /fal-SECRET-123/);
  assert.equal(statSync(process.env.CREDENTIAL_STORE_PATH).mode & 0o777, 0o600);

  // fresh module instances = a new process reading the files
  const v2 = await import('./credential-store.mjs?run=2');
  const g2 = await import('./tenant-grants.mjs?run=2');
  assert.equal(g2.getCapability('alice', 'fal').capability, 'alice::fal');
  assert.equal(g2.getCapability('bob', 'fal'), null);
  const out = await v2.grant('alice::fal').use((secret) => secret.length);
  assert.equal(out, 'fal-SECRET-123'.length);
});

test('a revoke is persisted too', async () => {
  const v3 = await import('./credential-store.mjs?run=3');
  v3.revoke('alice::fal');
  const v4 = await import('./credential-store.mjs?run=4');
  await assert.rejects(() => v4.grant('alice::fal').use(() => 1), /revoked/);
});
