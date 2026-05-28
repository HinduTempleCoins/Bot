/**
 * security-scan.js — Cheetah's platform security pattern scanner.
 *
 * Operator framing 2026-05-28: Cheetah's third role (after attribution +
 * policing) is platform security. Same engine that does text-detection
 * extends naturally to "this content embeds patterns matching known-bad
 * signatures." Precedents catalogued in cheetah/security.md (MySpace
 * Samy worm, NeoPets embedded HTML/Flash, Steem rephished-link campaigns,
 * HIVE 2020 phishing, Discord webhook-token leaks, MediaWiki spam,
 * npm crypto-drainers).
 *
 * Returns:
 *   { flagged: boolean, severity: 'info'|'warn'|'block',
 *     findings: [{ pattern, kind, snippet, position }] }
 *
 * Patterns are categorized (kinds):
 *   - script-injection      <script>, javascript:, on*= handlers, iframe/object
 *   - phish-link            Markdown link where display text and href domain
 *                           disagree, e.g., [hivekeychain.com](http://attacker)
 *   - wallet-drainer        seed phrase / mnemonic / "verify your wallet"
 *   - webhook-token         Discord webhook URLs, Slack webhooks, Telegram bot tokens
 *   - typosquat-package     npm install promoting near-misses of known packages
 *   - embedded-credential   WIF / API-key / JWT shapes — the angelicalist pattern
 *
 * Detection is DETERMINISTIC (regex / structure parsing). NOT LLM-based —
 * generative models hallucinate matches, which is the opposite of what
 * security needs. An LLM might be asked separately to WRITE the comment
 * once a finding is confirmed (per Cheetah's design from §3 of spec).
 */

import { SELF_ID_LINK } from './config.js';

// ---- pattern catalog ------------------------------------------------------

// Severity tiers:
//   info  — flag for review, low blast radius (e.g., short snippet looks
//           webhook-shaped but might be a coincidence)
//   warn  — clearly bad shape, almost certainly wants a comment + record
//   block — content shouldn't be allowed on-chain / on-platform at all
//           (e.g., live WIF private key in a public post)

const PATTERNS = [
  // --- script-injection ---
  {
    kind: 'script-injection',
    severity: 'block',
    regex: /<script\b[^>]*>/i,
    label: 'inline <script> tag',
  },
  {
    kind: 'script-injection',
    severity: 'warn',
    regex: /\bjavascript:\s*[^"'\s]/i,
    label: 'javascript: URL scheme',
  },
  {
    kind: 'script-injection',
    severity: 'warn',
    regex: /\bon(?:click|error|load|mouseover|focus|submit)\s*=\s*["'][^"']*["']/i,
    label: 'inline event handler (on* attribute)',
  },
  {
    kind: 'script-injection',
    severity: 'warn',
    regex: /<iframe\b[^>]*>/i,
    label: '<iframe> embed',
  },
  {
    kind: 'script-injection',
    severity: 'info',
    regex: /<(?:object|embed)\b[^>]*>/i,
    label: '<object>/<embed> tag',
  },

  // --- wallet-drainer keyword shape ---
  {
    kind: 'wallet-drainer',
    severity: 'warn',
    regex: /\b(?:seed\s+phrase|recovery\s+phrase|mnemonic\s+phrase)\b/i,
    label: 'wallet seed/recovery phrase reference',
  },
  {
    kind: 'wallet-drainer',
    severity: 'warn',
    regex: /\b(?:verify|connect|validate|sync)\s+(?:your\s+)?wallet\b/i,
    label: 'wallet "verify/connect" phish prompt',
  },
  {
    kind: 'wallet-drainer',
    severity: 'warn',
    regex: /\benter\s+(?:your\s+)?(?:private[\s-]?key|posting[\s-]?key|active[\s-]?key|owner[\s-]?key)\b/i,
    label: '"enter your private key" phish prompt',
  },

  // --- webhook-token shape ---
  {
    kind: 'webhook-token',
    severity: 'block',
    regex: /https?:\/\/(?:discord(?:app)?\.com|discord\.com)\/api\/webhooks\/\d{17,20}\/[\w-]{60,}/i,
    label: 'Discord webhook URL with token',
  },
  {
    kind: 'webhook-token',
    severity: 'block',
    regex: /https?:\/\/hooks\.slack\.com\/services\/[A-Z0-9]+\/[A-Z0-9]+\/[a-zA-Z0-9]+/i,
    label: 'Slack incoming webhook URL',
  },
  {
    kind: 'webhook-token',
    severity: 'warn',
    regex: /\b\d{8,12}:[A-Za-z0-9_-]{35}\b/,
    label: 'Telegram bot token shape',
  },

  // --- embedded-credential shape (angelicalist-type leaks) ---
  {
    kind: 'embedded-credential',
    severity: 'block',
    regex: /\b5[HJK][1-9A-HJ-NP-Za-km-z]{49}\b/,
    label: 'Graphene-family WIF private key (Hive/Steem/MELEK)',
  },
  {
    kind: 'embedded-credential',
    severity: 'block',
    regex: /\bsk-[A-Za-z0-9]{32,}\b/,
    label: 'OpenAI / Anthropic-shape API key',
  },
  {
    kind: 'embedded-credential',
    severity: 'block',
    regex: /\bAKIA[0-9A-Z]{16}\b/,
    label: 'AWS Access Key ID',
  },
  {
    kind: 'embedded-credential',
    severity: 'warn',
    regex: /\bghp_[A-Za-z0-9]{36}\b/,
    label: 'GitHub Personal Access Token',
  },
  {
    kind: 'embedded-credential',
    severity: 'info',
    regex: /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/,
    label: 'JWT shape',
  },

  // --- typosquat package shape ---
  // Operator's framing: posts that promote npm install of typo-near-misses
  // of legitimate packages (dhive → dhivee, hive-keychain → hive-keychainn,
  // etc.). Conservative: flag any "npm install" + suspicious-near-miss.
  {
    kind: 'typosquat-package',
    severity: 'info',
    regex: /\b(?:npm|yarn|pnpm)\s+(?:install|add|i)\s+(?:dhivee|hiveio|hive-keychainn|@hivee?\/|@hieveio\/|node-fetchh|expresss|reactt|nextt)\b/i,
    label: 'npm install of suspected typosquat package',
  },
];

// ---- phish-link detection (structural, not just regex) --------------------

/**
 * Markdown link parser: returns the link's display-text + href + char position.
 * Then we compare display-text-domain against href-domain.
 */
function* extractMarkdownLinks(text) {
  const re = /\[([^\]\n]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    yield { text: m[1], href: m[2], position: m.index };
  }
}

function extractDomain(s) {
  // Accept either a URL or bare domain-looking text
  const urlMatch = String(s).match(/^https?:\/\/([^\s/]+)/i);
  if (urlMatch) return urlMatch[1].toLowerCase();
  const domainMatch = String(s).match(/(?:^|[^\w@])((?:[a-z0-9-]+\.)+[a-z]{2,})/i);
  if (domainMatch) return domainMatch[1].toLowerCase();
  return null;
}

function isPhishLink(link) {
  const textDomain = extractDomain(link.text);
  const hrefDomain = extractDomain(link.href);
  if (!textDomain || !hrefDomain) return false;
  if (textDomain === hrefDomain) return false;
  // Allow subdomain relationship in either direction
  if (textDomain.endsWith('.' + hrefDomain) || hrefDomain.endsWith('.' + textDomain)) return false;
  return true;
}

// ---- main scan ------------------------------------------------------------

const SEVERITY_RANK = { info: 1, warn: 2, block: 3 };

function snippetAround(text, position, radius = 80) {
  const start = Math.max(0, position - radius);
  const end = Math.min(text.length, position + radius);
  return text.slice(start, end).replace(/\s+/g, ' ').trim();
}

/**
 * Scan a content body for security signals. Returns:
 *   { flagged: bool, severity, findings: [...] }
 *
 * Findings are deduplicated by (kind, label, snippet) so the same regex
 * matching twice on similar content doesn't bloat the report.
 *
 * @param {string} body
 * @param {object} [opts]
 *   - skipKinds: string[] kinds to skip (e.g. ['typosquat-package'])
 */
export function scanContent(body, opts = {}) {
  const skip = new Set(opts.skipKinds || []);
  const findings = [];
  const seen = new Set();

  function addFinding(kind, severity, label, snippet, position) {
    const dedupe = `${kind}|${label}|${snippet.slice(0, 40)}`;
    if (seen.has(dedupe)) return;
    seen.add(dedupe);
    findings.push({ kind, severity, label, snippet, position });
  }

  // Regex patterns
  for (const p of PATTERNS) {
    if (skip.has(p.kind)) continue;
    let m;
    const re = new RegExp(p.regex.source, p.regex.flags.includes('g') ? p.regex.flags : p.regex.flags + 'g');
    while ((m = re.exec(body)) !== null) {
      addFinding(p.kind, p.severity, p.label, snippetAround(body, m.index), m.index);
      if (!p.regex.flags.includes('g')) break;
    }
  }

  // Phish-link structural check (separate because it parses link structure)
  if (!skip.has('phish-link')) {
    for (const link of extractMarkdownLinks(body)) {
      if (isPhishLink(link)) {
        addFinding(
          'phish-link',
          'warn',
          `Markdown link text domain (${extractDomain(link.text)}) ≠ href domain (${extractDomain(link.href)})`,
          snippetAround(body, link.position),
          link.position,
        );
      }
    }
  }

  // Compute overall severity
  let maxSev = 0;
  for (const f of findings) maxSev = Math.max(maxSev, SEVERITY_RANK[f.severity] || 0);
  const overallSeverity = ['none', 'info', 'warn', 'block'][maxSev] || 'none';

  return {
    flagged: findings.length > 0,
    severity: overallSeverity,
    findings,
  };
}

// ---- compose a Cheetah security-comment from a scan result ----------------

/**
 * Cheetah's voice on a security finding: state the fact, link to the
 * pattern + self-ID footer, no accusation, no legalese. Hathor handles
 * any conversation that follows.
 */
export function composeSecurityNote(scanResult, opts = {}) {
  if (!scanResult.flagged) return null;
  const bySeverity = { block: [], warn: [], info: [] };
  for (const f of scanResult.findings) {
    if (bySeverity[f.severity]) bySeverity[f.severity].push(f);
  }

  const parts = [];
  if (bySeverity.block.length) {
    parts.push(
      `**Security flag** — this content contains patterns the platform doesn't accept:`,
      ...bySeverity.block.map(f => `- ${f.label}`),
    );
  }
  if (bySeverity.warn.length) {
    parts.push(
      `${bySeverity.block.length ? 'Also flagged' : 'Security note'} — patterns worth reviewing:`,
      ...bySeverity.warn.map(f => `- ${f.label}`),
    );
  }
  if (!bySeverity.block.length && bySeverity.info.length) {
    parts.push(
      `Security note — informational signals:`,
      ...bySeverity.info.map(f => `- ${f.label}`),
    );
  }
  parts.push('');
  parts.push(
    `If you think any flag here is a false positive, reply with context and the record will update. The detector is pattern-based and will sometimes be wrong on edge cases.`,
  );

  // Footer (same Cheetah voice as compose.js)
  parts.push(
    `\n---\n*Cheetah — the MELEK chain's content-attribution + security librarian. Patterns, not accusations. [About / how to opt out](${CHEETAH_SELF_ID_URL || 'https://github.com/HinduTempleCoins/Bot/blob/main/cheetah/README.md'}).*`,
  );

  return parts.join('\n');
}

export const _internal = { PATTERNS, extractMarkdownLinks, extractDomain, isPhishLink };
