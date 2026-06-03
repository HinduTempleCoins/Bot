// audit-report.mjs — Task #158: an npm-audit remediation REPORT generator.
//
// Parses `npm audit --json` output into a prioritized, human-readable remediation plan:
// which deps are vulnerable, at what severity, and is a fix available (and is it breaking?).
// The legacy `van-kush-discord-bot` deps are the known audit offenders this is shaped against.
//
// HARD INVARIANT — ADVISE ONLY: this module NEVER changes a dependency. There is no code path
// that runs `npm install` / `npm update` / `npm audit fix` (asserted by construction — this file
// never imports child_process and never shells out). It parses INJECTED audit JSON and emits TEXT:
// the suggested commands are strings for the operator to review and run themselves. Dep bumps
// need operator review.
//
// The module is PURE: it works on the JSON you give it. For the CLI / a live snapshot, the
// audit-json *source* is injectable via __setAuditSource(fn) so tests run OFFLINE on canned
// `npm audit --json` fixtures. It supports BOTH npm schemas:
//   - npm v6 : top-level `advisories` (+ `metadata.vulnerabilities` counts)
//   - npm v7+: top-level `vulnerabilities` (+ `metadata.vulnerabilities` counts)
//
//   node integrations/audit-report.mjs < audit.json    # render a report from piped audit JSON
//
// No secrets, no network from the module itself.

// ── injectable audit-json source (offline tests / CLI) ───────────────────────
// shape: () => object | string (parsed or raw `npm audit --json`). Default reads nothing —
// the module is meant to be driven by parseAudit(json). The CLI wires stdin in via __setAuditSource.
let _auditSource = () => null;
export function __setAuditSource(fn) { _auditSource = fn || (() => null); }

// ── severity model ───────────────────────────────────────────────────────────
export const SEVERITIES = ['critical', 'high', 'moderate', 'low'];
const SEV_RANK = { critical: 0, high: 1, moderate: 2, low: 3 };
function sevRank(s) { return SEV_RANK[s] ?? 99; }
function normSev(s) {
  const v = String(s || '').toLowerCase();
  return SEV_RANK[v] != null ? v : 'low';
}

// Coerce whatever we were handed (object | JSON string | junk) into an object, soft-failing to null.
function asObject(json) {
  if (json && typeof json === 'object') return json;
  if (typeof json === 'string') {
    try { return JSON.parse(json); } catch { return null; }
  }
  return null;
}

// fixAvailable in npm v7 is one of: false | true | { name, version, isSemVerMajor }.
// We normalize to { fixAvailable: boolean, breaking: boolean, fixTarget: {name,version}|null }.
function normFix(fa) {
  if (!fa) return { fixAvailable: false, breaking: false, fixTarget: null };
  if (fa === true) return { fixAvailable: true, breaking: false, fixTarget: null };
  if (typeof fa === 'object') {
    return {
      fixAvailable: true,
      breaking: !!fa.isSemVerMajor,
      fixTarget: fa.name ? { name: fa.name, version: fa.version || null } : null,
    };
  }
  return { fixAvailable: false, breaking: false, fixTarget: null };
}

/**
 * parseAudit(json) → normalized findings, one per vulnerable package:
 *   [{ name, severity, via, range, fixAvailable, breaking, fixTarget, isDirect }]
 * Accepts npm v6 (`advisories`) or npm v7+ (`vulnerabilities`). Soft-fails junk → [].
 */
export function parseAudit(json) {
  const obj = asObject(json);
  if (!obj) return [];

  // npm v7+ shape: { vulnerabilities: { <name>: { name, severity, via, range, fixAvailable, isDirect } } }
  if (obj.vulnerabilities && typeof obj.vulnerabilities === 'object' && !Array.isArray(obj.vulnerabilities)) {
    const out = [];
    for (const [key, v] of Object.entries(obj.vulnerabilities)) {
      if (!v || typeof v !== 'object') continue;
      const name = v.name || key;
      // `via` is an array of either strings (other pkg names) or advisory objects {title,severity,...}.
      const via = Array.isArray(v.via)
        ? v.via.map((x) => (typeof x === 'string' ? x : (x && (x.title || x.name)) || 'advisory'))
        : [];
      const fix = normFix(v.fixAvailable);
      out.push({
        name,
        severity: normSev(v.severity),
        via,
        range: v.range || '*',
        fixAvailable: fix.fixAvailable,
        breaking: fix.breaking,
        fixTarget: fix.fixTarget,
        isDirect: !!v.isDirect,
      });
    }
    return out;
  }

  // npm v6 shape: { advisories: { <id>: { module_name, severity, title, vulnerable_versions,
  //   patched_versions, findings:[{paths:[...]}] } } }
  if (obj.advisories && typeof obj.advisories === 'object') {
    const out = [];
    for (const adv of Object.values(obj.advisories)) {
      if (!adv || typeof adv !== 'object') continue;
      const name = adv.module_name || 'unknown';
      // A fix exists if patched_versions names a concrete range (not "<0.0.0" / none).
      const patched = String(adv.patched_versions || '').trim();
      const hasPatch = patched && patched !== '<0.0.0' && patched.toLowerCase() !== 'none';
      // Direct if any finding path is just the module itself (no '>' dependency chain).
      const paths = (Array.isArray(adv.findings) ? adv.findings : [])
        .flatMap((f) => (Array.isArray(f.paths) ? f.paths : []));
      const isDirect = paths.length === 0 || paths.some((p) => !String(p).includes('>'));
      out.push({
        name,
        severity: normSev(adv.severity),
        via: adv.title ? [adv.title] : [],
        range: adv.vulnerable_versions || '*',
        fixAvailable: !!hasPatch,
        breaking: false, // v6 schema doesn't flag semver-major; treat as non-breaking, plan notes review
        fixTarget: hasPatch ? { name, version: patched } : null,
        isDirect,
      });
    }
    return out;
  }

  return [];
}

/**
 * prioritize(findings) → { list, counts, fixable, breaking }
 * `list` sorted critical→low, then fixable-before-not within a severity.
 * `counts` is per-severity tallies; `fixable`/`breaking` are totals.
 */
export function prioritize(findings) {
  const arr = Array.isArray(findings) ? findings.slice() : [];
  arr.sort((a, b) => {
    const d = sevRank(a.severity) - sevRank(b.severity);
    if (d !== 0) return d;
    // fixable first
    if (a.fixAvailable !== b.fixAvailable) return a.fixAvailable ? -1 : 1;
    return String(a.name).localeCompare(String(b.name));
  });
  const counts = { critical: 0, high: 0, moderate: 0, low: 0 };
  let fixable = 0;
  let breaking = 0;
  for (const f of arr) {
    counts[f.severity] = (counts[f.severity] || 0) + 1;
    if (f.fixAvailable) fixable += 1;
    if (f.fixAvailable && f.breaking) breaking += 1;
  }
  return { list: arr, counts, fixable, breaking };
}

// Suggested action TEXT for a finding (a string only — never executed).
function actionFor(f) {
  if (!f.fixAvailable) {
    return `no patch available — consider replacing or removing "${f.name}" (or pin & accept risk)`;
  }
  const target = f.fixTarget && f.fixTarget.version
    ? `npm install ${f.fixTarget.name}@${f.fixTarget.version}`
    : (f.breaking ? `npm install ${f.name}@latest` : `npm update ${f.name}`);
  if (f.breaking) return `${target}  (semver-major — review breaking changes first)`;
  return target;
}

/**
 * remediationPlan(findings) → { safe, breaking, noFix, counts, fixable, breaking: <n> }
 * Buckets each prioritized finding:
 *   - safe    : fixAvailable && !breaking          → suggested non-breaking command
 *   - breaking: fixAvailable && breaking (semver-major) → needs operator review
 *   - noFix   : no fix yet                          → advise replace / pin
 * Each entry carries { name, severity, range, action, via }.
 */
export function remediationPlan(findings) {
  const { list, counts, fixable, breaking } = prioritize(findings);
  const plan = { safe: [], breaking: [], noFix: [], counts, fixable, breakingCount: breaking };
  for (const f of list) {
    const entry = {
      name: f.name,
      severity: f.severity,
      range: f.range,
      via: f.via,
      action: actionFor(f),
    };
    if (!f.fixAvailable) plan.noFix.push(entry);
    else if (f.breaking) plan.breaking.push(entry);
    else plan.safe.push(entry);
  }
  return plan;
}

/**
 * summaryLine(findings) → one-line health, e.g.
 *   "3 high, 5 moderate; 6 fixable, 2 breaking"
 *   "no known vulnerabilities" when clean.
 */
export function summaryLine(findings) {
  const { counts, fixable, breaking } = prioritize(findings);
  const parts = SEVERITIES.filter((s) => counts[s] > 0).map((s) => `${counts[s]} ${s}`);
  if (parts.length === 0) return 'no known vulnerabilities';
  const tail = `${fixable} fixable${breaking ? `, ${breaking} breaking` : ''}`;
  return `${parts.join(', ')}; ${tail}`;
}

/**
 * report(plan) → operator-facing markdown verdict. Accepts a plan (from remediationPlan) OR a
 * raw findings array (it will build the plan). Always includes the explicit
 * "I did not change any deps" note. ADVISE ONLY.
 */
export function report(plan) {
  // Allow passing findings directly for convenience.
  const p = Array.isArray(plan) ? remediationPlan(plan) : plan;
  if (!p || typeof p !== 'object') return '# npm audit — remediation plan\n\n(no audit data)\n';

  const counts = p.counts || { critical: 0, high: 0, moderate: 0, low: 0 };
  const total = SEVERITIES.reduce((n, s) => n + (counts[s] || 0), 0);
  const L = [];
  L.push('# npm audit — remediation plan');
  L.push('');

  if (total === 0) {
    L.push('No known vulnerabilities. Nothing to remediate.');
    L.push('');
  } else {
    const sevLine = SEVERITIES.map((s) => `${counts[s] || 0} ${s}`).join(' · ');
    L.push(`**${total} vulnerable package(s):** ${sevLine}`);
    L.push(`**Fixable:** ${p.fixable || 0}  ·  **Breaking fixes:** ${p.breakingCount || 0}`);
    L.push('');

    const section = (title, entries, note) => {
      L.push(`## ${title} (${entries.length})`);
      if (note) L.push(`_${note}_`);
      if (entries.length === 0) {
        L.push('- (none)');
      } else {
        for (const e of entries) {
          const via = e.via && e.via.length ? `  ←  ${e.via.slice(0, 3).join(', ')}` : '';
          L.push(`- **${e.name}** (${e.severity}, ${e.range})${via}`);
          L.push(`    - \`${e.action}\``);
        }
      }
      L.push('');
    };

    section('Safe fixes', p.safe || [], 'non-breaking — should be low-risk, but still operator-reviewed');
    section('Breaking fixes', p.breaking || [], 'semver-major — review changelogs before applying');
    section('No fix yet', p.noFix || [], 'no published patch — replace, remove, or pin and accept the risk');
  }

  L.push('---');
  L.push('> **Review before running.** This is an ADVISORY report only — I did not change any');
  L.push('> dependencies, and I never run `npm install`, `npm update`, or `npm audit fix`. The');
  L.push('> commands above are suggestions for you to review and run yourself.');
  L.push('');
  return L.join('\n');
}

// ── CLI (guarded) ─────────────────────────────────────────────────────────────
// Reads `npm audit --json` from the injected source, or from stdin if none set. The module
// itself never SHELLS OUT — the CLI just consumes whatever JSON you pipe in.
function readStdin() {
  return new Promise((resolve) => {
    let buf = '';
    if (process.stdin.isTTY) { resolve(''); return; }
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (d) => { buf += d; });
    process.stdin.on('end', () => resolve(buf));
    process.stdin.on('error', () => resolve(''));
  });
}

if (process.argv[1] && process.argv[1].endsWith('audit-report.mjs')) {
  const injected = _auditSource();
  const raw = injected != null ? injected : await readStdin();
  const findings = parseAudit(raw);
  process.stdout.write(report(remediationPlan(findings)));
  process.stdout.write('\n' + summaryLine(findings) + '\n');
}
