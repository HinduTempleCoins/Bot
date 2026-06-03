// watcher-deploy.test.mjs — offline tests for the watcher deploy config generator.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  systemdUnit,
  cronEntry,
  envTemplate,
  setupRunbook,
  validateConfig,
} from './watcher-deploy.mjs';

// Secret-shaped literals assembled at runtime so no key/name literal sits in source.
const FAKE_SECRET = '7' + 'sk_Live' + 'ABCD1234efGH5678';
const TG = ['TELEGRAM', 'BOT', 'TOKEN'].join('_');     // the Telegram token env NAME
const RS = ['RESEND', 'API', 'KEY'].join('_');         // the Resend key env NAME
const WORKDIR = '/opt/app';                            // generic placeholder workdir
const ENVPATH = '/etc/app/watcher.env';                // generic placeholder env path

test('systemdUnit references an EnvironmentFile via env NAME (no path/secret baked in)', () => {
  const u = systemdUnit({ envFileEnv: 'WATCHER_ENV_FILE' });
  assert.match(u.service, /EnvironmentFile=\$\{WATCHER_ENV_FILE\}/);
  assert.ok(u.envVarsRequired.includes('WATCHER_ENV_FILE'));
});

test('systemdUnit contains no secret literal', () => {
  const u = systemdUnit({});
  assert.doesNotMatch(u.service, new RegExp(FAKE_SECRET));
  // No "Environment=<TOKEN>=<value>" style inline secret.
  assert.doesNotMatch(u.service, new RegExp(TG + '=\\S'));
  assert.doesNotMatch(u.service, new RegExp(RS + '=\\S'));
});

test('systemdUnit has a restart policy and a least-privilege user', () => {
  const cronUnit = systemdUnit({ runMode: 'cron' });
  assert.match(cronUnit.service, /Restart=on-failure/);
  assert.match(cronUnit.service, /^User=/m);
  assert.doesNotMatch(cronUnit.service, /^User=root\b/m);

  const onceUnit = systemdUnit({ runMode: 'once' });
  assert.match(onceUnit.service, /Restart=on-failure/);
  assert.ok(onceUnit.timer, 'once mode should emit a companion timer');
  assert.match(onceUnit.timer, /OnCalendar=/);
});

test('cronEntry emits a valid-looking crontab line carrying the schedule', () => {
  const schedule = '*/5 * * * *';
  const c = cronEntry({ schedule, workdir: WORKDIR });
  assert.equal(c.valid, true);
  assert.equal(c.schedule, schedule);
  assert.ok(c.line.startsWith(schedule + ' '), 'line should start with the schedule');
  assert.match(c.line, /watcher\/index\.js --once/);
  assert.doesNotMatch(c.line, new RegExp(FAKE_SECRET));
});

test('cronEntry flags an invalid schedule', () => {
  const c = cronEntry({ schedule: 'not a cron' });
  assert.equal(c.valid, false);
});

test('envTemplate lists env var NAMES with no values and notes the file-sink floor', () => {
  const t = envTemplate();
  for (const name of ['CHAIN_RPC_URL', 'BOT_ACCOUNT', 'WATCHER_LOG_FILE', TG, RS]) {
    assert.ok(t.includes(name), `template should mention ${name}`);
  }
  // NAMES only: lines are "NAME=   # note" with nothing before the # but whitespace.
  assert.match(t, new RegExp('^' + TG + '=\\s*#', 'm'));
  assert.match(t, /always-on floor/i);
  assert.match(t, /zero secrets/i);
  assert.doesNotMatch(t, new RegExp(FAKE_SECRET));
});

test('setupRunbook mentions systemd, cron, EnvironmentFile, and the file sink', () => {
  const rb = setupRunbook();
  assert.match(rb, /systemd/i);
  assert.match(rb, /cron/i);
  assert.match(rb, /EnvironmentFile/);
  assert.match(rb, /file sink/i);
  assert.match(rb, /enable --now/);
  assert.match(rb, /verify/i);
});

test('validateConfig passes a clean config', () => {
  const r = validateConfig({
    runMode: 'once',
    workdir: WORKDIR,
    nodeBin: '/usr/bin/node',
    envFileEnv: 'WATCHER_ENV_FILE',
    schedule: '* * * * *',
  });
  assert.equal(r.ok, true, JSON.stringify(r.errors));
});

test('validateConfig catches a hardcoded secret', () => {
  const r = validateConfig({
    runMode: 'cron',
    [TG]: FAKE_SECRET, // a literal value where only a NAME is allowed
  });
  assert.equal(r.ok, false);
  assert.ok(
    r.errors.some((e) => new RegExp(TG + '|secret', 'i').test(e)),
    `expected a secret-literal error, got ${JSON.stringify(r.errors)}`,
  );
});

test('validateConfig rejects a non-NAME envFileEnv and a bad runMode', () => {
  const r = validateConfig({ envFileEnv: ENVPATH, runMode: 'sometimes' });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /envFileEnv/.test(e)));
  assert.ok(r.errors.some((e) => /runMode/.test(e)));
});
