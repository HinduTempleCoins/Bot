// validate.mjs — offline sanity check for the Azure IaC in deploy/azure/.
//
// Parses the Bicep (or the az-CLI script) + cloud-init and asserts the
// load-bearing fields are present: a 4 vCPU / 16 GB VM size, an SSH-key seam
// (no password auth / no baked secrets), the NO-MINING note, Node + Postgres +
// pgvector install, and a placeholder repo URL. Pure text inspection — no
// network, no `az`, no Bicep compiler. Reader is injectable (__setReader) so
// tests run with in-memory fixtures and never touch disk.
//
// House style: ESM, exported API, soft-fail-never-throw (returns a report,
// throws never), esc() for any HTML, CLI guarded by process.argv[1].

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// ── injectable file reader seam ─────────────────────────────────────────────
let _reader = (p) => {
  try { return fs.readFileSync(p, 'utf8'); } catch { return ''; }
};
export function __setReader(fn) { _reader = typeof fn === 'function' ? fn : _reader; }
export function __resetReader() {
  _reader = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return ''; } };
}

export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

// 4 vCPU / 16 GB candidates this IaC is allowed to use.
export const ALLOWED_VM_SIZES = ['Standard_B4as_v2', 'Standard_D4ps_v5', 'Standard_D4as_v5'];

function has(text, re) { return re.test(text); }

// ── individual checks (each soft, each returns {ok, detail}) ────────────────

// A bicep OR an az-CLI script that provisions the right-sized VM with an SSH seam,
// no baked secrets, and the no-mining note.
export function checkVmSpec(text) {
  const t = String(text || '');
  const checks = {
    vmSize: ALLOWED_VM_SIZES.some((s) => t.includes(s)),
    sshKey: has(t, /sshPublicKey|ssh-key-values|ssh_authorized_keys|keyData/i),
    noPasswordAuth: has(t, /disablePasswordAuthentication\s*[:=]\s*true|--ssh-key-values/i),
    noMiningNote: has(t, /no\s*(crypto)?\s*mining|mining[^a-z]*(forbidden|prohibit|ban|off|aup)/i),
    parameterised: has(t, /\bparam\b|\$\{?[A-Z_]+\}?|:\?|\bENV\b|placeholder|__[A-Z_]+__/),
    noRealSecret: !has(t, /(BEGIN (RSA|OPENSSH|EC) PRIVATE KEY|5[HJK][1-9A-HJ-NP-Za-km-z]{48})/),
  };
  const missing = Object.entries(checks).filter(([, v]) => !v).map(([k]) => k);
  return { ok: missing.length === 0, checks, missing };
}

// cloud-init must install node + postgres + pgvector and clone a PLACEHOLDER repo url.
export function checkCloudInit(text) {
  const t = String(text || '');
  const checks = {
    cloudConfigHeader: has(t, /^#cloud-config/m),
    node: has(t, /nodejs|nodesource|node_lts|setup_lts/i),
    postgres: has(t, /postgresql/i),
    pgvector: has(t, /pgvector|CREATE EXTENSION[^;]*vector/i),
    repoClonePlaceholder: has(t, /git clone[\s\S]*?(__REPO_URL__|\$\{?REPO_URL\}?)/i),
    noMiningNote: has(t, /no\s*mining|mining[^a-z]*(forbidden|aup|off)/i),
  };
  const missing = Object.entries(checks).filter(([, v]) => !v).map(([k]) => k);
  return { ok: missing.length === 0, checks, missing };
}

// Public-safe: no real server IPs (allow placeholders 0.0.0.0, 10.x private, 203.0.113.x doc range).
export function checkPublicSafe(text) {
  const t = String(text || '');
  const ipRe = /\b(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\b/g;
  const offenders = [];
  let m;
  while ((m = ipRe.exec(t)) !== null) {
    const ip = m[0];
    const a = Number(m[1]); const b = Number(m[2]);
    const allowed =
      ip.startsWith('0.0.0.0') ||
      a === 10 ||                                  // RFC1918 private
      (a === 172 && b >= 16 && b <= 31) ||         // RFC1918 private
      (a === 192 && b === 168) ||                  // RFC1918 private
      (a === 203 && b === 0 && Number(m[3]) === 113); // TEST-NET-3 doc range
    if (!allowed) offenders.push(ip);
  }
  return { ok: offenders.length === 0, offenders };
}

// ── top-level validate over the deploy/azure dir (or injected fixtures) ─────
export function validate({ dir = HERE, read = _reader } = {}) {
  const report = { ok: false, files: {}, errors: [] };
  try {
    const bicep = read(path.join(dir, 'main.bicep'));
    const script = read(path.join(dir, 'vm-create.sh'));
    const cloud = read(path.join(dir, 'cloud-init.yaml'));

    const specSource = (bicep && bicep.length ? bicep : script) || '';
    const vm = checkVmSpec(specSource);
    const ci = checkCloudInit(cloud);
    // public-safety across all three artifacts.
    const safe = checkPublicSafe([bicep, script, cloud].join('\n'));

    report.files = {
      vmSpec: { source: bicep && bicep.length ? 'main.bicep' : 'vm-create.sh', ...vm },
      cloudInit: ci,
      publicSafe: safe,
    };
    report.ok = vm.ok && ci.ok && safe.ok;
    if (!vm.ok) report.errors.push(`vm spec missing: ${vm.missing.join(', ')}`);
    if (!ci.ok) report.errors.push(`cloud-init missing: ${ci.missing.join(', ')}`);
    if (!safe.ok) report.errors.push(`public-unsafe IPs: ${safe.offenders.join(', ')}`);
  } catch (e) {
    report.errors.push(`validate failed soft: ${e && e.message ? e.message : e}`);
  }
  return report;
}

// ── CLI ─────────────────────────────────────────────────────────────────────
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const r = validate();
  process.stdout.write(JSON.stringify(r, null, 2) + '\n');
  process.exit(r.ok ? 0 : 1);
}
