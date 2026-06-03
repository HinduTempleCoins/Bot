// Tests for forum-setup.mjs — offline, deterministic. Run: node --test integrations/forum-setup.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_FORUMS,
  mybbConfig,
  seedSql,
  setupGuide,
  validateForums,
} from './forum-setup.mjs';

test('DEFAULT_FORUMS validates and includes core SoapBox categories', () => {
  const v = validateForums(DEFAULT_FORUMS);
  assert.equal(v.ok, true, `expected valid, got errors: ${v.errors.join('; ')}`);
  const names = DEFAULT_FORUMS.map((c) => c.name);
  for (const core of ['MELEK Chain', 'SoapBox Data', 'Library', 'Trading', 'Games', 'Bio-NFT', 'Support', 'Off-topic']) {
    assert.ok(names.includes(core), `missing core category "${core}"`);
  }
  // Every category has at least one board.
  for (const c of DEFAULT_FORUMS) assert.ok(c.boards.length >= 1);
});

test('mybbConfig references env var NAMES and contains NO secret literal', () => {
  const cfg = mybbConfig({
    siteUrl: 'https://forums.soapbox.community',
    dbHostEnv: 'FORUM_DB_HOST',
    dbNameEnv: 'FORUM_DB_NAME',
    dbUserEnv: 'FORUM_DB_USER',
    dbPassEnv: 'FORUM_DB_PASS',
    adminEmailEnv: 'FORUM_ADMIN_EMAIL',
  });
  // The env var NAMES appear.
  for (const name of ['FORUM_DB_HOST', 'FORUM_DB_NAME', 'FORUM_DB_USER', 'FORUM_DB_PASS', 'FORUM_ADMIN_EMAIL']) {
    assert.ok(cfg.php.includes(name), `php missing env name ${name}`);
    assert.ok(cfg.envVarsRequired.includes(name), `envVarsRequired missing ${name}`);
  }
  // Credentials are read via getenv(), not assigned literal strings.
  assert.ok(cfg.php.includes("getenv('FORUM_DB_PASS')"), 'password must be read via getenv');
  assert.match(cfg.php, /password.*=\s*getenv\(/, 'password must not be a literal');

  // NO secret literal: the right-hand side of the password assignment must be getenv(NAME), with no
  // inline quoted value other than the env var name. We inspect only the RHS (after the '=').
  const passLine = cfg.php.split('\n').find((l) => l.includes("['password']")) || '';
  const rhs = passLine.slice(passLine.indexOf('=') + 1);
  const quotedRhs = [...rhs.matchAll(/'([^']*)'/g)].map((m) => m[1]);
  for (const q of quotedRhs) {
    assert.equal(q, 'FORUM_DB_PASS', `unexpected literal "${q}" on password RHS — possible secret`);
  }
  assert.ok(rhs.includes("getenv('FORUM_DB_PASS')"), 'password RHS must be getenv(name)');
  // Object form also exposes only the name.
  assert.equal(cfg.object.database.passwordEnv, 'FORUM_DB_PASS');
  assert.equal(cfg.object.database.password, undefined, 'object must not carry a password value');
});

test('mybbConfig soft-fails to defaults on bad input', () => {
  const cfg = mybbConfig(null);
  assert.ok(cfg.php.includes('FORUM_DB_PASS'));
  assert.equal(cfg.object.siteUrl, 'https://forums.soapbox.community');
});

test('seedSql escapes a board name with a quote and emits one INSERT per board', () => {
  const forums = [
    {
      name: "O'Brien's Corner",
      description: 'desc',
      boards: [
        { name: "It's a board", description: 'b1' },
        { name: 'Plain board', description: 'b2' },
      ],
    },
  ];
  const sql = seedSql(forums);
  // Quote doubled, not raw — no unescaped 's a board.
  assert.ok(sql.includes("It''s a board"), 'board quote must be escaped by doubling');
  assert.ok(sql.includes("O''Brien''s Corner"), 'category quote must be escaped');

  // One board INSERT per board (type 'f'), plus one category INSERT (type 'c').
  const boardInserts = (sql.match(/'f',/g) || []).length;
  const catInserts = (sql.match(/'c',/g) || []).length;
  assert.equal(boardInserts, 2, 'expected one INSERT per board');
  assert.equal(catInserts, 1, 'expected one category INSERT');

  // Wrapped in a transaction and clearly a reviewed generator.
  assert.ok(sql.includes('START TRANSACTION'));
  assert.ok(sql.includes('COMMIT'));
  assert.match(sql, /REVIEW BEFORE RUNNING/i);
});

test('seedSql is soft on non-array input', () => {
  const sql = seedSql(undefined);
  // Uses DEFAULT_FORUMS — at least 8 category INSERTs.
  const catInserts = (sql.match(/'c',/g) || []).length;
  assert.ok(catInserts >= 8);
  assert.equal(typeof seedSql(42), 'string');
});

test('setupGuide returns markdown mentioning Caddy, DNS and vault', () => {
  const md = setupGuide();
  assert.equal(typeof md, 'string');
  assert.ok(md.includes('Caddy'), 'guide must mention Caddy');
  assert.ok(/dns/i.test(md), 'guide must mention DNS');
  assert.ok(/vault/i.test(md), 'guide must mention the vault');
  assert.ok(md.includes('forums.soapbox.community'));
  // Has a hardening checklist.
  assert.ok(md.includes('hardening') || md.includes('Hardening'));
});

test('validateForums catches malformed entries', () => {
  // Not an array.
  assert.equal(validateForums('nope').ok, false);
  // Missing name + no boards.
  const bad = [{ description: 'x', boards: [] }];
  const v = validateForums(bad);
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((e) => /missing name/.test(e)));
  assert.ok(v.errors.some((e) => /at least one board/.test(e)));
  // Duplicate board names.
  const dup = [{ name: 'C', description: '', boards: [{ name: 'B', description: '' }, { name: 'B', description: '' }] }];
  const vd = validateForums(dup);
  assert.equal(vd.ok, false);
  assert.ok(vd.errors.some((e) => /duplicate board/.test(e)));
});
