// validate.test.mjs — offline tests for the Azure IaC validator. No network,
// no `az`, no Bicep compiler. Uses the injected reader seam for fixtures, then
// runs once over the REAL deploy/azure files to confirm the shipped IaC passes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as V from './validate.mjs';

const GOOD_BICEP = `
param vmName string = 'melek-node'
@secure() param sshPublicKey string
param vmSize string = 'Standard_B4as_v2'
// NOTE — NO CRYPTO MINING ON AZURE (AUP). Mining stays on the mining box.
linuxConfiguration: { disablePasswordAuthentication: true, ssh: { publicKeys: [ { keyData: sshPublicKey } ] } }
source: '0.0.0.0/32'  private: '10.20.1.0/24'  doc: '203.0.113.4/32'
`;

const GOOD_CLOUD = `#cloud-config
packages: [postgresql, postgresql-contrib]
runcmd:
  - curl -fsSL https://deb.nodesource.com/setup_lts.x | bash -
  - apt-get install -y nodejs
  - git clone --depth 1 https://github.com/pgvector/pgvector.git /tmp/pgvector
  - sudo -u postgres psql -d __BRAIN_DB__ -c "CREATE EXTENSION IF NOT EXISTS vector;"
  - git clone --branch __REPO_BRANCH__ __REPO_URL__ /home/__ADMIN_USER__/Bot
# NO mining on this box (Azure AUP).
`;

function readerFor(map) {
  return (p) => {
    const key = Object.keys(map).find((k) => p.endsWith(k));
    return key ? map[key] : '';
  };
}

test('checkVmSpec: good bicep passes all sub-checks', () => {
  const r = V.checkVmSpec(GOOD_BICEP);
  assert.equal(r.ok, true, JSON.stringify(r.missing));
  assert.equal(r.checks.vmSize, true);
  assert.equal(r.checks.sshKey, true);
  assert.equal(r.checks.noMiningNote, true);
});

test('checkVmSpec: edge — wrong VM size and missing no-mining note fails', () => {
  const r = V.checkVmSpec(`param vmSize string = 'Standard_D2s_v3'  keyData: sshPublicKey  disablePasswordAuthentication: true`);
  assert.equal(r.ok, false);
  assert.ok(r.missing.includes('vmSize'));
  assert.ok(r.missing.includes('noMiningNote'));
});

test('checkVmSpec: edge — a baked private key trips noRealSecret', () => {
  const r = V.checkVmSpec(GOOD_BICEP + '\n-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n');
  assert.equal(r.checks.noRealSecret, false);
  assert.equal(r.ok, false);
});

test('checkCloudInit: good cloud-init passes', () => {
  const r = V.checkCloudInit(GOOD_CLOUD);
  assert.equal(r.ok, true, JSON.stringify(r.missing));
  assert.equal(r.checks.pgvector, true);
  assert.equal(r.checks.repoClonePlaceholder, true);
});

test('checkCloudInit: edge — missing pgvector + missing header fails', () => {
  const r = V.checkCloudInit(`packages: [postgresql]\n- apt-get install -y nodejs\n- git clone __REPO_URL__ x`);
  assert.equal(r.ok, false);
  assert.ok(r.missing.includes('pgvector'));
  assert.ok(r.missing.includes('cloudConfigHeader'));
});

test('checkPublicSafe: placeholders/private/doc IPs allowed; a real public IP flagged', () => {
  assert.equal(V.checkPublicSafe('0.0.0.0/32 10.20.1.0 192.168.0.1 203.0.113.4').ok, true);
  // 198.51.100.x is TEST-NET-2 (RFC 5737) — a reserved documentation block, not a
  // real host, but it is public (not RFC1918/0.0.0.0/203.0.113.x) so the checker flags it.
  const bad = V.checkPublicSafe('connect to 198.51.100.7');
  assert.equal(bad.ok, false);
  assert.deepEqual(bad.offenders, ['198.51.100.7']);
});

test('validate: soft-fails (never throws) on unreadable dir', () => {
  const r = V.validate({ read: () => { throw new Error('boom'); } });
  assert.equal(r.ok, false);
  assert.ok(r.errors.length >= 1);
});

test('validate: passes over injected good fixtures (bicep preferred)', () => {
  const r = V.validate({
    dir: '/fake',
    read: readerFor({ 'main.bicep': GOOD_BICEP, 'vm-create.sh': '', 'cloud-init.yaml': GOOD_CLOUD }),
  });
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal(r.files.vmSpec.source, 'main.bicep');
});

test('validate: real shipped deploy/azure files pass', () => {
  const r = V.validate();
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal(r.files.publicSafe.ok, true, JSON.stringify(r.files.publicSafe.offenders));
});

test('esc escapes HTML metacharacters', () => {
  assert.equal(V.esc(`<a href="x">&'`), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;');
});
