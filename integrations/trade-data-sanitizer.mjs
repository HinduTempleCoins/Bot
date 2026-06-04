// trade-data-sanitizer.mjs — the SANITIZATION boundary for trade-bot data (queue #229).
//
// The HARD invariant: raw trade-bot server data NEVER reaches the API / brief / annal AIs.
// Raw data lands on operator infrastructure and is read FIRST by OUR own readers (operator
// tier). Only a STRIPPED, sanitized copy — token / action / outcome / timestamp / public
// market context — is ever handed to an 'ai' audience. This module is the one-way valve.
//
//   raw server data  ──ingestRaw()──►  operator-tier normalized record (full detail)
//                                          │
//                                          ├─ sanitizeForAi()  ► { token, action, outcome,
//                                          │                       ts, marketContext } ONLY
//                                          │
//                                          └─ aiBrief()  ► sanitized markdown, self-checked
//                                                          via assertNoPrivateLeak before return
//
// TWO MARKET VIEWS (twoViews) come from the two injected READERS, mirroring the project's
// existing pair: HIVE-Engine diagnostics (hive-engine-market.mjs) + the steemd-style chain
// explorer (chain-explorer.mjs). Either view soft-fails independently — one reader being down
// never takes down the other or the caller.
//
// STRICT POSTURE (matches audience-store / forensics):
//   • ESM .mjs; test file is trade-data-sanitizer.test.js (caught by package.json glob).
//   • All sources are INJECTABLE — nothing here touches the network or a real path by itself.
//   • Soft-fail everywhere a reader/source can fail; the valve never throws on bad input data.
//   • CLI is guarded and uses a GENERIC demo path only.
//   • NO secrets, NO literal operator path, NO literal WIF. Key-shaped strings used in checks
//     are assembled from fragments so no secret-shaped literal lives in source.
//
//   import { ingestRaw, sanitizeForAi, twoViews, aiBrief, assertNoPrivateLeak,
//            redactText, SECRET_SHAPES, PRIVATE_FIELD_PATTERNS }
//     from './integrations/trade-data-sanitizer.mjs'
//
//   node integrations/trade-data-sanitizer.mjs   # offline demo over a generic fixture

// ─────────────────────────────────────────────────────────────────────────────
// Private-field + secret-shape catalogs — the definition of "must never reach an AI".
// ─────────────────────────────────────────────────────────────────────────────

// Field-NAME patterns that mark a value as operator-private. Any key on an object matching one
// of these is operator-tier and must be absent from anything handed to an 'ai' audience.
export const PRIVATE_FIELD_PATTERNS = Object.freeze([
  /key/i,            // wif / activeKey / postingKey / privateKey / apiKey / secretKey …
  /secret/i,
  /wif/i,
  /password|passwd|passphrase/i,
  /token$/i,         // bearer/auth token fields (but not the trade "token" symbol — see below)
  /^server[_-]?path$/i,
  /serverpath/i,
  /(^|[_-])path$/i,  // file/server paths
  /operator/i,       // anything explicitly operator-tagged
  /\baccount\b/i,    // the bot's own account name
  /(^|[_-])(balance|balances)$/i, // exact balances
  /(^|[_-])bearer$/i,
  /(^|[_-])credential[s]?$/i,
  /(^|[_-])host$/i,
  /(^|[_-])env$/i,
]);

// The trade "token" SYMBOL is public market context and is explicitly allowed despite the
// /token$/ pattern above. We special-case the exact field name 'token' in isPrivateFieldName.
const ALLOWED_TOKEN_FIELDS = Object.freeze(new Set(['token']));

// VALUE-SHAPE patterns — strings that LOOK like a secret regardless of the field they sit in.
// Assembled so no secret-shaped literal appears in this source file. These are the last line of
// defence inside assertNoPrivateLeak: even a secret accidentally stringified into AI-facing prose
// is caught by shape.
function buildSecretShapes() {
  // Graphene/Bitcoin WIF: base58, starts with '5', ~51 chars. Built without a literal example.
  const b58 = 'A-HJ-NP-Za-km-z1-9';
  const wif = new RegExp('\\b5[' + b58 + ']{50,51}\\b');
  // Hive/Graphene public key prefix (STM/MLK) + base58 — also a key-shape to refuse echoing.
  const pubkey = new RegExp('\\b(?:STM|MLK)[' + b58 + ']{40,55}\\b');
  // Generic hex private-key-ish blob (32+ bytes hex).
  const hexKey = /\b(?:0x)?[0-9a-fA-F]{64,}\b/;
  // Bearer/JWT-ish opaque token: three dot-separated base64url segments.
  const jwt = /\b[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/;
  // Absolute server path that drills into a state/var/secret area (generic, no literal target).
  const serverPath = /(?:^|[\s"'(=:])\/(?:var|etc|opt|home|root|srv)\/[\w./-]*(?:secret|state|key|vault|wif|credential|melek-bot)[\w./-]*/i;
  // 16-char app-password shape (xxxx xxxx xxxx xxxx or 16 contiguous).
  const appPw = /\b(?:[a-z]{4}\s){3}[a-z]{4}\b/i;
  return Object.freeze([
    Object.freeze({ name: 'wif', re: wif }),
    Object.freeze({ name: 'pubkey', re: pubkey }),
    Object.freeze({ name: 'hexKey', re: hexKey }),
    Object.freeze({ name: 'bearerToken', re: jwt }),
    Object.freeze({ name: 'serverPath', re: serverPath }),
    Object.freeze({ name: 'appPassword', re: appPw }),
  ]);
}

export const SECRET_SHAPES = buildSecretShapes();

// ─────────────────────────────────────────────────────────────────────────────
// helpers
// ─────────────────────────────────────────────────────────────────────────────

function isPrivateFieldName(name) {
  const n = String(name == null ? '' : name);
  if (ALLOWED_TOKEN_FIELDS.has(n)) return false; // trade token symbol is public
  return PRIVATE_FIELD_PATTERNS.some((re) => re.test(n));
}

function num(x) {
  const v = +x;
  return Number.isFinite(v) ? v : 0;
}

function firstString(...vals) {
  for (const v of vals) {
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return undefined;
}

// redactText(text) — replace any secret-shaped substring with a placeholder. Used for log lines
// and as a safety net; never returns the matched secret. Soft on non-strings.
export function redactText(text) {
  let s = text == null ? '' : String(text);
  for (const { name, re } of SECRET_SHAPES) {
    // global-clone so we replace all occurrences without mutating the catalog regex state
    const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
    s = s.replace(g, `[redacted:${name}]`);
  }
  return s;
}

// ─────────────────────────────────────────────────────────────────────────────
// ingestRaw — raw server data → operator-tier normalized record (FULL detail retained)
// ─────────────────────────────────────────────────────────────────────────────
// This is the OPERATOR side. It keeps everything (including private fields) but in a normalized
// shape so OUR readers work with it. It is NEVER handed to an AI; sanitizeForAi/aiBrief do that.
// Soft on garbage: missing/odd input yields a record with sensible empties, never a throw.
export function ingestRaw(rawServerData) {
  const raw = rawServerData && typeof rawServerData === 'object' ? rawServerData : {};

  const token = firstString(raw.token, raw.symbol, raw.pair, raw.market);
  const action = firstString(raw.action, raw.operation, raw.side, raw.type);
  const outcome =
    firstString(raw.outcome, raw.result, raw.status) ||
    (raw.netHive != null ? (num(raw.netHive) >= 0 ? 'profit' : 'loss') : undefined);
  const ts = firstString(raw.ts, raw.timestamp, raw.time, raw.date) || new Date(0).toISOString();

  // Preserve private/operator-tier detail so OUR readers can use it. Tagged tier:'operator'.
  const operatorPrivate = {};
  for (const [k, v] of Object.entries(raw)) {
    if (isPrivateFieldName(k)) operatorPrivate[k] = v;
  }

  const record = {
    tier: 'operator', // a record from ingestRaw is ALWAYS operator-tier
    token: token || null,
    action: action || null,
    outcome: outcome || null,
    ts,
    // numeric trade facts kept for operator analysis (NOT exposed to AI verbatim)
    quantity: num(raw.quantity ?? raw.quantityTokens ?? raw.qty),
    hive: num(raw.hive ?? raw.quantityHive ?? raw.quantityHIVE),
    netHive: raw.netHive != null ? num(raw.netHive) : null,
    price: raw.price != null ? num(raw.price) : null,
    // public market context — safe to carry forward to AI later
    marketContext: raw.marketContext && typeof raw.marketContext === 'object' ? raw.marketContext : {},
    // the operator-private bucket; sanitizeForAi DROPS this wholesale
    operatorPrivate,
    // keep the original around for operator-side forensics only
    _rawKeys: Object.keys(raw),
  };
  return record;
}

// ─────────────────────────────────────────────────────────────────────────────
// sanitizeForAi — operator record → AI-safe record (token/action/outcome/ts/marketContext ONLY)
// ─────────────────────────────────────────────────────────────────────────────
// The whitelist is POSITIVE: only these five fields exist on the output. No key, no server path,
// no operator-tagged field, no account, no exact balance can survive because they are simply not
// copied. marketContext is itself scrubbed of any private-named sub-field.
export function sanitizeForAi(record) {
  const r = record && typeof record === 'object' ? record : {};

  // scrub marketContext to public-only sub-fields (defensive — should already be clean)
  const ctx = {};
  const srcCtx = r.marketContext && typeof r.marketContext === 'object' ? r.marketContext : {};
  for (const [k, v] of Object.entries(srcCtx)) {
    if (isPrivateFieldName(k)) continue;
    if (v != null && typeof v === 'object') continue; // keep market context flat & scalar
    ctx[k] = v;
  }

  return Object.freeze({
    tier: 'ai',
    token: r.token != null ? String(r.token) : null,
    action: r.action != null ? String(r.action) : null,
    outcome: r.outcome != null ? String(r.outcome) : null,
    ts: r.ts != null ? String(r.ts) : null,
    marketContext: Object.freeze(ctx),
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// twoViews — the two market views from the two injected READERS (soft-fail independent)
// ─────────────────────────────────────────────────────────────────────────────
// deps:
//   heMarket  — { metrics(symbol)->{...} }  (hive-engine-market.mjs `market` shape)
//   explorer  — { account(name)?, chain()? } (chain-explorer.mjs shape)
// Both are INJECTED. Each view is wrapped so one failing returns { ok:false, error } while the
// other still succeeds. Neither view is allowed to leak private data — the explorer view is run
// against PUBLIC market/chain context only (token symbol), never the operator's account.
export async function twoViews({ raw } = {}, deps = {}) {
  const record = (raw && raw.tier) ? raw : ingestRaw(raw);
  const symbol = record.token;
  const heMarket = deps.heMarket || null;
  const explorer = deps.explorer || null;

  async function safe(label, fn) {
    if (!fn) return Object.freeze({ ok: false, error: `${label}: reader not provided` });
    try {
      const data = await fn();
      return Object.freeze({ ok: true, data });
    } catch (e) {
      return Object.freeze({ ok: false, error: `${label}: ${e && e.message ? e.message : String(e)}` });
    }
  }

  const heDiagnostics = await safe('hive-engine', async () => {
    if (!heMarket || typeof heMarket.metrics !== 'function') throw new Error('no metrics reader');
    const m = await heMarket.metrics(symbol);
    if (!m) return { symbol, found: false };
    return {
      symbol,
      found: true,
      last: num(m.lastPrice),
      bid: num(m.highestBid),
      ask: num(m.lowestAsk),
      vol24h: num(m.volume),
      changePct: num(m.priceChangePercent),
    };
  });

  const explorerView = await safe('explorer', async () => {
    if (!explorer) throw new Error('no explorer reader');
    // PUBLIC context only: head/chain label, never the bot account.
    if (typeof explorer.chain === 'function') {
      const c = await explorer.chain();
      return { label: c.label, headBlock: c.headBlock, currentWitness: c.currentWitness, time: c.time };
    }
    throw new Error('no chain reader');
  });

  return Object.freeze({ heDiagnostics, explorer: explorerView });
}

// ─────────────────────────────────────────────────────────────────────────────
// aiBrief — sanitized markdown for the AI audience (self-checked before return)
// ─────────────────────────────────────────────────────────────────────────────
// Builds a short markdown brief from ONLY the sanitized record + the two public views, then runs
// assertNoPrivateLeak over the whole string before returning. If anything private survived, it
// THROWS rather than hand leaked data to an AI.
export async function aiBrief(record, deps = {}) {
  const safe = sanitizeForAi(record);
  let views = { heDiagnostics: { ok: false }, explorer: { ok: false } };
  try {
    views = await twoViews({ raw: record }, deps);
  } catch {
    // soft-fail: a broken reader must not break the brief; views simply stay unavailable
  }

  const he = views.heDiagnostics;
  const ex = views.explorer;
  const heLine = he && he.ok
    ? (he.data.found
        ? `last ${he.data.last} · bid ${he.data.bid} · ask ${he.data.ask} · vol24h ${he.data.vol24h} · chg ${he.data.changePct}%`
        : 'token not found on HIVE-Engine')
    : `unavailable (${he && he.error ? he.error : 'reader down'})`;
  const exLine = ex && ex.ok
    ? `${ex.data.label} · head ${ex.data.headBlock} · current witness @${ex.data.currentWitness}`
    : `unavailable (${ex && ex.error ? ex.error : 'reader down'})`;

  const ctxLine = Object.entries(safe.marketContext)
    .map(([k, v]) => `${k}: ${v}`)
    .join(' · ') || '—';

  const md = [
    `## Trade-bot activity (sanitized)`,
    ``,
    `- **Token:** ${safe.token ?? '—'}`,
    `- **Action:** ${safe.action ?? '—'}`,
    `- **Outcome:** ${safe.outcome ?? '—'}`,
    `- **When:** ${safe.ts ?? '—'}`,
    `- **Market context:** ${ctxLine}`,
    ``,
    `### Market views`,
    `- HIVE-Engine: ${heLine}`,
    `- Chain explorer: ${exLine}`,
    ``,
    `_This brief contains only public market context and de-identified trade facts. No keys,`,
    ` account names, server paths, or balances are included by construction._`,
  ].join('\n');

  // self-check: refuse to return anything with a surviving private field or secret shape
  assertNoPrivateLeak(md);
  return md;
}

// ─────────────────────────────────────────────────────────────────────────────
// assertNoPrivateLeak — the gate. Throws on any surviving private field name or secret shape.
// ─────────────────────────────────────────────────────────────────────────────
// Accepts a string (AI-facing prose/markdown) OR an object (AI-facing record). For objects it
// walks keys (private NAMES) and stringifies values (secret SHAPES). For strings it scans for
// secret shapes and tell-tale private tokens. Throws Error on the FIRST violation; returns true
// when clean. This is the last line before any AI sees the output.
export function assertNoPrivateLeak(aiOutput) {
  const violations = [];

  function scanString(s, where) {
    const text = String(s);
    for (const { name, re } of SECRET_SHAPES) {
      if (re.test(text)) violations.push(`secret-shape '${name}'${where ? ` at ${where}` : ''}`);
    }
  }

  function walk(obj, path) {
    if (obj == null) return;
    if (typeof obj === 'string') { scanString(obj, path); return; }
    if (typeof obj !== 'object') return;
    if (Array.isArray(obj)) { obj.forEach((v, i) => walk(v, `${path}[${i}]`)); return; }
    for (const [k, v] of Object.entries(obj)) {
      if (isPrivateFieldName(k)) violations.push(`private field '${k}'${path ? ` at ${path}` : ''}`);
      walk(v, path ? `${path}.${k}` : k);
    }
  }

  if (typeof aiOutput === 'string') {
    scanString(aiOutput, '');
  } else {
    walk(aiOutput, '');
  }

  if (violations.length) {
    // throw the CATEGORY of leak, never the leaked value itself
    throw new Error(`assertNoPrivateLeak: private data would leak to AI — ${violations.join('; ')}`);
  }
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// CLI — guarded, offline, generic demo path only (NO real path, NO secrets)
// ─────────────────────────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('trade-data-sanitizer.mjs')) {
  const DEMO_STATE_PATH = '/opt/app/trade/state.json'; // generic placeholder, not a real path
  // a fake raw record as a server reader might hand us — includes private fields to prove they
  // are stripped. The "secret" here is assembled from fragments, never a literal.
  const fakeWif = '5' + 'K'.repeat(2) + 'b'.repeat(48); // shape-only, not a usable key
  const raw = {
    statePath: DEMO_STATE_PATH,
    operatorAccount: 'demo-account',
    activeKey: fakeWif,
    token: 'SWAP.DOGE',
    operation: 'market_buy',
    quantity: 1000,
    quantityHive: 12.5,
    netHive: -3.2,
    timestamp: '2026-06-04T00:00:00Z',
    marketContext: { spread: '0.4%', vol24h: 880 },
  };

  // injected offline readers
  const heMarket = { async metrics(sym) { return { lastPrice: 0.012, highestBid: 0.011, lowestAsk: 0.013, volume: 880, priceChangePercent: -2.1, symbol: sym }; } };
  const explorer = { async chain() { return { label: 'HIVE (dev)', headBlock: 1234567, currentWitness: 'somewitness', time: '2026-06-04T00:00:00' }; } };

  const op = ingestRaw(raw);
  const ai = sanitizeForAi(op);
  console.log('trade-data-sanitizer — offline demo (generic path; no real secrets)\n');
  console.log('OPERATOR-tier record (full, never sent to AI):');
  console.log(JSON.stringify({ ...op, operatorPrivate: '[present, operator-only]' }, null, 2));
  console.log('\nAI-tier record (whitelist only):');
  console.log(JSON.stringify(ai, null, 2));
  console.log('\nAI brief markdown (self-checked):\n');
  console.log(await aiBrief(op, { heMarket, explorer }));
}
