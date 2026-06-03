// n8n-config.test.mjs — offline tests for the n8n self-host config generator (task #109).
// node:test, no network, no secrets. Run: node --test integrations/n8n-config.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  dockerCompose,
  envTemplate,
  starterWorkflows,
  setupRunbook,
  validateConfig,
} from './n8n-config.mjs';

// A literal that MUST never appear in any generated artifact (stand-in for a real secret value).
const SECRET_LITERAL = 'abcd1234efgh5678ijkl9012';

// ---- dockerCompose: env NAMES, no secret literal, encryption key + basic auth -----------------

test('dockerCompose references env NAMES via ${...} and sets the encryption key by name', () => {
  const { yaml } = dockerCompose();
  // encryption key set via env NAME, not a value
  assert.match(yaml, /N8N_ENCRYPTION_KEY=\$\{N8N_ENCRYPTION_KEY\}/);
  // basic auth enabled + user/pass by env NAME
  assert.match(yaml, /N8N_BASIC_AUTH_ACTIVE=true/);
  assert.match(yaml, /N8N_BASIC_AUTH_USER=\$\{N8N_BASIC_AUTH_USER\}/);
  assert.match(yaml, /N8N_BASIC_AUTH_PASSWORD=\$\{N8N_BASIC_AUTH_PASSWORD\}/);
  // webhook URL by env NAME
  assert.match(yaml, /WEBHOOK_URL=\$\{N8N_WEBHOOK_URL\}/);
});

test('dockerCompose contains NO secret literal anywhere', () => {
  const custom = dockerCompose({ dbType: 'postgres' });
  assert.ok(!custom.yaml.includes(SECRET_LITERAL), 'secret literal must not appear in compose');
  // sanity: no obvious password=<value> patterns (only ${...} references allowed)
  assert.ok(!/PASSWORD=(?!\$\{)[^\s]+/.test(custom.yaml), 'no inline password values');
});

test('dockerCompose binds to localhost only (raw port not public)', () => {
  const { yaml } = dockerCompose();
  assert.match(yaml, /127\.0\.0\.1:5678:5678/);
});

test('dockerCompose adds a postgres service only when dbType=postgres', () => {
  const sqlite = dockerCompose({ dbType: 'sqlite' });
  assert.ok(!/image: postgres/.test(sqlite.yaml));
  assert.match(sqlite.yaml, /DB_TYPE=sqlite/);

  const pg = dockerCompose({ dbType: 'postgres' });
  assert.match(pg.yaml, /image: postgres/);
  assert.match(pg.yaml, /DB_TYPE=postgresdb/);
  assert.match(pg.yaml, /DB_POSTGRESDB_PASSWORD=\$\{N8N_DB_POSTGRESDB_PASSWORD\}/);
  assert.ok(pg.envVarsRequired.includes('N8N_DB_POSTGRESDB_PASSWORD'));
});

test('dockerCompose uses no host-specific IPs or server names (generic only)', () => {
  const { yaml } = dockerCompose({ dbType: 'postgres' });
  // only localhost is allowed; no other dotted-quad IPs
  const ips = yaml.match(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g) || [];
  assert.deepEqual([...new Set(ips)], ['127.0.0.1']);
});

// ---- envTemplate: NAMES only, no values -------------------------------------------------------

test('envTemplate lists env NAMES with NO values and notes the vault', () => {
  const { text, envVarsRequired } = envTemplate();
  assert.ok(envVarsRequired.includes('N8N_ENCRYPTION_KEY'));
  assert.ok(envVarsRequired.includes('N8N_BASIC_AUTH_PASSWORD'));
  // each required name appears as "NAME=" with nothing after the = (end of line)
  for (const name of envVarsRequired) {
    const re = new RegExp(`^${name}=\\s*$`, 'm');
    assert.match(text, re, `${name} should be present with no value`);
  }
  assert.match(text, /vault/i);
  // no secret literal leaked in
  assert.ok(!text.includes(SECRET_LITERAL));
});

test('envTemplate includes postgres NAMES when dbType=postgres', () => {
  const { envVarsRequired } = envTemplate({ dbType: 'postgres' });
  assert.ok(envVarsRequired.includes('N8N_DB_POSTGRESDB_PASSWORD'));
});

// ---- starterWorkflows: valid n8n workflow JSON, no secrets ------------------------------------

test('starterWorkflows return valid n8n workflow JSON (nodes + connections)', () => {
  const wfs = starterWorkflows();
  assert.ok(Array.isArray(wfs) && wfs.length >= 1 && wfs.length <= 2);
  for (const wf of wfs) {
    // round-trips through JSON (serializable)
    const parsed = JSON.parse(JSON.stringify(wf));
    assert.equal(typeof parsed.name, 'string');
    assert.ok(Array.isArray(parsed.nodes) && parsed.nodes.length > 0, 'has nodes');
    assert.equal(typeof parsed.connections, 'object');
    assert.ok(parsed.connections && !Array.isArray(parsed.connections), 'connections is an object');
    // each node has the required n8n shape
    for (const node of parsed.nodes) {
      assert.equal(typeof node.name, 'string');
      assert.equal(typeof node.type, 'string');
      assert.ok(Array.isArray(node.position));
    }
  }
});

test('starterWorkflows reference credentials by NAME only and embed no secret', () => {
  const json = JSON.stringify(starterWorkflows());
  assert.ok(!json.includes(SECRET_LITERAL), 'no secret literal');
  // any credential reference uses the {id, name} shape with an empty id (bound in the UI)
  const wfs = starterWorkflows();
  for (const wf of wfs) {
    for (const node of wf.nodes) {
      if (node.credentials) {
        for (const cred of Object.values(node.credentials)) {
          assert.equal(typeof cred.name, 'string');
          assert.equal(cred.id, '', 'credential id must be empty (bound in n8n UI), never a token');
        }
      }
    }
  }
  // workflows are MELEK-relevant
  assert.match(json, /MELEK|Hathor/);
});

// ---- setupRunbook: mentions the key steps -----------------------------------------------------

test('setupRunbook mentions docker-compose, encryption key, Caddy, basic auth', () => {
  const md = setupRunbook();
  assert.match(md, /docker compose up/);
  assert.match(md, /N8N_ENCRYPTION_KEY/);
  assert.match(md, /Caddy/);
  assert.match(md, /basic auth/i);
  // hardening + verify + vault sourcing
  assert.match(md, /vault/i);
  assert.match(md, /CrowdSec/);
  assert.match(md, /Verify/i);
  // no secret literal
  assert.ok(!md.includes(SECRET_LITERAL));
});

// ---- validateConfig: structural + no-secret-literal -------------------------------------------

test('validateConfig accepts a clean env-NAME-only config', () => {
  const r = validateConfig({ dbType: 'sqlite' });
  assert.equal(r.ok, true, JSON.stringify(r.errors));
});

test('validateConfig catches a hard-coded secret literal', () => {
  const r = validateConfig({ dbType: 'sqlite', encKeyEnv: SECRET_LITERAL });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /secret literal/i.test(e)), JSON.stringify(r.errors));
});

test('validateConfig rejects a non-env-NAME and a bad dbType', () => {
  const bad = validateConfig({ dbType: 'mysql', basicAuthUserEnv: 'lower case value' });
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.some((e) => /dbType/.test(e)));
  assert.ok(bad.errors.some((e) => /basicAuthUserEnv/.test(e)));
});

test('validateConfig requires postgres env NAMES when dbType=postgres', () => {
  const r = validateConfig({ dbType: 'postgres', dbPassEnv: '' });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /dbPassEnv/.test(e)));
});

test('validateConfig never throws on garbage input', () => {
  for (const junk of [null, undefined, 42, 'str', []]) {
    const r = validateConfig(junk);
    assert.equal(typeof r.ok, 'boolean');
    assert.ok(Array.isArray(r.errors));
  }
});
