// security-scan.mjs — admin-portal security / malware scanner (operator 2026-06-03: "look for viruses
// and all kinds of things"). Two layers, both soft-fail / never-throw:
//   (1) PURE static threat detector — scanContent(text|html) flags MySpace/NeoPets-style embedded
//       threats: inline <script>, suspicious iframes, javascript: URLs, on*-event handlers,
//       base64/eval obfuscation, data: exec URIs, hidden redirects. Returns {threats, score}.
//   (2) Reputation lookups (keys optional) — urlReputation() via URLhaus (keyless) + VirusTotal
//       (process.env.VIRUSTOTAL_KEY, soft-fail), fileHashReputation(sha256).
// Reuses the spirit of cheetah/security.md's pattern catalog; does NOT import or edit it.
// Follows integrations/soapbox/macro.mjs: ESM, __setFetch hook, CLI guarded by process.argv[1].

let _fetch = (...a) => globalThis.fetch(...a);
/** Test/host hook to inject a fetch implementation. Pass nothing to restore global fetch. */
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

const UA = 'Mozilla/5.0 (compatible; MELEK-SecurityScan/1.0)';

// severity → numeric weight that accumulates into the score.
const WEIGHT = { info: 1, warn: 4, block: 10 };

// Each rule: {kind, severity, re, why}. `re` is run with a fresh lastIndex each scan.
// Ordered roughly by how load-bearing the signal is. Snippets are clipped to keep output small.
const RULES = [
  { kind: 'inline-script', severity: 'block', why: 'embedded <script> block — MySpace Samy-worm shape',
    re: /<script\b[^>]*>[\s\S]*?<\/script\s*>|<script\b[^>]*\/?>/gi },
  { kind: 'suspicious-iframe', severity: 'block', why: '<iframe>/<frame> embed — drive-by / clickjack vector',
    re: /<i?frame\b[^>]*>/gi },
  { kind: 'embed-object', severity: 'block', why: '<object>/<embed>/<applet> — legacy Flash/plugin embed (NeoPets shape)',
    re: /<(?:object|embed|applet)\b[^>]*>/gi },
  { kind: 'javascript-url', severity: 'block', why: 'javascript: URL — script execution via href/src',
    re: /(?:href|src|action|formaction)\s*=\s*["']?\s*javascript:[^"'>\s]+/gi },
  { kind: 'js-protocol', severity: 'warn', why: 'bare javascript: protocol in content',
    re: /javascript:\s*[^"'>\s][^"'>]*/gi },
  { kind: 'event-handler', severity: 'block', why: 'inline on* event handler (onerror/onload/onclick…) — injection shape',
    re: /\bon[a-z]{2,}\s*=\s*["'][^"']*["']/gi },
  { kind: 'data-exec-uri', severity: 'block', why: 'data: URI carrying executable/HTML/script payload',
    re: /data:\s*(?:text\/html|application\/(?:javascript|x-javascript|ecmascript)|image\/svg\+xml)[^"'>\s]*/gi },
  { kind: 'eval-obfuscation', severity: 'warn', why: 'eval()/Function() dynamic code execution',
    re: /\b(?:eval|new\s+Function)\s*\(/gi },
  { kind: 'base64-decode-exec', severity: 'warn', why: 'atob/fromCharCode/unescape decode — obfuscated payload unpacking',
    re: /\b(?:atob|unescape|decodeURIComponent\s*\(\s*escape|String\.fromCharCode)\s*\(/gi },
  { kind: 'document-write', severity: 'warn', why: 'document.write / innerHTML sink — dynamic DOM injection',
    re: /\bdocument\s*\.\s*write\b|\.\s*innerHTML\s*=/gi },
  { kind: 'meta-refresh-redirect', severity: 'warn', why: 'meta refresh / location redirect — hidden navigation away',
    re: /<meta\b[^>]*http-equiv\s*=\s*["']?refresh[^>]*>|(?:window\.)?location(?:\.href)?\s*=\s*["']https?:/gi },
  { kind: 'hidden-element', severity: 'info', why: 'off-screen / zero-size / hidden element — cloaked content',
    re: /(?:display\s*:\s*none|visibility\s*:\s*hidden|(?:width|height)\s*:\s*0(?:px)?\b|position\s*:\s*absolute\s*;[^"']*(?:left|top)\s*:\s*-\d{3,})/gi },
  { kind: 'svg-script', severity: 'block', why: '<svg> with embedded script/handler — SVG XSS vector',
    re: /<svg\b[^>]*>[\s\S]*?(?:<script\b|on[a-z]{2,}\s*=)/gi },
];

function clip(s, n = 120) {
  const one = String(s).replace(/\s+/g, ' ').trim();
  return one.length > n ? one.slice(0, n) + '…' : one;
}

/**
 * PURE static threat scan of a text / HTML string. Never throws; never network.
 * @param {string} text
 * @returns {{threats: Array<{kind,severity,snippet,why}>, score: number, clean: boolean}}
 */
export function scanContent(text) {
  const threats = [];
  if (typeof text !== 'string' || text.length === 0) return { threats, score: 0, clean: true };
  for (const rule of RULES) {
    rule.re.lastIndex = 0;
    let m;
    let hits = 0;
    while ((m = rule.re.exec(text)) !== null) {
      threats.push({ kind: rule.kind, severity: rule.severity, snippet: clip(m[0]), why: rule.why });
      if (++hits >= 5) break; // cap per-rule noise
      if (m.index === rule.re.lastIndex) rule.re.lastIndex++; // guard zero-width
    }
  }
  const score = threats.reduce((s, t) => s + (WEIGHT[t.severity] || 0), 0);
  return { threats, score, clean: threats.length === 0 };
}

// ---- Layer 2: reputation lookups (soft-fail, keys optional) -------------------------------------

function normVerdict({ malicious = false, source, detail, raw }) {
  return { malicious: !!malicious, source, detail: detail || null, raw: raw ?? null };
}

/**
 * URL reputation. URLhaus is keyless; VirusTotal is consulted only if VIRUSTOTAL_KEY is set.
 * Soft-fail: any error / missing key yields a non-malicious "unknown"-style verdict from that source.
 * @returns {Promise<{url, malicious, sources: object[]}>}
 */
export async function urlReputation(url) {
  const out = { url: String(url || ''), malicious: false, sources: [] };
  if (!out.url) return out;

  // URLhaus (abuse.ch) — keyless POST lookup.
  try {
    const r = await _fetch('https://urlhaus-api.abuse.ch/v1/url/', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': UA },
      body: 'url=' + encodeURIComponent(out.url),
    });
    if (r && r.ok) {
      const j = await r.json();
      const listed = j && j.query_status === 'ok';
      out.sources.push(normVerdict({
        malicious: listed && (j.threat || j.url_status === 'online') ? true : listed,
        source: 'urlhaus',
        detail: listed ? (j.threat || j.url_status || 'listed') : (j.query_status || 'no_results'),
        raw: j,
      }));
    } else {
      out.sources.push(normVerdict({ source: 'urlhaus', detail: 'lookup_failed' }));
    }
  } catch {
    out.sources.push(normVerdict({ source: 'urlhaus', detail: 'unreachable' }));
  }

  // VirusTotal — only if a key is present. Soft-fail otherwise.
  const vtKey = process.env.VIRUSTOTAL_KEY;
  if (vtKey) {
    try {
      const id = Buffer.from(out.url).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
      const r = await _fetch('https://www.virustotal.com/api/v3/urls/' + id, {
        headers: { 'x-apikey': vtKey, 'user-agent': UA },
      });
      if (r && r.ok) {
        const j = await r.json();
        const stats = j?.data?.attributes?.last_analysis_stats || {};
        const bad = (stats.malicious || 0) + (stats.suspicious || 0);
        out.sources.push(normVerdict({ malicious: bad > 0, source: 'virustotal', detail: `${bad} engines flagged`, raw: stats }));
      } else {
        out.sources.push(normVerdict({ source: 'virustotal', detail: 'lookup_failed' }));
      }
    } catch {
      out.sources.push(normVerdict({ source: 'virustotal', detail: 'unreachable' }));
    }
  } else {
    out.sources.push(normVerdict({ source: 'virustotal', detail: 'no_key' }));
  }

  out.malicious = out.sources.some((s) => s.malicious);
  return out;
}

/**
 * File-hash (sha256) reputation via VirusTotal. Soft-fail; needs VIRUSTOTAL_KEY.
 * @returns {Promise<{hash, malicious, sources: object[]}>}
 */
export async function fileHashReputation(sha256) {
  const out = { hash: String(sha256 || ''), malicious: false, sources: [] };
  if (!out.hash) return out;
  const vtKey = process.env.VIRUSTOTAL_KEY;
  if (!vtKey) {
    out.sources.push(normVerdict({ source: 'virustotal', detail: 'no_key' }));
    return out;
  }
  try {
    const r = await _fetch('https://www.virustotal.com/api/v3/files/' + encodeURIComponent(out.hash), {
      headers: { 'x-apikey': vtKey, 'user-agent': UA },
    });
    if (r && r.ok) {
      const j = await r.json();
      const stats = j?.data?.attributes?.last_analysis_stats || {};
      const bad = (stats.malicious || 0) + (stats.suspicious || 0);
      out.sources.push(normVerdict({ malicious: bad > 0, source: 'virustotal', detail: `${bad} engines flagged`, raw: stats }));
    } else {
      out.sources.push(normVerdict({ source: 'virustotal', detail: r && r.status === 404 ? 'not_found' : 'lookup_failed' }));
    }
  } catch {
    out.sources.push(normVerdict({ source: 'virustotal', detail: 'unreachable' }));
  }
  out.malicious = out.sources.some((s) => s.malicious);
  return out;
}

/**
 * One-call summary: static content scan + (optional) URL + hash reputation. Never throws.
 * @param {{url?:string, html?:string, hash?:string}} input
 */
export async function scan({ url, html, hash } = {}) {
  const content = html != null ? scanContent(html) : { threats: [], score: 0, clean: true };
  const [urlRep, hashRep] = await Promise.all([
    url ? urlReputation(url).catch(() => ({ url, malicious: false, sources: [] })) : Promise.resolve(null),
    hash ? fileHashReputation(hash).catch(() => ({ hash, malicious: false, sources: [] })) : Promise.resolve(null),
  ]);
  const malicious = !content.clean || !!(urlRep && urlRep.malicious) || !!(hashRep && hashRep.malicious);
  const verdict = content.threats.some((t) => t.severity === 'block') || (urlRep && urlRep.malicious) || (hashRep && hashRep.malicious)
    ? 'block'
    : content.threats.some((t) => t.severity === 'warn') ? 'warn'
    : content.threats.length ? 'info' : 'clean';
  return { malicious, verdict, content, url: urlRep, hash: hashRep };
}

// ---- CLI -----------------------------------------------------------------------------------------
if (process.argv[1] && process.argv[1].endsWith('security-scan.mjs')) {
  const args = process.argv.slice(2);
  const get = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; };
  const html = get('--html');
  const url = get('--url');
  const hash = get('--hash');
  const res = await scan({ html, url, hash });
  console.log(`verdict: ${res.verdict}  (malicious=${res.malicious})`);
  if (res.content.threats.length) {
    console.log('\nstatic threats:');
    for (const t of res.content.threats) console.log(`  [${t.severity}] ${t.kind}: ${t.snippet}`);
    console.log(`  score: ${res.content.score}`);
  }
  if (res.url) console.log(`\nurl reputation: malicious=${res.url.malicious}  ${res.url.sources.map((s) => s.source + '=' + s.detail).join(', ')}`);
  if (res.hash) console.log(`hash reputation: malicious=${res.hash.malicious}  ${res.hash.sources.map((s) => s.source + '=' + s.detail).join(', ')}`);
}
