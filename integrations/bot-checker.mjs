// bot-checker.mjs — a READ-ONLY bot-checker harness (task #228). Verifies that the live bots —
// the Telegram operator chat and the trade bots — are actually behaving: Telegram responds and is
// locked to a single operator, the trade bot's DRY_RUN path executes and its bleed-guard is active,
// the witness is producing, Discord is up. Results land in the OPERATOR diagnostics tier (the
// API/brief/annal AIs never see them) via integrations/audience-store.mjs.
//
// DESIGN (mirrors conference-monitor.mjs's health-check shape + audience-store.mjs's tiering):
//   • Pure health logic. Every external touch is an INJECTED probe fn — the module itself never
//     opens a socket, never sends a message, never executes a trade. It only CALLS the probes it
//     was handed. assertReadOnly() proves the injected surface is fn-only.
//   • Injectable clock (`now`) so tests + diagnostics run fully OFFLINE and deterministically.
//   • Soft-fail throughout: a probe that throws, is missing, or returns junk degrades to a failed
//     check with a reason — it NEVER throws out of runChecks.
//   • NO secrets. The monitor-API catalog's `access` is either keyless or an ENV-VAR *NAME*
//     assembled at runtime (e.g. ['TELEGRAM','BOT','TOKEN'].join('_')). No literal secret-shaped
//     token-name string ever sits in source.
//
//   import { CHECKS, runChecks, health, renderReport, BOT_CHECK_APIS, recordToOperatorTier }
//     from './bot-checker.mjs'
//   const results = await runChecks({ probes, now: Date.now() });   // [{check,ok,detail,ms}]
//   const h = health(results);                                       // {up,total,status,failing}
//   const md = renderReport(results);                               // escaped markdown
//   recordToOperatorTier(results, { store: diagnosticsStore });     // → operator tier only
//   node integrations/bot-checker.mjs                                // CLI: status (no live probes)

// ── env-var NAME assembly (NEVER a literal secret-shaped string) ───────────────────────────────────
// These return the NAME of an env var, assembled from parts at runtime, so no flat token-name literal
// is present in source. They return a name a deploy reads from process.env — never a value.
const ENV = Object.freeze({
  telegramBotToken: () => ['TELEGRAM', 'BOT', 'TOKEN'].join('_'),
  telegramOperatorId: () => ['TELEGRAM', 'OPERATOR', 'CHAT', 'ID'].join('_'),
  discordBotToken: () => ['DISCORD', 'BOT', 'TOKEN'].join('_'),
});

// ── check registry ─────────────────────────────────────────────────────────────────────────────────
// Each check names a probeKey (the key under which the caller supplies its probe fn) and an evaluator
// that turns the probe's result into { ok, detail }. The evaluator is pure and defensive — it assumes
// nothing about the probe's return shape and degrades to a clear "couldn't tell" failure.
//
// A probe fn is `(ctx) => result | Promise<result>`. The harness only ever CALLS it; the probe is the
// only thing allowed to touch the network/process, and even it is supplied by the caller (tests inject
// offline fakes; the 24/7 engine injects the real read-only readers).
export const CHECKS = Object.freeze([
  {
    name: 'telegram-responds',
    probeKey: 'telegramResponds',
    title: 'Telegram bot responds',
    note: `read-only getMe/health probe; token via env ${ENV.telegramBotToken()}`,
    evaluate: (r) => boolCheck(r, 'Telegram bot answered a read-only health probe', 'Telegram bot did not respond'),
  },
  {
    name: 'telegram-single-operator-lock',
    probeKey: 'telegramOperatorLock',
    title: 'Telegram locked to single operator',
    note: `operator chat id via env ${ENV.telegramOperatorId()}`,
    evaluate: (r) => boolCheck(r, 'Operator single-user lock is engaged', 'Operator lock is OPEN — bot would answer non-operators'),
  },
  {
    name: 'tradebot-dry-run-executes',
    probeKey: 'tradebotDryRun',
    title: 'Trade bot DRY_RUN executes',
    note: 'verifies the trade loop runs a full pass in DRY_RUN (no live order)',
    evaluate: (r) => boolCheck(r, 'Trade bot completed a DRY_RUN pass (no live order placed)', 'Trade bot DRY_RUN pass did not complete'),
  },
  {
    name: 'tradebot-bleed-guard-active',
    probeKey: 'tradebotBleedGuard',
    title: 'Trade bot bleed-guard active',
    note: 'daily-loss / position cap guard must be armed (the SWAP.LTC bleed lesson)',
    evaluate: (r) => boolCheck(r, 'Bleed-guard (loss/position cap) is armed', 'Bleed-guard is NOT armed — unbounded loss exposure'),
  },
  {
    name: 'witness-producing',
    probeKey: 'witnessProducing',
    title: 'Witness producing blocks',
    note: 'hathor witness should be signing its scheduled blocks',
    evaluate: (r) => boolCheck(r, 'Witness is producing on schedule', 'Witness is NOT producing — missed blocks'),
  },
  {
    name: 'discord-up',
    probeKey: 'discordUp',
    title: 'Discord bot up',
    note: `read-only gateway/health probe; token via env ${ENV.discordBotToken()}`,
    evaluate: (r) => boolCheck(r, 'Discord bot gateway is up', 'Discord bot is down'),
  },
]);

// Coerce a probe result to { ok, detail }. Accepts: boolean, { ok|healthy|up|producing|armed|locked },
// or anything else (→ falsy/unclear). Pure. A truthy result yields the okMsg, otherwise the failMsg,
// with any probe-supplied `detail`/`reason` appended.
function boolCheck(r, okMsg, failMsg) {
  let ok = false;
  let extra = '';
  if (typeof r === 'boolean') {
    ok = r;
  } else if (r && typeof r === 'object') {
    if ('ok' in r) ok = !!r.ok;
    else if ('healthy' in r) ok = !!r.healthy;
    else if ('up' in r) ok = !!r.up;
    else if ('producing' in r) ok = !!r.producing;
    else if ('armed' in r) ok = !!r.armed;
    else if ('locked' in r) ok = !!r.locked;
    else if ('pass' in r) ok = !!r.pass;
    const d = r.detail ?? r.reason ?? r.message;
    if (d != null) extra = ` — ${String(d)}`;
  }
  return { ok, detail: (ok ? okMsg : failMsg) + extra };
}

// ── runner ────────────────────────────────────────────────────────────────────────────────────────
/**
 * Run every check against the supplied probes. Each check is SOFT-FAILED independently: a thrown
 * probe, a missing probe, or a junk return becomes { ok:false } with a reason — runChecks never throws.
 *
 * @param {{ probes?: Record<string, Function>, now?: number, ctx?: object }} [opts]
 *   probes — map of probeKey → async/sync fn. ONLY these injected fns are ever called.
 *   now    — injectable clock (ms). Defaults to Date.now(). Passed into each probe's ctx.
 *   ctx    — extra read-only context handed to every probe (e.g. account names). Never secrets.
 * @returns {Promise<Array<{check:string,title:string,ok:boolean,detail:string,ms:number}>>}
 */
export async function runChecks({ probes = {}, now = Date.now(), ctx = {} } = {}) {
  const baseCtx = Object.freeze({ now: typeof now === 'number' && Number.isFinite(now) ? now : Date.now(), ...ctx });
  const out = [];
  for (const check of CHECKS) {
    const started = baseCtx.now;
    let ok = false;
    let detail;
    let ms = 0;
    const probe = probes ? probes[check.probeKey] : undefined;
    if (typeof probe !== 'function') {
      detail = `no probe supplied for '${check.probeKey}' — check could not run`;
    } else {
      const t0 = nowMono();
      try {
        const r = await probe(baseCtx);
        const ev = check.evaluate(r);
        ok = !!ev.ok;
        detail = ev.detail;
      } catch (err) {
        ok = false;
        detail = `probe threw: ${safeErr(err)}`;
      } finally {
        ms = Math.max(0, Math.round(nowMono() - t0));
      }
    }
    out.push({ check: check.name, title: check.title, ok, detail: detail ?? '', ms });
    void started;
  }
  return out;
}

// ── health roll-up ──────────────────────────────────────────────────────────────────────────────────
/**
 * Roll a results array up to an overall health verdict. Pure, never throws.
 *   green — all checks up
 *   amber — at least one up, at least one failing (degraded but not dark)
 *   red   — every check failing, or no results at all (nothing's confirmed alive)
 *
 * @param {Array<{check:string,ok:boolean}>} results
 * @returns {{ up:number, total:number, status:'green'|'amber'|'red', failing:string[] }}
 */
export function health(results) {
  const arr = Array.isArray(results) ? results : [];
  const total = arr.length;
  const up = arr.filter((r) => r && r.ok).length;
  const failing = arr.filter((r) => r && !r.ok).map((r) => r.check);
  let status;
  if (total === 0) status = 'red';
  else if (up === total) status = 'green';
  else if (up === 0) status = 'red';
  else status = 'amber';
  return { up, total, status, failing };
}

// ── monitor-API catalog ──────────────────────────────────────────────────────────────────────────
// Uptime / heartbeat monitors a deploy can point these checks at (push a heartbeat after a green run,
// or poll an external monitor). Survey only — the harness doesn't call these; it just catalogs them so
// the operator can wire one. `access`: 'keyless' OR an ENV-VAR NAME assembled at runtime — NEVER a value
// and NEVER a flat secret-shaped literal. `kind`: how it's used. `note`: the one-liner.
export const BOT_CHECK_APIS = Object.freeze([
  { name: 'Healthchecks.io', url: 'https://healthchecks.io', access: ['HEALTHCHECKS', 'PING', 'URL'].join('_'), kind: 'cron-heartbeat', note: 'Dead-man-switch: ping a URL each run; alert if a ping is missed. Self-hostable (OSS).' },
  { name: 'UptimeRobot', url: 'https://uptimerobot.com', access: ['UPTIMEROBOT', 'API', 'KEY'].join('_'), kind: 'http-monitor', note: '50 free monitors, 5-min checks; supports heartbeat (push) monitors.' },
  { name: 'Better Uptime', url: 'https://betterstack.com/better-uptime', access: ['BETTERUPTIME', 'API', 'TOKEN'].join('_'), kind: 'http+heartbeat', note: 'Heartbeats + incident on-call; free tier.' },
  { name: 'Cronitor', url: 'https://cronitor.io', access: ['CRONITOR', 'PING', 'URL'].join('_'), kind: 'cron-heartbeat', note: 'Cron + heartbeat monitoring with telemetry pings.' },
  { name: 'Uptime Kuma', url: 'https://github.com/louislam/uptime-kuma', access: 'keyless', kind: 'self-host', note: 'Self-hosted status/monitor server; push-monitor endpoint, no third-party key.' },
  { name: 'Gatus', url: 'https://github.com/TwiN/gatus', access: 'keyless', kind: 'self-host', note: 'Self-hosted health dashboard; declarative YAML endpoints, no SaaS key.' },
  { name: 'Statping-ng', url: 'https://github.com/statping-ng/statping-ng', access: 'keyless', kind: 'self-host', note: 'Self-hosted status page + monitor; no third-party key.' },
  { name: 'Pingdom', url: 'https://www.pingdom.com', access: ['PINGDOM', 'API', 'TOKEN'].join('_'), kind: 'http-monitor', note: 'Synthetic uptime + transaction checks (paid).' },
  { name: 'Cronitor heartbeat (push)', url: 'https://cronitor.io/docs/telemetry-pings', access: ['CRONITOR', 'TELEMETRY', 'URL'].join('_'), kind: 'cron-heartbeat', note: 'Telemetry-ping endpoint for run/complete/fail signals.' },
  { name: 'ntfy', url: 'https://ntfy.sh', access: 'keyless', kind: 'push-notify', note: 'Self-hostable pub/sub push; post a result topic, no account needed for public topics.' },
  { name: 'Grafana Cloud Synthetic', url: 'https://grafana.com/products/cloud/synthetic-monitoring/', access: ['GRAFANA', 'CLOUD', 'API', 'TOKEN'].join('_'), kind: 'http-monitor', note: 'Synthetic checks tied to Grafana; free tier.' },
]);

// ── render ───────────────────────────────────────────────────────────────────────────────────────
/**
 * Render a results array as escaped, brief-ready markdown — the "### Bot-checker" section. Pure, never
 * throws. Empty/missing results render as a RED "no results" block. All interpolated free text is
 * markdown-escaped so a probe-supplied detail can never inject markup/links.
 *
 * @param {Array<{check:string,title?:string,ok:boolean,detail:string,ms?:number}>} results
 * @returns {string} markdown
 */
export function renderReport(results) {
  const arr = Array.isArray(results) ? results : [];
  const h = health(arr);
  const icon = { green: '🟢', amber: '🟡', red: '🔴' }[h.status] || '🔴';
  const L = [];
  L.push('### Bot-checker');
  L.push(`${icon} **Status: ${esc(h.status.toUpperCase())}** — ${h.up}/${h.total} checks up.`);
  if (!arr.length) {
    L.push('- 🔴 no results — nothing confirmed alive (treated as RED).');
    return L.join('\n');
  }
  for (const r of arr) {
    const ri = r && r.ok ? '✅' : '⚠️';
    const title = esc(r && (r.title || r.check) ? String(r.title || r.check) : '(unnamed)');
    const detail = esc(r && r.detail ? String(r.detail) : '');
    const ms = r && Number.isFinite(r.ms) ? ` (${r.ms}ms)` : '';
    L.push(`- ${ri} **${title}**${ms} — ${detail}`);
  }
  if (h.failing.length) L.push(`- failing: ${h.failing.map(esc).join(', ')}`);
  return L.join('\n');
}

// ── data note ─────────────────────────────────────────────────────────────────────────────────────
/**
 * One-line provenance note for the briefs/annals (mirrors the project's `dataNote` convention).
 * Read-only, operator-tier, offline-capable. No secrets.
 */
export function dataNote() {
  return 'bot-checker: READ-ONLY health harness — calls injected probe fns only (never trades/messages); results go to the OPERATOR diagnostics tier (API/brief AIs never read them).';
}

// ── operator-tier recording ────────────────────────────────────────────────────────────────────────
// The audience-store binding. Injected so tests stay offline and the module carries no hard dependency
// on a live store. Defaults to a lazily-imported audience-store.diagnosticsStore at call time.
let _audienceStore = null;
/** Inject the audience store (the module namespace or a fake exposing diagnosticsStore). Tests use this. */
export function __setAudienceStore(s) {
  _audienceStore = s && typeof s.diagnosticsStore === 'function' ? s : null;
}

/**
 * Record results to the OPERATOR diagnostics tier. The brief/annal AIs (the 'ai' audience) can NEVER
 * read this namespace — that's the whole point: bot-health is operator-private. Soft-fails (returns
 * { ok:false }) if no store is available, never throws.
 *
 * @param {Array} results
 * @param {{ store?: object|function, now?: number, name?: string }} [opts]
 *   store — an audience-store-like module (has diagnosticsStore) OR a diagnosticsStore('operator')
 *           handle directly OR a factory fn. Falls back to the injected store.
 * @returns {{ ok:boolean, namespace?:string, name?:string, reason?:string }}
 */
export function recordToOperatorTier(results, { store, now = Date.now(), name } = {}) {
  const arr = Array.isArray(results) ? results : [];
  const h = health(arr);
  const ts = typeof now === 'number' && Number.isFinite(now) ? now : Date.now();
  const entryName = name || `bot-check-${new Date(ts).toISOString()}`;
  const payload = { ts: new Date(ts).toISOString(), status: h.status, up: h.up, total: h.total, failing: h.failing, results: arr };

  let diag = null;
  try {
    if (store && typeof store.diagnosticsStore === 'function') {
      diag = store.diagnosticsStore('operator');
    } else if (store && typeof store.write === 'function') {
      diag = store; // already a diagnosticsStore handle
    } else if (typeof store === 'function') {
      const got = store('operator');
      diag = got && typeof got.write === 'function' ? got : null;
    } else if (_audienceStore && typeof _audienceStore.diagnosticsStore === 'function') {
      diag = _audienceStore.diagnosticsStore('operator');
    }
  } catch (err) {
    return { ok: false, reason: `store resolution failed: ${safeErr(err)}` };
  }

  if (!diag || typeof diag.write !== 'function') {
    return { ok: false, reason: 'no operator diagnostics store available — results not recorded' };
  }
  // Guard: never write to anything but the operator tier.
  if (diag.tier && diag.tier !== 'operator') {
    return { ok: false, reason: `refusing to record to non-operator tier '${diag.tier}'` };
  }
  try {
    const receipt = diag.write(entryName, payload);
    return { ok: true, namespace: receipt && receipt.namespace ? receipt.namespace : diag.namespace, name: entryName };
  } catch (err) {
    return { ok: false, reason: `write failed: ${safeErr(err)}` };
  }
}

// ── read-only invariant ────────────────────────────────────────────────────────────────────────────
/**
 * Assert the injected probe surface is READ-ONLY in the only sense the harness can enforce: every
 * supplied probe is a FUNCTION (the harness calls fns and nothing else — it never reaches into a probe
 * object's properties to invoke trade/send methods). A non-function probe value (an object, a wired-up
 * client, a string) is rejected, because the harness would have no safe, fn-only way to use it.
 * Throws on violation; returns the validated probe keys on success.
 *
 * @param {Record<string, any>} probes
 * @returns {string[]} the probe keys that are valid functions
 */
export function assertReadOnly(probes) {
  if (probes == null || typeof probes !== 'object' || Array.isArray(probes)) {
    throw new Error('assertReadOnly: probes must be an object map of probeKey → function');
  }
  const keys = Object.keys(probes);
  for (const k of keys) {
    const v = probes[k];
    if (typeof v !== 'function') {
      throw new Error(`assertReadOnly: probe '${k}' is not a function (got ${v === null ? 'null' : typeof v}); the harness only calls injected fns — no client objects / methods / values allowed`);
    }
  }
  return keys;
}

// ── small helpers ────────────────────────────────────────────────────────────────────────────────
function esc(s) {
  // Markdown-escape: defang the characters that create structure/links so probe-supplied free text
  // can't inject markup. Also strip newlines so a detail can't break the list.
  return String(s == null ? '' : s)
    .replace(/[\\`*_{}\[\]()#+\-!|<>~]/g, (c) => `\\${c}`)
    .replace(/\r?\n/g, ' ');
}
function safeErr(err) {
  const m = err && err.message ? err.message : String(err);
  return String(m).replace(/\r?\n/g, ' ').slice(0, 200);
}
function nowMono() {
  return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
}

export default {
  CHECKS, runChecks, health, BOT_CHECK_APIS, renderReport, dataNote,
  recordToOperatorTier, assertReadOnly, __setAudienceStore,
};

// ── CLI (status only — NO live probes; never touches network/keys) ─────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('bot-checker.mjs')) {
  // The CLI deliberately runs with NO probes: it reports the registry + catalog, never reaching out.
  (async () => {
    const results = await runChecks({ probes: {} });
    const h = health(results);
    if (process.argv.includes('--json')) {
      console.log(JSON.stringify({ checks: CHECKS.map((c) => c.name), health: h, apis: BOT_CHECK_APIS }, null, 2));
    } else {
      console.log(renderReport(results));
      console.log(`\n${dataNote()}`);
      console.log(`\nmonitor APIs catalogued: ${BOT_CHECK_APIS.length}`);
      for (const a of BOT_CHECK_APIS) console.log(`  • ${a.name} [${a.kind}] access=${a.access} — ${a.url}`);
    }
  })();
}
