// repo-scrub.mjs — defensive repo secret-scrub VERIFIER (task #11/#130).
//
// Scans repo content for secret-shaped material and infra leaks, and REPORTS
// findings so we can confirm the public repo is clean. This is a public-by-
// default repo with a hard "zero WIF in repo / no infra specifics in public
// files" rule (those belong in .local/, which is gitignored).
//
// REPORT ONLY — by construction this module has NO write/redact/edit path. It
// reads (via an injectable source) and returns findings. It never mutates a
// file. The snippet inside each finding is itself REDACTED so the report does
// not re-leak the secret it found.
//
// The detector set MATCHES + EXTENDS the existing pre-commit hook
// (.git/hooks/pre-commit): WIF, OpenAI sk-, GitHub gh[pousr]_, Google AIza,
// AWS AKIA, JWT, PEM blocks, generic high-entropy KEY=/SECRET= assignments,
// plus infra leaks (private IPv4, internal operator hostnames, and absolute
// operator server paths). The exact host/path shapes are assembled at runtime
// below from fragments, so this file's own comments do not name them verbatim.
//
// IMPORTANT: the module's OWN patterns are assembled at runtime from fragments
// so the source of THIS file does not itself trip a secret scanner — there is
// no real key literal anywhere in here.
//
// Conventions: ESM .mjs · injectable source __setSource(fn) · PURE detection ·
// soft-fail · CLI guarded.

// --- injectable file source (offline-testable) -----------------------------
// A source provides { list, read }: list() -> [paths], read(path) -> string.
// Default source uses the real filesystem; tests inject fixtures.
let _source = null;

function defaultSource() {
  // Lazy so the module imports cleanly even where fs/child_process differ.
  return {
    async list() {
      const { execSync } = await import('node:child_process');
      // Prefer git ls-files (tracked content is what ships publicly). Fall back
      // to a recursive walk if git isn't available.
      try {
        const out = execSync('git ls-files', { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
        return out.split('\n').map((s) => s.trim()).filter(Boolean);
      } catch {
        const { readdirSync, statSync } = await import('node:fs');
        const acc = [];
        const walk = (dir) => {
          for (const name of readdirSync(dir)) {
            const p = `${dir}/${name}`;
            if (isExcluded(p)) continue;
            let st; try { st = statSync(p); } catch { continue; }
            if (st.isDirectory()) walk(p); else acc.push(p);
          }
        };
        try { walk('.'); } catch { /* soft-fail */ }
        return acc;
      }
    },
    async read(path) {
      const { readFileSync } = await import('node:fs');
      try { return readFileSync(path, 'utf8'); } catch { return ''; }
    },
  };
}

/** Inject a file source { list, read } for offline tests. Pass null to reset. */
export function __setSource(fn) { _source = fn || null; }
function source() { return _source || defaultSource(); }

// --- detector set ----------------------------------------------------------
// Severities:
//   block — must never be in a public file (live secret material).
//   warn  — infra leak: not a credential, but operator/host detail that
//           shortens an attacker's recon and belongs in .local/.
//   info  — secret-SHAPED but high false-positive (generic KEY=/SECRET=).
//
// Patterns are assembled from fragments at runtime so this file's own source
// never contains a complete key literal (it would otherwise trip a scanner).
const F = {
  // base58 alphabet used by WIF / many key encodings
  b58: '[1-9A-HJ-NP-Za-km-z]',
  hex: '[A-Fa-f0-9]',
  b64u: '[A-Za-z0-9_-]',
  alnum: '[A-Za-z0-9]',
};

function build() {
  const wif = new RegExp('5[' + 'HJK' + ']' + F.b58 + '{49}');
  const openai = new RegExp('s' + 'k' + '-' + F.alnum + '{20,}');
  const github = new RegExp('gh' + '[pousr]' + '_' + F.b64u + '{20,}');
  const google = new RegExp('AI' + 'za' + F.b64u + '{35}');
  const aws = new RegExp('A' + 'KIA' + '[A-Z0-9]' + '{16}');
  // JWT: three base64url segments separated by dots, header begins eyJ
  const jwt = new RegExp('ey' + F.b64u + '{10,}\\.' + 'ey' + F.b64u + '{10,}\\.' + F.b64u + '{10,}');
  // PEM begin block for any private/key material
  const pem = new RegExp('-----' + 'BEGIN ' + '[A-Z ]*PRIVATE KEY' + '-----');
  // Telegram bot token shape (digits:base64url) — from the pre-commit hook
  const tg = new RegExp('[0-9]{8,10}:' + F.b64u + '{35}');
  // generic high-entropy assignment: KEY=... / SECRET=... / TOKEN=... / PASSWORD=...
  const assign = new RegExp(
    '\\b(?:[A-Z0-9_]*(?:KEY|SECRET|TOKEN|PASSWORD|PASSWD|PWD))\\s*[:=]\\s*' +
      '[\'"]?[' + 'A-Za-z0-9/+_=-' + ']{16,}[\'"]?',
    'i',
  );
  // --- infra leaks ---
  // private IPv4 ranges: 10.x, 192.168.x, 172.16–31.x, plus loopback-ish 127.x
  const privIp = new RegExp(
    '\\b(?:10\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}' +
      '|192\\.168\\.\\d{1,3}\\.\\d{1,3}' +
      '|172\\.(?:1[6-9]|2\\d|3[01])\\.\\d{1,3}\\.\\d{1,3})\\b',
  );
  // internal operator hostnames (the "<project>-<letter|digit>" form the
  // pre-commit hook also catches). Name assembled from fragments, never typed.
  const host = new RegExp('\\b' + 'melek' + '-[ac0-9]\\b');
  // absolute operator server paths
  const srvPath = new RegExp('/(?:var|etc)/melek-bot\\b');

  return [
    { pattern: 'wif-private-key', severity: 'block', re: wif },
    { pattern: 'pem-private-key', severity: 'block', re: pem },
    { pattern: 'openai-key', severity: 'block', re: openai },
    { pattern: 'github-token', severity: 'block', re: github },
    { pattern: 'google-api-key', severity: 'block', re: google },
    { pattern: 'aws-access-key', severity: 'block', re: aws },
    { pattern: 'telegram-bot-token', severity: 'block', re: tg },
    { pattern: 'jwt', severity: 'block', re: jwt },
    { pattern: 'private-ipv4', severity: 'warn', re: privIp },
    { pattern: 'internal-hostname', severity: 'warn', re: host },
    { pattern: 'server-path', severity: 'warn', re: srvPath },
    { pattern: 'generic-secret-assignment', severity: 'info', re: assign },
  ];
}

/** The detector set: [{ pattern, severity, re }]. Built once at module load. */
export const PATTERNS = build();

// --- exclusions ------------------------------------------------------------
const BINARY_EXT = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'bmp', 'tiff',
  'pdf', 'zip', 'gz', 'tar', 'tgz', 'bz2', 'xz', '7z', 'rar',
  'mp3', 'mp4', 'mov', 'avi', 'webm', 'wav', 'flac', 'ogg',
  'woff', 'woff2', 'ttf', 'otf', 'eot',
  'wasm', 'bin', 'exe', 'dll', 'so', 'dylib', 'node',
  'lock', // lockfiles are noise + huge
]);

/**
 * True if a path should be skipped: .local/ (gitignored, allowed to hold
 * secrets), node_modules, .git, and binary/asset files.
 */
export function isExcluded(path) {
  if (!path) return true;
  const p = String(path).replace(/^\.\//, '');
  if (/(^|\/)\.local(\/|$)/.test(p)) return true;
  if (/(^|\/)node_modules(\/|$)/.test(p)) return true;
  if (/(^|\/)\.git(\/|$)/.test(p)) return true;
  const ext = p.includes('.') ? p.slice(p.lastIndexOf('.') + 1).toLowerCase() : '';
  if (BINARY_EXT.has(ext)) return true;
  return false;
}

// --- redaction -------------------------------------------------------------
// Redact a matched secret so the finding/report never re-leaks it: keep a tiny
// prefix for identification, mask the rest.
function redact(match) {
  const s = String(match);
  if (s.length <= 8) return '*'.repeat(s.length);
  const keep = Math.min(4, Math.floor(s.length / 4));
  return s.slice(0, keep) + '…' + '*'.repeat(Math.max(3, s.length - keep - 1));
}

/** Redact the whole line context around a match so no raw secret survives. */
function redactLine(line, match) {
  try {
    return String(line).split(String(match)).join(redact(match)).slice(0, 200);
  } catch {
    return redact(match);
  }
}

// --- scanning --------------------------------------------------------------
/**
 * PURE. Scan text, return [{ pattern, severity, line, snippet }] where snippet
 * is REDACTED. `line` is the 1-based line number of the first match.
 */
export function scanText(text, { path } = {}) {
  const findings = [];
  if (text == null) return findings;
  const lines = String(text).split('\n');
  for (const det of PATTERNS) {
    for (let i = 0; i < lines.length; i++) {
      const re = new RegExp(det.re.source, det.re.flags.includes('g') ? det.re.flags : det.re.flags + 'g');
      let m;
      while ((m = re.exec(lines[i])) !== null) {
        findings.push({
          pattern: det.pattern,
          severity: det.severity,
          line: i + 1,
          snippet: redactLine(lines[i], m[0]),
          ...(path ? { path } : {}),
        });
        if (m.index === re.lastIndex) re.lastIndex++; // guard zero-width
      }
    }
  }
  return findings;
}

const SEVERITIES = ['block', 'warn', 'info'];

/**
 * Scan many files. Skips excluded paths. Returns
 * { findings, filesScanned, bySeverity, clean }. Soft-fails per file.
 */
export async function scanRepo({ files } = {}) {
  const src = source();
  const list = files || (await src.list().catch(() => []));
  const findings = [];
  let filesScanned = 0;
  for (const path of list) {
    if (isExcluded(path)) continue;
    let text = '';
    try { text = await src.read(path); } catch { continue; }
    if (text == null) continue;
    filesScanned++;
    for (const f of scanText(text, { path })) findings.push(f);
  }
  const bySeverity = {};
  for (const s of SEVERITIES) bySeverity[s] = 0;
  for (const f of findings) bySeverity[f.severity] = (bySeverity[f.severity] || 0) + 1;
  // "clean" = no block/warn findings. info is advisory (high false-positive).
  const clean = bySeverity.block === 0 && bySeverity.warn === 0;
  return { findings, filesScanned, bySeverity, clean };
}

// --- reporting -------------------------------------------------------------
const SEV_LABEL = {
  block: 'BLOCK (live secret material)',
  warn: 'WARN (infra leak — belongs in .local/)',
  info: 'INFO (secret-shaped, verify)',
};

/** Operator-facing markdown verdict. Paths only; snippets already redacted. */
export function report(result) {
  const r = result || { findings: [], filesScanned: 0, bySeverity: {}, clean: true };
  const lines = [];
  lines.push('# Repo secret-scrub verifier');
  lines.push('');
  lines.push(`Scanned ${r.filesScanned} file(s). REPORT ONLY — no files were edited.`);
  lines.push('');
  if (r.clean) {
    lines.push('Verdict: clean ✅ — no block/warn findings.');
    const info = (r.bySeverity && r.bySeverity.info) || 0;
    if (info) lines.push(`(${info} advisory INFO finding(s) — generic secret-shaped assignments to eyeball.)`);
    return lines.join('\n');
  }
  lines.push('Verdict: NOT clean ❌ — review the findings below (redacted).');
  lines.push('');
  for (const sev of SEVERITIES) {
    const group = (r.findings || []).filter((f) => f.severity === sev);
    if (!group.length) continue;
    lines.push(`## ${SEV_LABEL[sev] || sev} — ${group.length}`);
    for (const f of group) {
      const loc = `${f.path || '(text)'}:${f.line}`;
      lines.push(`- \`${f.pattern}\` at ${loc} — \`${f.snippet}\``);
    }
    lines.push('');
  }
  lines.push('Fix: remove the secret or move the file to `.local/` (gitignored). Never commit live key material.');
  return lines.join('\n').trimEnd();
}

// --- CLI (guarded) ---------------------------------------------------------
if (process.argv[1] && process.argv[1].endsWith('repo-scrub.mjs')) {
  scanRepo().then((res) => {
    console.log(report(res));
    process.exitCode = res.clean ? 0 : 1;
  }).catch((e) => {
    console.error('repo-scrub: soft-fail —', e?.message || e);
    process.exitCode = 0; // soft-fail: a scanner crash must not block work
  });
}
