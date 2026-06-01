// trade-sanitizer.mjs — THE BOUNDARY between raw trade-bot data and the external API AIs.
//
// Operator rule (2026-06-01): the brief/annal-writing API AIs must NOT get the raw trade-bot
// server data directly ("not like training on everything on our private end"). Raw data is
// processed by OUR secure systems (the "Readers": forensics + market + analyzer = Claude/local),
// then ONLY a sanitized, processed COPY crosses to the API AI tier.
//
// Two tiers:
//   RAW (internal only)   — .local/trade-analysis.json : exact account, balances, key-adjacent.
//   SANITIZED (API-AI ok) — this module's output       : narrative + rounded aggregates, redacted.
//
// Cadence: callable on demand. Run it just-in-time before a trade-bot annal/brief (1-min tier),
// or in the 12&12 batch. Same output either way.
//
//   node integrations/trade-sanitizer.mjs            # sanitize current .local/trade-analysis.json
// Writes .local/shared/trade-brief-feed.md (+ .json) — the ONLY artifact the API AIs may read.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const RAW_IN = '.local/trade-analysis.json';
const OUT_DIR = '.local/shared';            // the shared tier the API AIs read from
const OUT_MD = `${OUT_DIR}/trade-brief-feed.md`;
const OUT_JSON = `${OUT_DIR}/trade-brief-feed.json`;

// ── redaction: strip anything that is raw private/operational detail or a secret shape ──
const SECRET_SHAPES = [
  /5[HJK][1-9A-HJ-NP-Za-km-z]{49}/g,            // WIF private key
  /\b[A-Za-z0-9_-]{32,}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27,}\b/g, // bot-token shape
  /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,               // IPv4
  /AIza[0-9A-Za-z_-]{35}/g,                     // google key
];
const PRIVATE_PATHS = /\/(?:var|opt|etc)\/[a-z0-9._\/-]+/gi;

function redact(s) {
  let out = String(s);
  for (const re of SECRET_SHAPES) out = out.replace(re, '«redacted»');
  out = out.replace(PRIVATE_PATHS, '«path»');
  return out;
}
// round figures so the API AIs get magnitude, not exact private balances
const round = (n, step = 1) => Math.round((+n || 0) / step) * step;

function sanitize(raw) {
  // shareable: the INSIGHT, not the raw ledger. Exact holdings rounded; no key/credential surface.
  const tokens = (raw.tokens || []).map(t => ({
    symbol: t.symbol,
    role: t.issued ? 'issued-by-us' : 'traded',
    netHive: round(t.netHive, 1),
    activity: t.buys + t.sells > 200 ? 'high' : t.buys + t.sells > 20 ? 'medium' : 'low',
    holdingValueBand: t.heldHive < 1 ? '~0' : t.heldHive < 100 ? '<100' : t.heldHive < 1000 ? '100-1k' : '1k+',
  }));
  return {
    source: 'trade-analyzer (sanitized copy — processed by internal Readers; raw withheld)',
    account: 'the trading account',          // generalized; the public handle is not needed for analysis
    window_ops: raw.window_ops,
    totals: {
      realizedHiveBand: round(raw.totals?.realizedHive, 50),
      unrealizedHiveBand: round(raw.totals?.unrealizedHive, 50),
      netHiveBand: round(raw.totals?.netHive, 50),
    },
    tokens,
    findings: (raw.findings || []).map(redact),
    suggestions: (raw.suggestions || []).map(redact),
  };
}

function toMarkdown(s) {
  const L = [];
  L.push('# Trade-bot brief feed (SANITIZED — for annal/brief AIs)');
  L.push('');
  L.push('_Processed copy. Raw trade-bot server data is withheld by the boundary; this is the Readers\' output._');
  L.push('');
  L.push(`- window: ${s.window_ops} on-chain ops`);
  L.push(`- net position band: ~${s.totals.netHiveBand} HIVE (realized ~${s.totals.realizedHiveBand} + holdings ~${s.totals.unrealizedHiveBand})`);
  L.push('');
  L.push('## Per-token (rounded)');
  L.push('| token | role | net HIVE | activity | holding value |');
  L.push('|---|---|---:|---|---|');
  for (const t of s.tokens) L.push(`| ${t.symbol} | ${t.role} | ${t.netHive} | ${t.activity} | ${t.holdingValueBand} |`);
  L.push('');
  L.push('## Findings');
  for (const f of s.findings) L.push(`- ${f}`);
  L.push('');
  L.push('## Suggestions');
  s.suggestions.forEach((x, i) => L.push(`${i + 1}. ${x}`));
  L.push('');
  return L.join('\n');
}

let raw;
try { raw = JSON.parse(readFileSync(RAW_IN, 'utf8')); }
catch { console.error(`No ${RAW_IN}. Run: node integrations/trade-analyzer.mjs first.`); process.exit(1); }

const clean = sanitize(raw);
const md = toMarkdown(clean);
mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT_JSON, JSON.stringify(clean, null, 2));
writeFileSync(OUT_MD, md);

// boundary self-check: refuse to emit if any secret shape survived
const leak = SECRET_SHAPES.some(re => re.test(md));
console.log(md);
console.log('─'.repeat(60));
console.log(leak ? '❌ BOUNDARY ALERT: secret shape in output — NOT safe to share' : '✅ boundary clean — safe for the API AI tier');
console.log(`→ ${OUT_MD} (+ .json) is the ONLY trade artifact the API AIs may read.`);
