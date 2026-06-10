// spamtest/runner.mjs — the controlled forum spam-bot (old-queue #299).
//
// Operator: "have a Bot Spam the Forum, and see how we can Rate Limit that."
//
// This is the spam BOT. It composes a flood of forum ops (posts / comments / votes)
// from a designated test account (default: spambot1, which already exists on the
// testnet faucet) and either:
//
//   • DRY-RUN (default): builds the op plan, runs it through spamtest/limits.mjs to
//     show exactly what the chain + the application limiter WOULD accept/reject, and
//     prints the verdict. NOTHING is broadcast. This is the safe, repeatable mode and
//     is what runs in this Codespace / in tests.
//
//   • --broadcast: actually fires the ops at the chain — through MELEK-Signer (a scoped
//     bearer token), NEVER a local WIF (BRIEF.md §7, CLAUDE.md custody rules). There is
//     no local-key path by construction. This mode is OPERATOR-PRESENT / key-gated and
//     is the live half of the test (watch the chain reject the flood).
//
// CLI:
//   node spamtest/runner.mjs --count 50                      dry-run 50 posts
//   node spamtest/runner.mjs --count 50 --kind comment       50 comments
//   node spamtest/runner.mjs --count 30 --mix                posts+comments+votes mix
//   node spamtest/runner.mjs --count 50 --interval 1         fire one op/sec (vs instant)
//   node spamtest/runner.mjs --count 50 --policy resident    apply the resident app-policy
//   node spamtest/runner.mjs --count 50 --kind comment --rc 0       RC sim: 0-budget acct → all blocked
//   node spamtest/runner.mjs --count 50 --kind comment --rc 5000 --interval 4   RC depletes then recovers
//   node spamtest/runner.mjs --count 20 --broadcast          LIVE (signer-gated)
//
// House style: ESM, soft-fail, injectable signer for tests, CLI guarded by argv[1].

import { replayChainConsensus, applicationLimiter, POLICY, bandwidthVerdict, simulateSpam, MIN_REPLY_INTERVAL_HF20_SEC } from './limits.mjs';

const SPAM_BODY =
  'gm gm gm buy now 🚀🚀🚀 click here for free MELEK airdrop ' +
  'visit my channel like and subscribe to the moon wen lambo ';

/**
 * Build a deterministic spam plan: N ops of the requested kind(s), timestamped at a
 * fixed interval (seconds). `intervalSec=0` = "fire everything at once" (the worst
 * case — instant flood). Bodies are intentionally spammy + near-identical (the kind of
 * thing a runaway AI resident or a bad actor emits).
 *
 * @param {object} args
 * @param {number} args.count
 * @param {string} [args.kind]      post|comment|vote (ignored when mix=true)
 * @param {boolean} [args.mix]      cycle post→comment→vote
 * @param {number} [args.intervalSec] seconds between ops (default 0 = instant)
 * @param {string} [args.account]   author/voter account
 * @param {string} [args.target]    parent author/permlink target for comments/votes
 * @returns {Array<{i:number, kind:string, tSec:number, sizeBytes:number, op:Array}>}
 */
export function buildPlan({ count, kind = 'post', mix = false, intervalSec = 0, account = 'spambot1', target = 'hathor/introducing-hathor-on-melek' } = {}) {
  const [tAuthor, tPermlink] = target.split('/');
  const cycle = ['post', 'comment', 'vote'];
  const plan = [];
  for (let i = 0; i < count; i++) {
    const k = mix ? cycle[i % cycle.length] : kind;
    const tSec = i * intervalSec;
    const body = `${SPAM_BODY} #${i} ${Date.now()}`;
    let op, sizeBytes;
    if (k === 'vote') {
      op = ['vote', { voter: account, author: tAuthor, permlink: tPermlink, weight: 10000 }];
      sizeBytes = JSON.stringify(op).length;
    } else if (k === 'comment' || k === 'reply') {
      const permlink = `re-spam-${i}-${Date.now()}`;
      op = ['comment', {
        parent_author: tAuthor, parent_permlink: tPermlink,
        author: account, permlink, title: '', body,
        json_metadata: JSON.stringify({ app: 'spamtest/0.1', tags: ['spam'] }),
      }];
      sizeBytes = JSON.stringify(op).length;
    } else { // post
      const permlink = `spam-post-${i}-${Date.now()}`;
      op = ['comment', {
        parent_author: '', parent_permlink: 'spam',
        author: account, permlink, title: `Spam post #${i}`, body,
        json_metadata: JSON.stringify({ app: 'spamtest/0.1', tags: ['spam'] }),
      }];
      sizeBytes = JSON.stringify(op).length;
    }
    plan.push({ i, kind: k === 'reply' ? 'comment' : k, tSec, sizeBytes, op });
  }
  return plan;
}

/**
 * Dry-run a plan: report chain-consensus verdict + application-limiter verdict, with
 * no broadcasting whatsoever. This is the analytical heart of the test.
 *
 * @param {Array} plan          from buildPlan()
 * @param {object} [opts]
 * @param {object} [opts.config]    raw get_config (probe.mjs supplies live; {} = defaults)
 * @param {object} [opts.policyName] 'unverified'|'resident'|'human' (default unverified)
 * @param {number} [opts.vestsShare] account stake share for the bandwidth model (default ~0)
 * @param {() => number} [opts.now]  ms-clock injector for the app limiter (tests)
 */
export function dryRun(plan, { config = {}, policyName = 'unverified', vestsShare = 0.0000002, now } = {}) {
  // 1) chain consensus interval replay
  const chain = replayChainConsensus(plan, config);

  // 2) bandwidth shape for this account/stake
  const bw = bandwidthVerdict({ vestsShare }, config);

  // 3) application limiter — replay the plan in op-time order through the limiter.
  //    We advance a virtual ms-clock by each op's tSec so minGap/quotas apply as they
  //    would live. (When all tSec=0, the limiter sees an instant flood — worst case.)
  const policy = POLICY[policyName] || POLICY.unverified;
  let virtualMs = now ? now() : 0;
  const lim = applicationLimiter({ policy, now: () => virtualMs });
  const appAccepted = [];
  const appRejected = [];
  for (const op of [...plan].sort((a, b) => a.tSec - b.tSec)) {
    virtualMs = (op.tSec * 1000) + (now ? now() : 0);
    const v = lim.admit(op.account || 'spambot1', op.kind);
    if (v.allowed) appAccepted.push(op);
    else appRejected.push({ ...op, reason: v.reason, retryAfterSec: v.retryAfterSec });
  }

  return {
    chain,
    bandwidth: bw,
    application: {
      policy: policyName,
      accepted: appAccepted,
      rejected: appRejected,
      summary: { total: plan.length, accepted: appAccepted.length, rejected: appRejected.length },
    },
    // the headline: what actually reaches the forum is the INTERSECTION of (passes app
    // limiter) AND (passes chain consensus). The app layer is meant to be the binding
    // constraint so the chain never has to reject a resident.
    wouldReachForum: Math.min(chain.summary.accepted, appAccepted.length),
  };
}

/**
 * Broadcast a plan LIVE through MELEK-Signer. Signer-gated; throws (soft) if no signer.
 * NEVER takes a WIF. Respects the application limiter in real time — i.e. the runner
 * itself behaves like the condenser would, so a --broadcast run demonstrates the
 * limiter holding the line, not just the chain.
 *
 * @param {Array} plan
 * @param {object} args
 * @param {object} args.signer   { broadcast(ops,{clientRef}) } — MELEK-Signer client
 * @param {object} [args.config]
 * @param {string} [args.policyName]
 * @param {object} [args.logger]
 */
export async function broadcastPlan(plan, { signer, config = {}, policyName = 'unverified', logger = console } = {}) {
  if (!signer || typeof signer.broadcast !== 'function') {
    throw new Error('broadcastPlan: signer not configured — set MELEK_SIGNER_URL/MELEK_SIGNER_TOKEN. No local-key fallback by design.');
  }
  const lim = applicationLimiter({ policy: POLICY[policyName] || POLICY.unverified });
  const results = { sent: [], blockedByApp: [], rejectedByChain: [] };
  for (const item of [...plan].sort((a, b) => a.tSec - b.tSec)) {
    const account = item.op[1]?.author || item.op[1]?.voter || 'spambot1';
    const verdict = lim.check(account, item.kind);
    if (!verdict.allowed) {
      results.blockedByApp.push({ i: item.i, kind: item.kind, reason: verdict.reason });
      logger.log(`[spamtest] APP-BLOCKED #${item.i} ${item.kind}: ${verdict.reason}`);
      continue;
    }
    try {
      const r = await signer.broadcast([item.op], { clientRef: `spamtest-${item.kind}-${item.i}` });
      lim.record(account, item.kind);
      results.sent.push({ i: item.i, kind: item.kind, id: r?.id ?? null });
      logger.log(`[spamtest] SENT #${item.i} ${item.kind}: ${r?.id ?? '(no id)'}`);
    } catch (err) {
      // a chain rejection (e.g. "bandwidth limit exceeded" / "comment interval") is the
      // POINT of the live test — record it, keep going.
      results.rejectedByChain.push({ i: item.i, kind: item.kind, reason: err.message });
      logger.log(`[spamtest] CHAIN-REJECTED #${item.i} ${item.kind}: ${err.message}`);
    }
  }
  return results;
}

// ── CLI ────────────────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const a = { count: 20, kind: 'post', mix: false, intervalSec: 0, policy: 'unverified', broadcast: false, account: 'spambot1', rc: null };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === '--count') a.count = parseInt(argv[++i], 10) || a.count;
    else if (t === '--kind') a.kind = argv[++i];
    else if (t === '--mix') a.mix = true;
    else if (t === '--interval') a.intervalSec = parseFloat(argv[++i]) || 0;
    else if (t === '--policy') a.policy = argv[++i];
    else if (t === '--account') a.account = argv[++i];
    else if (t === '--broadcast') a.broadcast = true;
    else if (t === '--rc') a.rc = parseFloat(argv[++i]) || 0; // RC budget → run the RC simulator
  }
  return a;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  // --rc <budget>: run the dedicated RC + interval simulator (simulateSpam). This is the
  // depleting/recovering-budget view: "given this RC pool, how many ops land?" Fully
  // offline, never broadcasts. Comments default to the HF20 3s reply interval.
  if (args.rc !== null) {
    const r = simulateSpam({
      ops: args.count,
      intervalMs: Math.round(args.intervalSec * 1000),
      rcBudget: args.rc,
      kind: args.kind === 'post' ? 'comment' : args.kind, // default the spam kind to comment
      minIntervalSec: MIN_REPLY_INTERVAL_HF20_SEC,
    });
    console.log('\n=== RC SIMULATION (simulateSpam) ===');
    console.log(`ops: ${args.count}  kind: ${args.kind === 'post' ? 'comment' : args.kind}  interval: ${args.intervalSec}s  rcBudget: ${args.rc}`);
    console.log(`  accepted ${r.summary.accepted}/${r.summary.total}, rejected ${r.summary.rejected}`);
    console.log('  rejected by reason:', r.summary.byReason);
    console.log(`  RC remaining: ${r.rcRemaining}`);
    if (r.rejected[0]) console.log(`  e.g. #${r.rejected[0].i}: ${r.rejected[0].reason}`);
    return;
  }

  const plan = buildPlan({ count: args.count, kind: args.kind, mix: args.mix, intervalSec: args.intervalSec, account: args.account });

  // Try to load the LIVE chain config so the verdict uses real limits. Soft-fail to
  // defaults (offline / no RPC) so the dry-run always works.
  let config = {};
  try {
    const { fetchConfig } = await import('./probe.mjs');
    config = await fetchConfig();
    console.log('[spamtest] using LIVE chain config from probe');
  } catch {
    console.log('[spamtest] no live config (offline) — using decoded defaults');
  }

  if (!args.broadcast) {
    const r = dryRun(plan, { config, policyName: args.policy });
    console.log('\n=== DRY-RUN spam plan ===');
    console.log(`account: ${args.account}  ops: ${args.count}  kind: ${args.mix ? 'mix' : args.kind}  interval: ${args.intervalSec}s  policy: ${args.policy}`);
    console.log('\n— CHAIN CONSENSUS (every node enforces) —');
    console.log(`  accepted ${r.chain.summary.accepted}/${r.chain.summary.total}, rejected ${r.chain.summary.rejected}`);
    console.log(`  rejected by kind:`, r.chain.summary.rejectedByKind);
    if (r.chain.rejected[0]) console.log(`  e.g. ${r.chain.rejected[0].reason}`);
    console.log('\n— BANDWIDTH / RESERVE-RATIO (stake-weighted) —');
    console.log(`  ${r.bandwidth.note}`);
    console.log('\n— APPLICATION LIMITER (the condenser, policy: ' + args.policy + ') —');
    console.log(`  accepted ${r.application.summary.accepted}/${r.application.summary.total}, rejected ${r.application.summary.rejected}`);
    if (r.application.rejected[0]) console.log(`  e.g. ${r.application.rejected[0].reason}`);
    console.log(`\n>>> WOULD REACH THE FORUM: ${r.wouldReachForum} of ${args.count} ops`);
    console.log('    (the rest are throttled by the app limiter and/or rejected by consensus)');
    return;
  }

  // LIVE broadcast path — signer-gated.
  let signer = null;
  try {
    const { fromEnv } = await import('../src/chain/melek-signer-client.mjs');
    signer = fromEnv();
  } catch { /* fall through to the guard below */ }
  if (!signer) {
    console.error('[spamtest] --broadcast requires MELEK_SIGNER_URL + MELEK_SIGNER_TOKEN (operator-present, key-gated). Aborting; no local-key fallback by design.');
    process.exit(1);
  }
  console.log('[spamtest] LIVE broadcast — operator-present run. The app limiter + chain will throttle the flood.');
  const res = await broadcastPlan(plan, { signer, config, policyName: args.policy });
  console.log('\n=== LIVE result ===');
  console.log(`  sent ${res.sent.length}  app-blocked ${res.blockedByApp.length}  chain-rejected ${res.rejectedByChain.length}`);
}

if (process.argv[1] && process.argv[1].endsWith('runner.mjs')) {
  main().catch((err) => { console.error('[spamtest] fatal:', err.message); process.exit(1); });
}
