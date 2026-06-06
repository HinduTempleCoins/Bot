// bringup-check.mjs — old-queue #289: the AI-Witness full bring-up validation harness.
//
// ONE command exercises every AI-Witness surface end-to-end against a live MELEK testnet RPC
// and prints a ✓/✗ scorecard:
//
//     node witness/bringup-check.mjs --rpc $MELEK_RPC_URL
//     node witness/bringup-check.mjs --rpc $MELEK_RPC_URL --json
//
// It is READ-ONLY by construction. It holds NO keys and NEVER signs or broadcasts. Anything that
// would require the active key (e.g. actually publishing a feed) is reported as SKIPPED (key-gated)
// with the exact command the operator's existing timer already runs — never attempted here.
//
// Every check is SOFT-FAIL: a thrown error, an unreachable RPC, or a malformed response yields a
// `fail` line with a short reason, never an exception that aborts the whole run. Each check is a
// separate line in the scorecard so a single broken surface doesn't mask the others.
//
// HOUSE STYLE: ESM .mjs, injectable fetch via __setFetch (offline tests never touch the network),
// CLI guarded by process.argv[1], soft-fail-never-throw. The RPC transport mirrors the JSON-RPC
// shape signup/server.mjs already uses against the condenser ({ jsonrpc, method, params, id }).
//
// It WIRES TO the existing surfaces — it does not re-implement them:
//   - commands/menu.mjs        — runs the real !balance / !witness / !post-count handlers
//   - src/trollbox/chain-connector.mjs — reads the melek_trollbox custom_json stream (read-only)
//   - signup/server.mjs        — handler-level smoke (in-process)
//   - tutorial/composers.mjs   — deterministic lesson composer smoke (in-process, pure)
//   - witness/monitor.mjs      — the witness monitor's read-only checks (injected client)

// ── expectations ──────────────────────────────────────────────────────────────────────────────
// Testnet defaults (CLAUDE.md Status): prefix TST, chain id 18dcf0…274e. The full chain id can be
// pinned via --chain-id / MELEK_CHAIN_ID; otherwise we assert only the address prefix, which is the
// cheap, stable invariant ("TST" testnet vs "MELEK" mainnet).
export const DEFAULT_EXPECT = {
  account: 'hathor',
  addressPrefix: 'TST',
  introPermlink: 'introducing-hathor-on-melek',
  feedMaxAgeMs: 2 * 60 * 60 * 1000, // < 2h
  recentBlockRounds: 21,            // look back ~one full schedule round for a hathor-signed block
};

// ── injectable fetch ────────────────────────────────────────────────────────────────────────────
let _fetch = (...a) => globalThis.fetch(...a);
/** Inject a fetch implementation. Pass nothing/false to restore global fetch. Tests inject fixtures. */
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

// ── JSON-RPC transport ──────────────────────────────────────────────────────────────────────────
/**
 * Build a read-only RPC caller bound to `rpcUrl`. Returns async (method, params) => result.
 * Mirrors the condenser/steemd JSON-RPC shape. Throws on transport or RPC-level error so callers
 * can soft-fail per-check.
 *
 * @param {string} rpcUrl
 * @param {{ timeoutMs?: number }} [opts]
 */
export function makeRpc(rpcUrl, { timeoutMs = 15000 } = {}) {
  return async function rpc(method, params = []) {
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
    try {
      const res = await _fetch(rpcUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method, params, id: 1 }),
        signal: ctrl ? ctrl.signal : undefined,
      });
      if (res && typeof res.ok === 'boolean' && !res.ok) {
        throw new Error(`HTTP ${res.status ?? '?'}`);
      }
      const j = await res.json();
      if (j && j.error) throw new Error(j.error.message || 'rpc error');
      return j ? j.result : null;
    } finally {
      if (timer) clearTimeout(timer);
    }
  };
}

// ── result helpers ──────────────────────────────────────────────────────────────────────────────
const pass = (name, detail = '', extra = {}) => ({ name, status: 'pass', detail, ...extra });
const fail = (name, detail = '', extra = {}) => ({ name, status: 'fail', detail, ...extra });
const skip = (name, detail = '', extra = {}) => ({ name, status: 'skip', detail, ...extra });

function num(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }

// The Graphene null/"no signing authority" key convention: body is all 1s.
function isNullSigningKey(key) {
  if (key == null) return true;
  const s = String(key).trim();
  if (s === '') return true;
  const body = s.replace(/^[A-Za-z]{2,6}/, '');
  return /^1+[A-Za-z0-9]{0,12}$/.test(body) && (body.match(/1/g) || []).length >= 30;
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// CHECKS — each: async (rpc, expect) => result. Soft-fail; never throw.
// ════════════════════════════════════════════════════════════════════════════════════════════════

// 1. RPC reachable + chain id / address-prefix matches expectation (prefix TST).
export async function checkRpcAndChainId(rpc, expect = DEFAULT_EXPECT) {
  const NAME = 'RPC reachable + chain id';
  let cfg, ver, gprops;
  try {
    gprops = await rpc('condenser_api.get_dynamic_global_properties', []);
  } catch (e) {
    return fail(NAME, `unreachable: ${e?.message || e}`);
  }
  if (!gprops || num(gprops.head_block_number) == null) {
    return fail(NAME, 'no dynamic global properties returned');
  }
  // get_config carries the address prefix (e.g. STEEMIT_ADDRESS_PREFIX) and chain id on this fork.
  try { cfg = await rpc('condenser_api.get_config', []); } catch { cfg = null; }
  try { ver = await rpc('condenser_api.get_version', []); } catch { ver = null; }

  const prefix = cfg
    ? (cfg.STEEMIT_ADDRESS_PREFIX || cfg.STEEM_ADDRESS_PREFIX || cfg.ADDRESS_PREFIX || cfg.IS_TEST_NET_PREFIX || null)
    : null;
  const chainId = (ver && (ver.chain_id || ver.CHAIN_ID))
    || (cfg && (cfg.STEEM_CHAIN_ID || cfg.CHAIN_ID))
    || null;

  const head = num(gprops.head_block_number);
  const details = [`head=${head}`];

  // Address prefix is the cheap, stable testnet invariant.
  if (expect.addressPrefix) {
    if (prefix == null) {
      details.push(`prefix=unknown(expected ${expect.addressPrefix})`);
    } else if (prefix !== expect.addressPrefix) {
      return fail(NAME, `address prefix ${prefix} != expected ${expect.addressPrefix}`, { head, prefix, chainId });
    } else {
      details.push(`prefix=${prefix}`);
    }
  }
  // Chain id only asserted when explicitly pinned (full id is long; prefix is the usual signal).
  if (expect.chainId) {
    if (chainId == null) {
      details.push('chainId=unknown');
    } else if (chainId !== expect.chainId) {
      return fail(NAME, `chain id ${String(chainId).slice(0, 12)}… != expected ${String(expect.chainId).slice(0, 12)}…`, { head, prefix, chainId });
    } else {
      details.push(`chainId=${String(chainId).slice(0, 8)}…`);
    }
  } else if (chainId) {
    details.push(`chainId=${String(chainId).slice(0, 8)}…`);
  }

  return pass(NAME, details.join(' '), { head, prefix, chainId });
}

// 2. hathor account exists; witness object registered; signing key set; URL set.
export async function checkAccountAndWitness(rpc, expect = DEFAULT_EXPECT) {
  const NAME = 'Account + witness registered';
  const account = expect.account;
  let accts, witness;
  try {
    accts = await rpc('condenser_api.get_accounts', [[account]]);
  } catch (e) {
    return fail(NAME, `account lookup failed: ${e?.message || e}`);
  }
  const acct = Array.isArray(accts) ? accts[0] : null;
  if (!acct) return fail(NAME, `@${account} does not exist on this chain`);

  try {
    witness = await rpc('condenser_api.get_witness_by_account', [account]);
  } catch (e) {
    return fail(NAME, `witness lookup failed: ${e?.message || e}`);
  }
  if (!witness) return fail(NAME, `@${account} exists but is not a registered witness`);

  const problems = [];
  if (isNullSigningKey(witness.signing_key)) problems.push('signing key is null/disabled');
  if (!witness.url || String(witness.url).trim() === '') problems.push('witness URL not set');
  if (problems.length) {
    return fail(NAME, problems.join('; '), { signingKey: witness.signing_key, url: witness.url });
  }
  return pass(NAME, `@${account} exists; witness registered; key set; url=${witness.url}`, {
    url: witness.url,
    totalMissed: num(witness.total_missed),
    lastConfirmedBlock: num(witness.last_confirmed_block_num),
  });
}

// 3. Block production: hathor in the active schedule; recent block signed by hathor; missed count + delta.
export async function checkBlockProduction(rpc, expect = DEFAULT_EXPECT, { previous = null } = {}) {
  const NAME = 'Block production';
  const account = expect.account;
  let schedule, gprops, witness;
  try {
    gprops = await rpc('condenser_api.get_dynamic_global_properties', []);
    schedule = await rpc('condenser_api.get_witness_schedule', []);
    witness = await rpc('condenser_api.get_witness_by_account', [account]);
  } catch (e) {
    return fail(NAME, `schedule/witness read failed: ${e?.message || e}`);
  }

  const shuffled = (schedule && (schedule.current_shuffled_witnesses || schedule.shuffled_witnesses)) || [];
  const inSchedule = Array.isArray(shuffled) && shuffled.includes(account);
  if (!inSchedule) {
    return fail(NAME, `@${account} is not in the active witness schedule`, { inSchedule });
  }

  const totalMissed = num(witness?.total_missed) ?? 0;
  const delta = previous && num(previous.totalMissed) != null
    ? totalMissed - num(previous.totalMissed)
    : null;

  // Walk back up to `recentBlockRounds` blocks looking for one whose `witness` field is hathor.
  const head = num(gprops?.head_block_number) ?? 0;
  let signedRecently = false;
  let signedBlock = null;
  const lookback = Math.max(1, expect.recentBlockRounds || 21);
  for (let i = 0; i < lookback && head - i > 0; i++) {
    const bn = head - i;
    let blk;
    try { blk = await rpc('condenser_api.get_block', [bn]); } catch { blk = null; }
    if (blk && blk.witness === account) { signedRecently = true; signedBlock = bn; break; }
  }

  const detailBits = [`in schedule`, `missed=${totalMissed}`];
  if (delta != null) detailBits.push(`Δmissed=${delta >= 0 ? '+' : ''}${delta}`);
  if (signedRecently) detailBits.push(`signed block ${signedBlock}`);

  if (!signedRecently) {
    return fail(NAME, `in schedule but no block signed by @${account} in last ${lookback} blocks; missed=${totalMissed}`, {
      inSchedule, totalMissed, delta,
    });
  }
  return pass(NAME, detailBits.join('; '), { inSchedule, totalMissed, delta, signedBlock });
}

// 4. Price feed: last published feed age < 2h; feed history depth.
export async function checkPriceFeed(rpc, expect = DEFAULT_EXPECT, { now = Date.now } = {}) {
  const NAME = 'Price feed freshness';
  const account = expect.account;
  // Prefer the witness's own last_feed_publish (per-witness). Fall back to feed history (chain-wide).
  let witness, feedHistory;
  try { witness = await rpc('condenser_api.get_witness_by_account', [account]); } catch { witness = null; }
  try { feedHistory = await rpc('condenser_api.get_feed_history', []); } catch { feedHistory = null; }

  const histDepth = feedHistory && Array.isArray(feedHistory.price_history)
    ? feedHistory.price_history.length
    : null;

  const lastPub = witness?.last_feed_publish ? Date.parse(witness.last_feed_publish + 'Z') : NaN;
  if (!Number.isFinite(lastPub)) {
    // No per-witness timestamp — fall back to reporting history depth only.
    if (histDepth != null) {
      return fail(NAME, `no last_feed_publish for @${account}; feed history depth=${histDepth}`, { histDepth });
    }
    return fail(NAME, `no feed publish timestamp and no feed history available`, { histDepth });
  }

  const ageMs = now() - lastPub;
  const ageH = (ageMs / 3.6e6).toFixed(2);
  const fresh = ageMs >= 0 && ageMs < (expect.feedMaxAgeMs ?? DEFAULT_EXPECT.feedMaxAgeMs);
  const detail = `last feed ${ageH}h ago` + (histDepth != null ? `; history depth=${histDepth}` : '');
  if (!fresh) return fail(NAME, `stale: ${detail} (max ${(expect.feedMaxAgeMs / 3.6e6).toFixed(1)}h)`, { ageMs, histDepth });
  return pass(NAME, detail, { ageMs, histDepth });
}

// 5. Intro post exists (@hathor/introducing-hathor-on-melek) and is readable.
export async function checkIntroPost(rpc, expect = DEFAULT_EXPECT) {
  const NAME = 'Intro post readable';
  const account = expect.account;
  const permlink = expect.introPermlink;
  let content;
  try {
    content = await rpc('condenser_api.get_content', [account, permlink]);
  } catch (e) {
    return fail(NAME, `get_content failed: ${e?.message || e}`);
  }
  // get_content returns an object with empty author when the post doesn't exist.
  if (!content || !content.author || content.author !== account || !content.body) {
    return fail(NAME, `@${account}/${permlink} not found or empty`);
  }
  const title = String(content.title || '').slice(0, 48);
  return pass(NAME, `@${account}/${permlink} readable ("${title}", ${content.body.length} chars)`, {
    permlink, bodyLen: content.body.length,
  });
}

// 6. Command menu: run the deterministic !commands handlers against the RPC; verify well-formed replies.
export async function checkCommandMenu(rpc, expect = DEFAULT_EXPECT) {
  const NAME = 'Command menu (!balance/!witness/!post-count)';
  let handle;
  try {
    ({ handle } = await import('../commands/menu.mjs'));
  } catch (e) {
    return fail(NAME, `cannot load commands/menu.mjs: ${e?.message || e}`);
  }
  const account = expect.account;
  // Wire the menu's injected deps to real read-only RPC reads.
  const deps = {
    async getAccount(name) {
      const [a] = (await rpc('condenser_api.get_accounts', [[name]])) || [];
      return a || null;
    },
    async getWitness(name) {
      return (await rpc('condenser_api.get_witness_by_account', [name])) || null;
    },
  };

  const results = [];
  try {
    const balance = await handle(`!balance @${account}`, deps);
    const witness = await handle(`!witness @${account}`, deps);
    const postCount = await handle(`!post-count @${account}`, deps);

    // "Well-formed" = non-empty, references the account, and not one of the handlers' soft-error strings.
    const bad = (s) => !s || typeof s !== 'string'
      || /unavailable right now|Could not look up|not found on this chain|is not a witness/i.test(s);
    if (bad(balance)) return fail(NAME, `!balance reply malformed: ${String(balance).slice(0, 60)}`);
    if (bad(witness)) return fail(NAME, `!witness reply malformed: ${String(witness).slice(0, 60)}`);
    if (bad(postCount)) return fail(NAME, `!post-count reply malformed: ${String(postCount).slice(0, 60)}`);

    results.push(`!balance ok`, `!witness ok`, `!post-count ok`);
  } catch (e) {
    return fail(NAME, `handler threw: ${e?.message || e}`);
  }
  return pass(NAME, results.join(', '));
}

// 7. Troll-box: chain-connector can read the melek_trollbox custom_json stream (read-only).
export async function checkTrollbox(rpc, expect = DEFAULT_EXPECT) {
  const NAME = 'Troll-box stream readable';
  let CHAT_ID, pollInbound;
  try {
    ({ CHAT_ID, pollInbound } = await import('../src/trollbox/chain-connector.mjs'));
  } catch (e) {
    return fail(NAME, `cannot load chain-connector.mjs: ${e?.message || e}`);
  }
  // The connector reads via client.customJsonHistory(id, {since,max}); wire it to account_history
  // for the bot account filtered to the troll-box custom_json id (read-only).
  const client = {
    async customJsonHistory(id, { max = 50 } = {}) {
      const hist = await rpc('condenser_api.get_account_history', [expect.account, -1, Math.min(max, 100)]);
      if (!Array.isArray(hist)) return [];
      // history rows: [seq, { op: ['custom_json', {id, json}], ... }]
      return hist
        .map(([seq, row]) => ({ seq, op: row?.op }))
        .filter((r) => Array.isArray(r.op) && r.op[0] === 'custom_json' && r.op[1]?.id === id);
    },
  };
  try {
    const lines = await pollInbound(client, { since: 0, max: 50 });
    // A clean READ is the success criterion — an empty stream is still a passing read.
    return pass(NAME, `read ${CHAT_ID} stream ok (${lines.length} inbound line${lines.length === 1 ? '' : 's'})`, {
      chatId: CHAT_ID, lines: lines.length,
    });
  } catch (e) {
    return fail(NAME, `poll failed: ${e?.message || e}`);
  }
}

// 8. Signup-help server + tutorial composer: handler-level smoke (in-process, no network needed).
export async function checkSignupAndTutorial() {
  const NAME = 'Signup server + tutorial composer (in-process)';
  // 8a. Tutorial composer — pure, deterministic. Compose the first stage's lesson post.
  try {
    const { loadStagesDoc, composeLessonPost } = await import('../tutorial/composers.mjs');
    const doc = loadStagesDoc();
    const stage = doc?.stages?.[0];
    if (!stage) return fail(NAME, 'tutorial: no stages in stages.json');
    const post = composeLessonPost(stage);
    if (!post || !post.title || !post.body) return fail(NAME, 'tutorial: composeLessonPost returned empty');
  } catch (e) {
    return fail(NAME, `tutorial composer threw: ${e?.message || e}`);
  }

  // 8b. Signup server — handler-level smoke against /health and /api/stages with an injected
  // chain fetch so no network is touched. handler(req,res) is exported for exactly this.
  try {
    const server = await import('../signup/server.mjs');
    if (typeof server.__setChainFetch === 'function') {
      server.__setChainFetch(async () => ({ json: async () => ({ result: null }) }));
    }
    const captured = await callHandler(server.handler, { method: 'GET', url: '/health' });
    if (captured.statusCode !== 200 || !/ok/i.test(captured.body)) {
      return fail(NAME, `signup /health did not return ok (status ${captured.statusCode})`);
    }
    const stages = await callHandler(server.handler, { method: 'GET', url: '/api/stages' });
    if (stages.statusCode !== 200) {
      return fail(NAME, `signup /api/stages status ${stages.statusCode}`);
    }
    let parsed;
    try { parsed = JSON.parse(stages.body); } catch { parsed = null; }
    if (!parsed || !Array.isArray(parsed.stages || parsed)) {
      return fail(NAME, 'signup /api/stages did not return a stage list');
    }
  } catch (e) {
    return fail(NAME, `signup handler threw: ${e?.message || e}`);
  }

  return pass(NAME, 'tutorial composer ok; signup /health + /api/stages ok');
}

// Minimal in-process http handler harness: builds a fake req/res, awaits the response. No socket.
function callHandler(handler, { method = 'GET', url = '/', headers = {}, body = '' } = {}) {
  return new Promise((resolve) => {
    const req = makeFakeReq({ method, url, headers, body });
    const res = makeFakeRes(resolve);
    let r;
    try { r = handler(req, res); } catch (e) { resolve({ statusCode: 500, body: String(e?.message || e), headers: {} }); return; }
    if (r && typeof r.then === 'function') r.catch((e) => resolve({ statusCode: 500, body: String(e?.message || e), headers: {} }));
  });
}

function makeFakeReq({ method, url, headers, body }) {
  const listeners = {};
  const req = {
    method, url, headers,
    on(ev, cb) { (listeners[ev] ||= []).push(cb); return req; },
  };
  // Deliver any body asynchronously so handlers that read the stream resolve.
  queueMicrotask(() => {
    if (body) (listeners.data || []).forEach((cb) => cb(Buffer.from(body)));
    (listeners.end || []).forEach((cb) => cb());
  });
  return req;
}

function makeFakeRes(done) {
  let statusCode = 200;
  const headers = {};
  let finished = false;
  const finish = (body) => { if (!finished) { finished = true; done({ statusCode, body: body == null ? '' : String(body), headers }); } };
  return {
    setHeader(k, v) { headers[k.toLowerCase()] = v; },
    getHeader(k) { return headers[k.toLowerCase()]; },
    writeHead(code, hdrs) { statusCode = code; if (hdrs) for (const [k, v] of Object.entries(hdrs)) headers[k.toLowerCase()] = v; return this; },
    write(chunk) { this._buf = (this._buf || '') + (chunk == null ? '' : String(chunk)); },
    end(chunk) { if (chunk != null) this.write(chunk); finish(this._buf || ''); },
    get statusCode() { return statusCode; },
    set statusCode(c) { statusCode = c; },
  };
}

// 9. Watcher: its read-only checks run clean (config validates for read; monitor reads via injected client).
export async function checkWatcher(rpc, expect = DEFAULT_EXPECT) {
  const NAME = 'Witness monitor read-only check';
  let monitorOnce, __setClient;
  try {
    ({ monitorOnce, __setClient } = await import('./monitor.mjs'));
  } catch (e) {
    return fail(NAME, `cannot load monitor.mjs: ${e?.message || e}`);
  }
  // Inject a client that reads via our RPC seam so the monitor's read-only path runs against the
  // live chain without composing its own keyless adapter (and without any network in tests).
  const client = async (account) => {
    const [witness, gprops] = await Promise.all([
      rpc('condenser_api.get_witness_by_account', [account]),
      rpc('condenser_api.get_dynamic_global_properties', []),
    ]);
    return { witness, gprops };
  };
  __setClient(client);
  try {
    const { snapshot } = await monitorOnce({ account: expect.account, previous: null, alert: () => {} });
    if (!snapshot || snapshot.ok === false) {
      return fail(NAME, `monitor read failed: ${snapshot?.error || 'unknown'}`);
    }
    const bits = [`head=${snapshot.headBlock}`, `behind=${snapshot.blocksBehind}`, `missed=${snapshot.totalMissed}`];
    if (snapshot.signingKeyDisabled) return fail(NAME, `signing key disabled; ${bits.join(' ')}`);
    return pass(NAME, bits.join(' '));
  } catch (e) {
    return fail(NAME, `monitor threw: ${e?.message || e}`);
  } finally {
    __setClient(null); // restore default client so we don't leak the injected one
  }
}

// Key-gated surfaces: never attempted here (no keys on this host). Listed as SKIPPED with the exact
// command the operator's own timer already runs.
export function keyGatedSkips() {
  return [
    skip('Price feed PUBLISH (key-gated)',
      'requires active key — operator timer publishes hourly',
      { command: 'node witness/feed-publisher.mjs   (active key fetched JIT from vault per run)' }),
    skip('Witness register/update (key-gated)',
      'requires active key — one-time bootstrap op',
      { command: 'node witness/register.js' }),
    skip('Intro post PUBLISH (key-gated)',
      'requires posting key — already published once',
      { command: 'node witness/publish-intro.js' }),
  ];
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// RUNNER
// ════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Run every check against `rpcUrl` and return the full scorecard.
 * @param {{ rpcUrl: string, expect?: object, now?: () => number }} args
 * @returns {Promise<{ results: Array, summary: {pass:number,fail:number,skip:number,total:number,ok:boolean}, expect: object }>}
 */
export async function runBringupChecks({ rpcUrl, expect = DEFAULT_EXPECT, now = Date.now } = {}) {
  const merged = { ...DEFAULT_EXPECT, ...expect };
  const rpc = makeRpc(rpcUrl);
  const results = [];

  // Run live checks in order; each soft-fails to a `fail` line on its own.
  const safe = async (fn) => {
    try { return await fn(); }
    catch (e) { return fail('internal', `check crashed: ${e?.message || e}`); }
  };

  results.push(await safe(() => checkRpcAndChainId(rpc, merged)));
  results.push(await safe(() => checkAccountAndWitness(rpc, merged)));
  results.push(await safe(() => checkBlockProduction(rpc, merged)));
  results.push(await safe(() => checkPriceFeed(rpc, merged, { now })));
  results.push(await safe(() => checkIntroPost(rpc, merged)));
  results.push(await safe(() => checkCommandMenu(rpc, merged)));
  results.push(await safe(() => checkTrollbox(rpc, merged)));
  results.push(await safe(() => checkSignupAndTutorial()));
  results.push(await safe(() => checkWatcher(rpc, merged)));

  // Key-gated surfaces — always SKIPPED, never attempted (no keys here).
  results.push(...keyGatedSkips());

  const summary = summarize(results);
  return { results, summary, expect: merged };
}

export function summarize(results) {
  const counts = { pass: 0, fail: 0, skip: 0 };
  for (const r of results) counts[r.status] = (counts[r.status] || 0) + 1;
  return {
    ...counts,
    total: results.length,
    ok: counts.fail === 0, // skips don't fail the bring-up; only `fail` does
  };
}

// ── rendering ─────────────────────────────────────────────────────────────────────────────────
const GLYPH = { pass: '✓', fail: '✗', skip: '·' };

/** Render the human scorecard as a string. */
export function renderScorecard({ results, summary, expect }) {
  const lines = [];
  lines.push('');
  lines.push('  MELEK AI Witness — bring-up scorecard');
  lines.push(`  account: @${expect.account}   expect prefix: ${expect.addressPrefix}`);
  lines.push('  ' + '─'.repeat(60));
  for (const r of results) {
    const g = GLYPH[r.status] || '?';
    const tag = r.status === 'skip' ? ' (SKIPPED)' : '';
    lines.push(`  ${g} ${r.name}${tag}`);
    if (r.detail) lines.push(`      ${r.detail}`);
    if (r.status === 'skip' && r.command) lines.push(`      → ${r.command}`);
  }
  lines.push('  ' + '─'.repeat(60));
  lines.push(`  ${summary.pass} passed · ${summary.fail} failed · ${summary.skip} skipped (of ${summary.total})`);
  lines.push(`  bring-up: ${summary.ok ? '✓ GREEN' : '✗ has failures'}`);
  lines.push('');
  return lines.join('\n');
}

// ── arg parsing ─────────────────────────────────────────────────────────────────────────────────
export function parseArgs(argv) {
  const out = { json: false, rpcUrl: null, expect: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') out.json = true;
    else if (a === '--rpc' || a === '--rpc-url') out.rpcUrl = argv[++i];
    else if (a === '--account') out.expect.account = argv[++i];
    else if (a === '--prefix') out.expect.addressPrefix = argv[++i];
    else if (a === '--chain-id') out.expect.chainId = argv[++i];
  }
  out.rpcUrl = out.rpcUrl || process.env.MELEK_RPC_URL || null;
  if (process.env.MELEK_CHAIN_ID && !out.expect.chainId) out.expect.chainId = process.env.MELEK_CHAIN_ID;
  if (process.env.MELEK_ADDRESS_PREFIX && !out.expect.addressPrefix) out.expect.addressPrefix = process.env.MELEK_ADDRESS_PREFIX;
  if (process.env.HATHOR_ACCOUNT && !out.expect.account) out.expect.account = process.env.HATHOR_ACCOUNT;
  return out;
}

// ── CLI (guarded) ─────────────────────────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('bringup-check.mjs')) {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.rpcUrl) {
    console.error('usage: node witness/bringup-check.mjs --rpc $MELEK_RPC_URL [--json] [--account hathor] [--prefix TST] [--chain-id <id>]');
    process.exit(2);
  }
  const report = await runBringupChecks({ rpcUrl: opts.rpcUrl, expect: opts.expect });
  if (opts.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(renderScorecard(report));
  }
  process.exit(report.summary.ok ? 0 : 1);
}
