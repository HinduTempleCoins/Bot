/**
 * monitor.mjs — witness-monitor for the `hathor` MELEK witness account (task #38).
 *
 * READ-ONLY. It polls chain state (witness props + dynamic global props) and emits
 * alerts on missed blocks, a disabled (null) signing key, a stalled producer, and
 * version drift. It holds NO keys and NEVER signs or broadcasts anything.
 *
 * Shape follows the repo conventions (cf. integrations/notify-bus.mjs and the
 * witness/ dir): ESM, injectable client hook for offline tests, soft-fail (never
 * throws), CLI guarded by argv[1]. Pure detection given two snapshots.
 *
 *   import { checkWitness, detectIssues, monitorOnce } from './monitor.mjs';
 *
 *   const snap = await checkWitness('hathor');
 *   const issues = detectIssues(snap, previousSnap);
 *   const { snapshot, issues } = await monitorOnce({ account: 'hathor', previous, alert });
 *
 * The default client lazily composes a read-only Hathor adapter; tests inject a
 * fake via __setClient() so nothing touches the network and no env is required.
 */

// ── injectable chain client ──────────────────────────────────────────────────
// A client is an async function (account) => { witness, gprops } where:
//   witness = result of get_witness_by_account  (total_missed, last_confirmed_block_num,
//             signing_key, running_version, url, ...)
//   gprops  = result of get_dynamic_global_properties  (head_block_number, ...)
let _client = null;
export function __setClient(fn) { _client = fn || null; }

// Default client: read-only Hathor adapter. Composed lazily and defensively so a
// missing/unconfigured chain never breaks import or tests. Never signs/broadcasts.
async function defaultClient(account) {
  const { Hathor } = await import('./hathor.js');
  const adapter = new Hathor().connect();
  const [witness, gprops] = await Promise.all([
    adapter.getWitnessByAccount(account),
    adapter.client.database.getDynamicGlobalProperties(),
  ]);
  return { witness, gprops };
}

function getClient() {
  return _client || defaultClient;
}

// ── thresholds ────────────────────────────────────────────────────────────────
export const DEFAULT_THRESHOLDS = {
  blocksBehind: 20,        // stalled if head advanced this far past last_confirmed_block
  warnOnVersionDrift: true, // emit version-drift when running_version changes
};

// The Graphene "null" signing key convention: a public key whose body is all 1s.
// witness_update sets this to retire a witness. We treat empty/missing the same.
const NULL_KEY_RE = /^[A-Za-z0-9]{0,5}1{30,}[A-Za-z0-9]{0,12}$/;

function isNullSigningKey(key) {
  if (key == null) return true;
  const s = String(key).trim();
  if (s === '') return true;
  // strip a short address prefix (e.g. MELEK/STM) then check the body is all 1s
  const body = s.replace(/^[A-Za-z]{2,5}/, '');
  if (/^1+[A-Za-z0-9]{0,12}$/.test(body) && (body.match(/1/g) || []).length >= 30) return true;
  return NULL_KEY_RE.test(s);
}

function toInt(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

// ── checkWitness: fetch + map to a safe snapshot shape ───────────────────────────
/**
 * Fetch witness props + dynamic global props via the injected client and map to a
 * stable snapshot. Soft-fails to a safe shape (error set, fields zeroed) on any
 * error — never throws.
 *
 * @param {string} account
 * @returns {Promise<object>} snapshot
 */
export async function checkWitness(account = 'hathor') {
  const ts = Date.now();
  try {
    const client = getClient();
    const res = await client(account);
    const witness = res?.witness || {};
    const gprops = res?.gprops || {};

    const totalMissed = toInt(witness.total_missed);
    const lastConfirmedBlock = toInt(witness.last_confirmed_block_num);
    const headBlock = toInt(gprops.head_block_number);
    const blocksBehind = headBlock > 0 && lastConfirmedBlock > 0
      ? Math.max(0, headBlock - lastConfirmedBlock)
      : 0;
    const signingKeyDisabled = isNullSigningKey(witness.signing_key);
    const version = witness.running_version != null ? String(witness.running_version) : null;

    return {
      account,
      ok: true,
      totalMissed,
      lastConfirmedBlock,
      headBlock,
      blocksBehind,
      signingKeyDisabled,
      version,
      ts,
    };
  } catch (e) {
    // soft-fail: a safe, fully-shaped snapshot so callers/detectors never crash
    return {
      account,
      ok: false,
      error: e?.message || 'check-failed',
      totalMissed: 0,
      lastConfirmedBlock: 0,
      headBlock: 0,
      blocksBehind: 0,
      signingKeyDisabled: false,
      version: null,
      ts,
    };
  }
}

// ── detectIssues: PURE given two snapshots ───────────────────────────────────────
/**
 * Compare the current snapshot against the previous one and return an array of
 * issue objects. Pure: no I/O, no side effects.
 *
 * Issue kinds:
 *   missed-block     — total_missed rose since the previous snapshot
 *   signing-disabled — signing key is the null/empty key
 *   stalled          — head advanced but last_confirmed_block did not, and
 *                      blocksBehind exceeds the threshold
 *   version-drift    — running_version changed (optional, threshold-gated)
 *
 * @param {object} current  snapshot from checkWitness
 * @param {object|null} previous  prior snapshot (may be undefined on first run)
 * @param {object} [thresholds]
 * @returns {Array<{kind:string, account:string, ts:number, ...}>}
 */
export function detectIssues(current, previous = null, thresholds = {}) {
  const t = { ...DEFAULT_THRESHOLDS, ...thresholds };
  const issues = [];
  if (!current || current.ok === false) return issues; // can't detect on a failed read

  const account = current.account;
  const ts = current.ts;

  // missed-block: total_missed increased
  if (previous && current.totalMissed > previous.totalMissed) {
    issues.push({
      kind: 'missed-block',
      account,
      ts,
      delta: current.totalMissed - previous.totalMissed,
      totalMissed: current.totalMissed,
      previousTotalMissed: previous.totalMissed,
    });
  }

  // signing-disabled: null/empty signing key
  if (current.signingKeyDisabled) {
    issues.push({
      kind: 'signing-disabled',
      account,
      ts,
    });
  }

  // stalled: head advanced past last_confirmed by more than the threshold, and
  // (when we have a previous) last_confirmed did NOT advance while head did.
  const overBehind = current.blocksBehind > t.blocksBehind;
  const headAdvanced = previous ? current.headBlock > previous.headBlock : true;
  const confirmedStuck = previous ? current.lastConfirmedBlock <= previous.lastConfirmedBlock : true;
  if (overBehind && headAdvanced && confirmedStuck) {
    issues.push({
      kind: 'stalled',
      account,
      ts,
      blocksBehind: current.blocksBehind,
      threshold: t.blocksBehind,
      lastConfirmedBlock: current.lastConfirmedBlock,
      headBlock: current.headBlock,
    });
  }

  // version-drift: running_version changed
  if (t.warnOnVersionDrift && previous && previous.version != null
      && current.version != null && current.version !== previous.version) {
    issues.push({
      kind: 'version-drift',
      account,
      ts,
      from: previous.version,
      to: current.version,
    });
  }

  return issues;
}

// ── monitorOnce: check + detect + fire alerts ────────────────────────────────────
const noopAlert = () => {};

/**
 * Build a default alert sink that routes through notify-bus if available, else a
 * no-op. Defensive dynamic import in try/catch so a missing export never breaks
 * the monitor.
 */
async function defaultAlert(issue) {
  try {
    const mod = await import('../integrations/notify-bus.mjs');
    if (mod && typeof mod.notify === 'function') {
      const priority = issue.kind === 'missed-block' || issue.kind === 'stalled' ? 'high'
        : issue.kind === 'signing-disabled' ? 'urgent' : 'default';
      await mod.notify({
        topic: process.env.NOTIFY_BUS_TOPIC || 'melek-witness',
        title: `witness ${issue.account}: ${issue.kind}`,
        message: summarize(issue),
        priority,
        tags: ['warning', 'hathor', issue.kind],
      });
      return;
    }
  } catch {
    // notify-bus missing or failed — soft-fail to no-op
  }
}

function summarize(issue) {
  switch (issue.kind) {
    case 'missed-block':
      return `total_missed rose by ${issue.delta} (now ${issue.totalMissed})`;
    case 'signing-disabled':
      return 'block signing key is null/empty — witness is disabled';
    case 'stalled':
      return `not advancing: ${issue.blocksBehind} blocks behind head (threshold ${issue.threshold})`;
    case 'version-drift':
      return `running_version changed ${issue.from} -> ${issue.to}`;
    default:
      return issue.kind;
  }
}

/**
 * Check the witness once, detect new issues vs. `previous`, and fire `alert(issue)`
 * for each issue. Soft-fails: a throwing alert hook never breaks the run.
 *
 * @param {object} opts
 * @param {string} [opts.account='hathor']
 * @param {object|null} [opts.previous]  prior snapshot
 * @param {function} [opts.alert]  async (issue) => void ; defaults to notify-bus sink
 * @param {object} [opts.thresholds]
 * @returns {Promise<{snapshot:object, issues:Array}>}
 */
export async function monitorOnce({ account = 'hathor', previous = null, alert, thresholds = {} } = {}) {
  const snapshot = await checkWitness(account);
  const issues = detectIssues(snapshot, previous, thresholds);
  const sink = alert || defaultAlert || noopAlert;
  for (const issue of issues) {
    try {
      await sink(issue);
    } catch {
      // an alert sink must never break monitoring
    }
  }
  return { snapshot, issues };
}

// ── state file (for cron/timer runs) ─────────────────────────────────────────────
// A timer fires the CLI as a fresh process each run, so missed-block DELTAS need the
// prior snapshot persisted. `--state <path>` loads it before the check and saves the
// new snapshot after. Soft-fail both ways: a missing/corrupt file = no previous.
export async function loadState(path) {
  if (!path) return null;
  try {
    const { readFile } = await import('node:fs/promises');
    return JSON.parse(await readFile(path, 'utf8'));
  } catch { return null; }
}

export async function saveState(path, snapshot) {
  if (!path || !snapshot) return false;
  try {
    const { writeFile, mkdir, rename } = await import('node:fs/promises');
    const { dirname } = await import('node:path');
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path + '.tmp', JSON.stringify(snapshot));
    await rename(path + '.tmp', path); // atomic swap — a killed run never corrupts state
    return true;
  } catch { return false; }
}

// ── CLI (guarded) ────────────────────────────────────────────────────────────────
// Read-only one-shot: prints the snapshot and any issues. No keys, no broadcast.
//   node witness/monitor.mjs [account] [--state path/to/witness-monitor-state.json]
if (process.argv[1] && process.argv[1].endsWith('monitor.mjs')) {
  const args = process.argv.slice(2);
  const stateIdx = args.indexOf('--state');
  const statePath = stateIdx > -1 ? args[stateIdx + 1] : (process.env.MONITOR_STATE || null);
  const positional = args.filter((a, i) => a !== '--state' && i !== stateIdx + 1);
  const account = positional[0] || process.env.HATHOR_ACCOUNT || 'hathor';
  const previous = await loadState(statePath);
  const { snapshot, issues } = await monitorOnce({ account, previous });
  if (snapshot.ok) await saveState(statePath, snapshot);
  console.log(JSON.stringify({ snapshot, issues }, null, 2));
  if (!snapshot.ok) process.exitCode = 2;
  else if (issues.length) process.exitCode = 1;
}
