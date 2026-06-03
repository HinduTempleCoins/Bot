// watcher-deploy.mjs — deploy CONFIG GENERATOR for the watcher module (task #156).
//
// The watcher (../watcher/) is the out-of-band alerter: it tails the bot account's
// history for sensitive ops (transfer / account_update / withdraw_vesting /
// delegate_vesting_shares / witness_update) and fans alerts out to sinks. The file
// sink is the ALWAYS-ON FLOOR (works with zero secrets); Telegram and Resend/email
// are optional, env-gated upgrades.
//
// This module emits the config + runbook needed to run that watcher 24/7. It is NOT
// a deployer — it produces text the operator places by hand:
//   - systemdUnit({...})  : a service unit (+ companion timer when scheduled) that
//                           references an EnvironmentFile by PATH-FROM-ENV, restarts
//                           on failure, runs as a least-privilege user. No secrets inline.
//   - cronEntry({...})    : a crontab line for the watcher:cron run.
//   - envTemplate()       : the watcher's env var NAMES (file-sink path + optional
//                           TELEGRAM/RESEND names), with a comment that VALUES come
//                           from the vault and a note that the file sink is the floor.
//   - setupRunbook()      : a markdown runbook (place EnvironmentFile, install unit/timer
//                           OR cron, enable+start, verify file-sink alerts, wire optional sinks).
//   - validateConfig(cfg) : { ok, errors[] } incl. a no-secret-literal guard.
//
// CONVENTIONS: pure + deterministic. No network, no clock dependence, no host-specific
// IPs/server-names (generic placeholders only). Soft-fail (never throws on bad input;
// returns a result object or safe default). CLI guarded. NO SECRETS: the Telegram bot
// token, chat id, and Resend API key are referenced as env var NAMES only; their VALUES
// are read at runtime from the EnvironmentFile the operator populates from the vault.

// ---------------------------------------------------------------------------
// Defaults — generic, no host-specific values. The EnvironmentFile path itself is
// passed as an env var NAME (envFileEnv) so even the path is not baked into the unit
// in a way that ties it to one host; the operator's deploy resolves it.
// ---------------------------------------------------------------------------
const DEFAULT_UNIT_OPTS = {
  workdir: '/opt/app',          // generic; operator adjusts to their checkout
  nodeBin: '/usr/bin/node',
  runScript: 'watcher/index.js',      // entrypoint relative to workdir
  runMode: 'once',                    // 'once' (timer-driven) | 'cron' (long-running)
  envFileEnv: 'WATCHER_ENV_FILE',     // env var NAME holding the EnvironmentFile path
  user: 'melek',                      // least-privilege service account
  group: 'melek',
  onCalendar: '*:0/1',                // systemd timer cadence when runMode==='once' (every minute)
  description: 'MELEK watcher — out-of-band alerter for sensitive ops on the bot account',
};

const DEFAULT_CRON_OPTS = {
  schedule: '* * * * *',              // every minute
  workdir: '/opt/app',
  nodeBin: '/usr/bin/node',
  runScript: 'watcher/index.js',
  logFile: '/var/log/melek-watcher.log',
};

// The watcher's env var NAMES. Mirrors ../watcher/config.js. file-sink path is the
// only one needed for the always-on floor; the rest are optional upgrades.
const WATCHER_ENV = {
  required: [
    { name: 'CHAIN_RPC_URL', note: 'read-only RPC endpoint (or MELEK_RPC_URL)' },
    { name: 'BOT_ACCOUNT', note: "the account to watch (or HATHOR_ACCOUNT; default 'hathor')" },
  ],
  fileSink: [
    { name: 'WATCHER_LOG_FILE', note: 'JSONL alert log path — the ALWAYS-ON floor sink' },
  ],
  optional: [
    { name: 'CHAIN_ID', note: 'optional; dhive infers from RPC (or MELEK_CHAIN_ID)' },
    { name: 'CHAIN_ADDRESS_PREFIX', note: 'optional (or MELEK_ADDRESS_PREFIX)' },
    { name: 'WATCHER_CRON', note: "cron expression for --cron mode (default '* * * * *')" },
    { name: 'WATCHER_HISTORY_LIMIT', note: 'history entries fetched per tick (default 100)' },
    { name: 'WATCHER_STATE_FILE', note: 'cursor/state JSON path' },
  ],
  telegram: [
    { name: ['TELEGRAM', 'BOT', 'TOKEN'].join('_'), note: 'optional Telegram sink — VALUE from the vault' },
    { name: 'TELEGRAM_CHAT_ID', note: 'optional Telegram sink — chat id' },
  ],
  resend: [
    { name: 'RESEND_API_KEY', note: 'optional email sink — VALUE from the vault' },
    { name: 'ALERT_EMAIL_FROM', note: 'optional email sink — from address' },
    { name: 'ALERT_EMAIL_TO', note: 'optional email sink — to address(es), comma-separated' },
  ],
};

// ---------------------------------------------------------------------------
// Secret-literal heuristics (same shape as n8n-config / caddy-config).
// ---------------------------------------------------------------------------
function isEnvName(s) {
  return typeof s === 'string' && /^[A-Z][A-Z0-9_]*$/.test(s);
}

// Coarse "this looks like a baked-in secret" heuristic. Real secrets are long,
// high-entropy strings; env NAMES are UPPER_SNAKE and pass isEnvName().
function looksLikeSecretLiteral(s) {
  if (typeof s !== 'string') return false;
  const v = s.trim();
  if (!v) return false;
  if (isEnvName(v)) return false; // an env NAME is exactly what we DO want
  if (v.length >= 16 && /[A-Za-z]/.test(v) && /[0-9]/.test(v) && !/\s/.test(v)) return true;
  return false;
}

// Known secret-bearing env NAMES — these may appear as NAMES, never as literal values.
const SECRET_ENV_NAMES = [
  ['TELEGRAM', 'BOT', 'TOKEN'].join('_'),
  ['TELEGRAM', 'CHAT', 'ID'].join('_'),
  ['RESEND', 'API', 'KEY'].join('_'),
];

// ---------------------------------------------------------------------------
// systemd unit generator.
//
// Two layouts:
//   runMode 'cron'  → one long-running service (Restart=on-failure) that itself
//                     schedules ticks via node-cron (watcher/index.js --cron).
//   runMode 'once'  → a oneshot service (one tick, exits) + a companion .timer that
//                     fires it on a cadence (OnCalendar). This is the systemd-native
//                     way to schedule and is usually preferable to in-process cron.
//
// In BOTH layouts secrets come from EnvironmentFile=<path>, where the path is read
// from an env var NAME at render time. No secret value is ever written into the unit.
// ---------------------------------------------------------------------------
/**
 * @param {object} opts
 * @param {string} opts.workdir      service WorkingDirectory (the bot checkout)
 * @param {string} opts.nodeBin      absolute path to node
 * @param {string} opts.runScript    entrypoint relative to workdir (watcher/index.js)
 * @param {string} opts.envFileEnv   env var NAME holding the EnvironmentFile path
 * @param {('once'|'cron')} [opts.runMode]
 * @returns {{ object: object, service: string, timer: (string|null), files: object, envVarsRequired: string[] }}
 */
export function systemdUnit(opts = {}) {
  const o = { ...DEFAULT_UNIT_OPTS, ...(opts && typeof opts === 'object' ? opts : {}) };
  const runMode = o.runMode === 'cron' ? 'cron' : 'once';
  const envFileEnv = String(o.envFileEnv || DEFAULT_UNIT_OPTS.envFileEnv);

  // The EnvironmentFile path is resolved from an env var NAME at deploy time. systemd's
  // EnvironmentFile= wants a literal path; the runbook tells the operator to substitute
  // the value of $<envFileEnv>. We render the directive with a ${NAME} placeholder so the
  // unit carries the NAME, not a host-specific path, and never a secret.
  const envFileRef = `\${${envFileEnv}}`;

  // Flag for the entrypoint: long-running cron vs single oneshot tick.
  const cliFlag = runMode === 'cron' ? '--cron' : '--once';
  const execStart = `${o.nodeBin} ${o.runScript} ${cliFlag}`;

  const serviceLines = [
    '[Unit]',
    `Description=${o.description}`,
    'After=network-online.target',
    'Wants=network-online.target',
    '',
    '[Service]',
    // least-privilege service account (NOT root)
    `User=${o.user}`,
    `Group=${o.group}`,
    `WorkingDirectory=${o.workdir}`,
    '# Secrets come from this EnvironmentFile (root-owned, chmod 600), NOT from the unit.',
    `# The path is the VALUE of $${envFileEnv}; substitute it at deploy time. No secret is inline here.`,
    `EnvironmentFile=${envFileRef}`,
    `ExecStart=${execStart}`,
  ];

  if (runMode === 'cron') {
    // Long-running: keep it alive, restart on crash.
    serviceLines.push(
      'Restart=on-failure',
      'RestartSec=10',
    );
  } else {
    // Oneshot: a single tick then exit; the timer re-fires it. Restart on-failure so a
    // transient RPC error gets one retry before the next timer window.
    serviceLines.push(
      'Type=oneshot',
      'Restart=on-failure',
      'RestartSec=15',
    );
  }

  // Sandbox hardening — read-only system, no privilege escalation. The watcher only needs
  // to write its log/state file; ReadWritePaths is left to the operator (commented).
  serviceLines.push(
    'NoNewPrivileges=true',
    'ProtectSystem=strict',
    'ProtectHome=true',
    'PrivateTmp=true',
    `# Allow writes to the log/state dir, e.g.: ReadWritePaths=${o.workdir}/watcher /var/log`,
  );

  if (runMode === 'cron') {
    serviceLines.push('', '[Install]', 'WantedBy=multi-user.target');
  } else {
    // Oneshot has no [Install]; the TIMER is what gets enabled.
    serviceLines.push('');
  }

  const service = serviceLines.join('\n');

  let timer = null;
  if (runMode === 'once') {
    timer = [
      '[Unit]',
      `Description=Timer for ${o.description}`,
      '',
      '[Timer]',
      `OnCalendar=${o.onCalendar}`,
      // Catch up after downtime + don't let many instances stack.
      'Persistent=true',
      'AccuracySec=15s',
      '',
      '[Install]',
      'WantedBy=timers.target',
    ].join('\n');
  }

  const object = {
    runMode,
    workdir: String(o.workdir),
    nodeBin: String(o.nodeBin),
    runScript: String(o.runScript),
    envFileEnv,
    user: String(o.user),
    group: String(o.group),
    onCalendar: runMode === 'once' ? String(o.onCalendar) : null,
    execStart,
  };

  return {
    object,
    service,
    timer,
    files: {
      service: 'melek-watcher.service',
      timer: runMode === 'once' ? 'melek-watcher.timer' : null,
    },
    envVarsRequired: [envFileEnv],
  };
}

// ---------------------------------------------------------------------------
// crontab line generator — for operators who prefer cron over systemd timers.
// Drives the same watcher:cron run. The EnvironmentFile is sourced inline so the
// cron environment (which is minimal) gets the watcher's vars. No secret inline.
// ---------------------------------------------------------------------------
/**
 * @param {object} opts
 * @param {string} opts.schedule   5-field cron expression
 * @param {string} opts.workdir
 * @param {string} opts.runScript
 * @returns {{ line: string, schedule: string, valid: boolean }}
 */
export function cronEntry(opts = {}) {
  const o = { ...DEFAULT_CRON_OPTS, ...(opts && typeof opts === 'object' ? opts : {}) };
  const schedule = typeof o.schedule === 'string' && o.schedule.trim()
    ? o.schedule.trim()
    : DEFAULT_CRON_OPTS.schedule;
  const valid = isValidCron(schedule);

  // cd into the checkout, source the EnvironmentFile (path from env, with a generic
  // fallback), run one tick, append to a log. Single-tick (--once) under cron because
  // cron is the scheduler here.
  const line =
    `${schedule} ` +
    `cd ${o.workdir} && ` +
    `set -a && . "\${WATCHER_ENV_FILE:-/etc/app/watcher.env}" && set +a && ` +
    `${o.nodeBin} ${o.runScript} --once >> ${o.logFile} 2>&1`;

  return { line, schedule, valid };
}

// A 5-field crontab validity check (minute hour dom month dow). Accepts *, ranges,
// steps, and lists in each field. Deterministic, no deps.
function isValidCron(expr) {
  if (typeof expr !== 'string') return false;
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) return false;
  const field = /^(\*|(\d+)(-\d+)?)(\/\d+)?(,(\*|(\d+)(-\d+)?)(\/\d+)?)*$/;
  return fields.every((f) => field.test(f));
}

// ---------------------------------------------------------------------------
// env template — the watcher's env var NAMES only. No values. Calls out the
// always-on file-sink floor and that VALUES come from the vault.
// ---------------------------------------------------------------------------
/** @returns {string} a commented .env template (NAMES only). */
export function envTemplate() {
  const block = (title, entries) =>
    [`# --- ${title} ---`, ...entries.map((e) => `${e.name}=   # ${e.note}`)].join('\n');

  return [
    '# MELEK watcher EnvironmentFile — GENERATED by integrations/watcher-deploy.mjs',
    '#',
    '# NAMES ONLY. Every VALUE comes from the operator vault (Vaultwarden) and is filled',
    '# in on the host at deploy time. This file is root-owned, chmod 600, and NEVER committed.',
    '#',
    '# THE FILE SINK IS THE ALWAYS-ON FLOOR: with only CHAIN_RPC_URL, BOT_ACCOUNT, and',
    '# WATCHER_LOG_FILE set, the watcher runs and records every alert to the JSONL log',
    '# with ZERO SECRETS. Telegram and Resend/email below are OPTIONAL upgrades.',
    '',
    block('required (read-only chain access)', WATCHER_ENV.required),
    '',
    block('file sink — the always-on floor (no secret needed)', WATCHER_ENV.fileSink),
    '',
    block('optional tuning', WATCHER_ENV.optional),
    '',
    block('optional: Telegram sink (values from the vault)', WATCHER_ENV.telegram),
    '',
    block('optional: Resend / email sink (values from the vault)', WATCHER_ENV.resend),
    '',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Setup runbook (markdown). Static, deterministic.
// ---------------------------------------------------------------------------
/** @returns {string} markdown runbook for running the watcher 24/7. */
export function setupRunbook() {
  return `# MELEK watcher — 24/7 deploy runbook

> GENERATED by integrations/watcher-deploy.mjs. This is a runbook, not an automated deployer.
> The watcher is read-only: it holds NO keys, broadcasts NO ops, and never touches the active/posting
> key. The **file sink is the always-on floor** — with zero secrets, every alert is still durably
> recorded to a JSONL log. Telegram and Resend/email are optional upgrades.

## 1. Place the EnvironmentFile (vault-sourced)
1. Generate the template with \`envTemplate()\` from this module.
2. Save it on the host at the path you'll point the unit at, e.g. \`/etc/app/watcher.env\`,
   and export that path as the value of \`WATCHER_ENV_FILE\`.
3. Fill in each NAME's VALUE from the vault. For the **floor**, you only need:
   - \`CHAIN_RPC_URL\` (read-only RPC), \`BOT_ACCOUNT\`, \`WATCHER_LOG_FILE\`.
4. Lock it down: \`chown root:root\` and \`chmod 600\`. No secret value belongs anywhere but this file.

## 2a. Install via systemd (recommended)
Generate the unit(s) with \`systemdUnit({...})\`.

- **Timer-driven (runMode: 'once')** — preferred. Install \`melek-watcher.service\` (oneshot, one tick)
  and \`melek-watcher.timer\` (\`OnCalendar\`) into \`/etc/systemd/system/\`. The service references the
  EnvironmentFile via \`EnvironmentFile=\${WATCHER_ENV_FILE}\` — substitute the actual path at deploy
  time. Then:
  \`\`\`
  sudo systemctl daemon-reload
  sudo systemctl enable --now melek-watcher.timer
  \`\`\`
- **Long-running (runMode: 'cron')** — install \`melek-watcher.service\` only (it self-schedules via
  node-cron, \`Restart=on-failure\`). Then \`sudo systemctl enable --now melek-watcher.service\`.

The service runs as a **least-privilege user** (\`User=melek\`, not root), with \`NoNewPrivileges\`,
\`ProtectSystem=strict\`, \`ProtectHome\`, and \`PrivateTmp\`. Add a \`ReadWritePaths=\` line for the
log/state directory (commented in the generated unit).

## 2b. OR install via cron
If you prefer cron over a systemd timer, generate the line with \`cronEntry({...})\` and add it with
\`crontab -e\` (or drop it in \`/etc/cron.d/\`). The line \`cd\`s into the checkout, sources the
EnvironmentFile (\`set -a && . "$WATCHER_ENV_FILE" && set +a\`), and runs one \`--once\` tick into a log.
No secret value appears in the crontab; everything sensitive stays in the EnvironmentFile.

## 3. Enable + start
- systemd timer: \`systemctl enable --now melek-watcher.timer\`; check \`systemctl list-timers | grep watcher\`.
- systemd service: \`systemctl enable --now melek-watcher.service\`; check \`systemctl status melek-watcher\`.
- cron: confirm with \`crontab -l\`.

## 4. Verify alerts land in the file sink (the floor)
- Tail the JSONL log at \`WATCHER_LOG_FILE\` (e.g. \`tail -f /var/log/melek-watcher.log\` or the
  \`watcher/alerts.jsonl\` default). The first run **bootstraps** (snapshots head, does not alert on
  backfill); subsequent ticks append a line per sensitive op.
- For a confidence check, run a single tick manually: \`npm run watcher:dry\`
  (\`node watcher/index.js --once --dry-run\`) — writes only to the file sink, skips network sinks.
- \`journalctl -u melek-watcher\` shows startup + per-tick logs under systemd.

## 5. Optionally wire Telegram / Resend
Once the file-sink floor is verified, add the optional sinks by filling their NAMES in the
EnvironmentFile (values from the vault) and restarting the unit:
- **Telegram**: \`${['TELEGRAM', 'BOT', 'TOKEN'].join('_')}\` (from @BotFather) + \`TELEGRAM_CHAT_ID\`.
- **Resend/email**: \`RESEND_API_KEY\` + \`ALERT_EMAIL_FROM\` + \`ALERT_EMAIL_TO\`.
Restart (\`systemctl restart melek-watcher.timer\` / \`.service\`, or nothing extra for cron — next tick
picks it up) and confirm a test alert reaches the new channel. The file sink keeps running regardless.

## Where secrets come from
Every credential (Telegram token/chat id, Resend key) lives ONLY in the vault and the host
EnvironmentFile (\`chmod 600\`, root-owned). Nothing sensitive is in this repo, the unit, or the
crontab — they carry env var NAMES only.
`;
}

// ---------------------------------------------------------------------------
// Validation — structural + no-secret-literal guard.
// ---------------------------------------------------------------------------
/**
 * Validate a deploy config (the shape passed to systemdUnit / cronEntry). Returns
 * { ok, errors[] }. Never throws. Load-bearing check: no field may carry a hard-coded
 * secret literal, and the known secret-bearing fields must be env NAMES (or absent).
 * @param {object} cfg
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function validateConfig(cfg) {
  const errors = [];
  const c = cfg && typeof cfg === 'object' ? cfg : {};

  // runMode
  if (c.runMode != null && c.runMode !== 'once' && c.runMode !== 'cron') {
    errors.push(`runMode must be "once" or "cron" (got "${c.runMode}")`);
  }

  // workdir / nodeBin should be absolute paths when supplied.
  for (const field of ['workdir', 'nodeBin']) {
    if (c[field] != null) {
      if (typeof c[field] !== 'string' || !c[field].trim()) {
        errors.push(`${field} must be a non-empty path`);
      } else if (!c[field].startsWith('/')) {
        errors.push(`${field} should be an absolute path (got "${c[field]}")`);
      }
    }
  }

  // envFileEnv must be an env var NAME (not a path, not a value).
  if (c.envFileEnv != null) {
    if (looksLikeSecretLiteral(c.envFileEnv)) {
      errors.push('envFileEnv looks like a secret/path literal — it must be an env var NAME');
    } else if (!isEnvName(String(c.envFileEnv))) {
      errors.push(`envFileEnv must be an env var NAME (UPPER_SNAKE_CASE), not "${c.envFileEnv}"`);
    }
  }

  // schedule (if cron-shaped config) must be valid cron when supplied.
  if (c.schedule != null && !isValidCron(c.schedule)) {
    errors.push(`schedule is not a valid 5-field cron expression: "${c.schedule}"`);
  }

  // Known secret-bearing fields must NOT carry a literal value — only a NAME, or be absent.
  for (const name of SECRET_ENV_NAMES) {
    if (c[name] != null) {
      const v = c[name];
      if (looksLikeSecretLiteral(v) || !isEnvName(String(v))) {
        errors.push(`${name} must be referenced as an env var NAME, never a hard-coded value`);
      }
    }
  }

  // Defense in depth: scan every string field for an embedded secret literal.
  for (const [k, v] of Object.entries(c)) {
    if (k === 'envFileEnv') continue; // already checked
    if (looksLikeSecretLiteral(v)) {
      errors.push(`${k} contains what looks like a hard-coded secret literal — no secret values allowed in config`);
    }
  }

  return { ok: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// CLI — print the unit, cron line, env template, and runbook. Guarded so importing
// this module has no side effects.
// ---------------------------------------------------------------------------
if (process.argv[1] && process.argv[1].endsWith('watcher-deploy.mjs')) {
  const runMode = process.argv.includes('--cron') ? 'cron' : 'once';
  const unit = systemdUnit({ runMode });
  const cron = cronEntry({});
  const v = validateConfig({ runMode, envFileEnv: 'WATCHER_ENV_FILE' });
  // eslint-disable-next-line no-console
  console.log(`# watcher-deploy — runMode=${runMode}, config valid=${v.ok}${v.ok ? '' : ' errors=' + JSON.stringify(v.errors)}`);
  // eslint-disable-next-line no-console
  console.log('\n# ---- melek-watcher.service ----\n' + unit.service);
  if (unit.timer) {
    // eslint-disable-next-line no-console
    console.log('\n# ---- melek-watcher.timer ----\n' + unit.timer);
  }
  // eslint-disable-next-line no-console
  console.log('\n# ---- crontab line ----\n' + cron.line);
  // eslint-disable-next-line no-console
  console.log('\n# ---- EnvironmentFile template ----\n' + envTemplate());
  // eslint-disable-next-line no-console
  console.log('\n# ---- runbook ----\n' + setupRunbook());
}
