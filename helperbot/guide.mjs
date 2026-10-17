// guide.mjs — GUIDE MODE: Hathor walks a user through any WORKING flow one step at a time, and — wherever
// the step leaves a trace on a chain — CHECKS IT ON-CHAIN before moving on. She never takes a password or
// key: every signature happens in the user's own browser/wallet; the guide only reads public state for the
// public account name / 0x address the user gives.
//
//   !guide                        list guides (featured crypto flows first)
//   !guide <topic> [@acct|0x…] [testnet|mainnet]   start (topic = id, alias or plain words)
//   !guide set @acct | 0x…        add the account/address a check needs
//   !next                         verify the current step (on-chain where possible) then advance
//   !step / !back / !guide stop   repeat / go back / end
//
// Flows come from the live site map (https://melek.salon/map/flows.json — WORKS / NOT FINISHED, generated
// by the site-maps crawler) with a vendored snapshot as fallback. A NOT FINISHED flow only ever gets its
// one-line Under Construction notice. Steps with no on-chain trace are labelled "self-check" and advance on
// the user's word — the guide never pretends to have verified what it can't.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { getJSON, prana, melek, melekEngine, units, fmt, CFG } from './live.mjs';
import { PRANA } from './addresses.mjs';
import { defaultStore } from './store.mjs';
import { parseIdentity } from './links.mjs';
import { poolLoginAddress } from '../pool/www/wizard.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FLOWS_URL = process.env.HELPERBOT_FLOWS_URL || 'https://melek.salon/map/flows.json';
const FLOWS_TTL = 10 * 60_000;

let _snapshot = null;
function snapshot() {
  if (!_snapshot) {
    try { _snapshot = JSON.parse(readFileSync(join(HERE, 'data', 'flows.snapshot.json'), 'utf8')); } catch { _snapshot = []; }
  }
  return _snapshot;
}

let _flows = { at: 0, list: null };
export function __setFlows(list) { _flows = { at: list ? Date.now() + 1e12 : 0, list }; }

/** All flows: live map (10-min cache) → vendored snapshot. Never throws. */
export async function loadFlows(now = Date.now()) {
  if (_flows.list && now - _flows.at < FLOWS_TTL) return _flows.list;
  const live = await getJSON(FLOWS_URL);
  if (Array.isArray(live) && live.length && live.every((f) => f && f.id && f.status)) {
    _flows = { at: now, list: live };
    return live;
  }
  return _flows.list || snapshot();
}

// Featured order + friendly aliases (operator's list: bridge, swap, pool, stake veKULA, MELEK→WMELEK,
// signup, first post, autovote, mining).
export const FEATURED = ['create-melek-account', 'first-post-melek-salon', 'testnet-faucet-tokens', 'prana-testnet-faucet', 'add-prana-metamask', 'bridge-vkbt-cure-prana', 'kulaswap-swap', 'stake-kula-vekula', 'melek-to-wmelek-engine', 'autovote-curation', 'pool-browser-mine', 'pool-own-miner-xmrig', 'mining-servers', 'become-a-witness', 'staged-tutorial'];
export const ALIASES = {
  signup: 'create-melek-account', account: 'create-melek-account', register: 'create-melek-account', 'sign-up': 'create-melek-account',
  post: 'first-post-melek-salon', 'first-post': 'first-post-melek-salon', introduce: 'first-post-melek-salon',
  bridge: 'bridge-vkbt-cure-prana', swap: 'kulaswap-swap', kulaswap: 'kulaswap-swap', trade: 'kulaswap-swap',
  stake: 'stake-kula-vekula', vekula: 'stake-kula-vekula', lock: 'stake-kula-vekula',
  wmelek: 'melek-to-wmelek-engine', wrap: 'melek-to-wmelek-engine',
  autovote: 'autovote-curation', curation: 'autovote-curation', trail: 'autovote-curation',
  pool: 'pool-browser-mine', mine: 'pool-browser-mine', 'browser-mine': 'pool-browser-mine', xmrig: 'pool-own-miner-xmrig', miner: 'pool-own-miner-xmrig',
  mining: 'mining-servers', servers: 'mining-servers', witness: 'become-a-witness',
  faucet: 'prana-testnet-faucet', 'test-prana': 'prana-testnet-faucet', 'test-tokens': 'testnet-faucet-tokens',
  metamask: 'add-prana-metamask', network: 'add-prana-metamask', tutorial: 'staged-tutorial',
  recover: 'recover-account', recovery: 'recover-account', farm: 'farm-kula', farming: 'farm-kula',
};

const STOP = new Set(['how', 'do', 'i', 'to', 'the', 'a', 'an', 'my', 'on', 'in', 'of', 'for', 'and', 'me', 'can', 'you', 'what', 'is', 'with', 'get', 'use', 'it']);
const toks = (s) => String(s || '').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w && !STOP.has(w));

/** findFlow(query, flows) → flow | null. id → alias → phrasing/intent word overlap. */
export function findFlow(query, flows) {
  const q = String(query || '').toLowerCase().trim();
  if (!q) return null;
  const byId = new Map(flows.map((f) => [f.id, f]));
  if (byId.has(q)) return byId.get(q);
  const first = q.split(/\s+/)[0];
  if (ALIASES[q] && byId.has(ALIASES[q])) return byId.get(ALIASES[q]);
  if (ALIASES[first] && byId.has(ALIASES[first])) return byId.get(ALIASES[first]);
  const qt = toks(q);
  if (!qt.length) return null;
  let best = null;
  let score = 0;
  for (const f of flows) {
    const bag = new Set(toks([f.id, f.intent, ...(f.phrasings || [])].join(' ')));
    const s = qt.filter((w) => bag.has(w)).length / qt.length;
    if (s > score) { score = s; best = f; }
  }
  return score >= 0.5 ? best : null;
}

// ── on-chain step checks ──────────────────────────────────────────────────────────────────────────
// Each verifier: { needs: 'account'|'address'|null, baseline(s) → object, steps: { n: async (s) → {ok, detail} } }
// ok:true → advance; ok:false → stay with detail; ok:null → could not read (stay, say so).
const vesting = (a) => parseFloat(a.vesting_shares || '0') + parseFloat(a.received_vesting_shares || '0');

async function needAccount(s, net) {
  if (!s.account) return { ok: false, detail: 'I need your PUBLIC account name for this check: `!guide set @yourname`' };
  const a = await melek.account(s.account, net || s.net || 'mainnet');
  if (a === null) return { ok: null, detail: 'I can\'t reach the MELEK chain right now — try `!next` again shortly.' };
  if (a === false) return { ok: false, detail: `@${s.account} doesn't exist on MELEK ${net || s.net || 'mainnet'} yet.` };
  return { ok: true, acct: a };
}
function needAddress(s) {
  if (!s.address) return { ok: false, detail: 'I need your PUBLIC 0x address for this check: `!guide set 0x…`' };
  return { ok: true };
}
const tokenBal = async (token, who, dec) => units(await prana.balanceOf(token, who), dec);

export const VERIFIERS = {
  'create-melek-account': {
    needs: 'account', defaultNet: 'testnet',
    steps: {
      1: async (s) => {
        if (!s.account) return { ok: false, detail: 'Tell me the name you want: `!guide set @yourname`' };
        const a = await melek.account(s.account, s.net);
        if (a === null) return { ok: null, detail: 'Can\'t reach the chain to check the name — try again.' };
        return a === false ? { ok: true, detail: `@${s.account} is free ✅` } : { ok: false, detail: `@${s.account} is already taken on ${s.net}. If it's yours, you're already signed up — otherwise pick another and \`!guide set @newname\`.` };
      },
      4: async (s) => { const r = await needAccount(s); return r.ok ? { ok: true, detail: `@${s.account} exists on-chain ✅` } : r; },
      6: async (s) => {
        const r = await needAccount(s);
        if (!r.ok) return r;
        const funded = parseFloat(r.acct.balance) > 0 || parseFloat(r.acct.received_vesting_shares || '0') > 0;
        return funded ? { ok: true, detail: `Welcome grant landed: ${r.acct.balance} + POWER ✅` } : { ok: false, detail: 'The welcome grant hasn\'t landed yet — it usually takes a few minutes. Try `!next` again soon.' };
      },
    },
  },
  'first-post-melek-salon': {
    needs: 'account', defaultNet: 'mainnet',
    baseline: async (s) => { const a = s.account ? await melek.account(s.account, s.net) : null; return { posts: a ? Number(a.post_count) : null }; },
    steps: {
      1: async (s) => { const r = await needAccount(s); return r.ok ? { ok: true, detail: `@${s.account} found ✅ (log in on melek.salon in your browser — never here)` } : r; },
      3: async (s) => {
        const r = await needAccount(s);
        if (!r.ok) return r;
        const base = s.baseline && s.baseline.posts !== null ? s.baseline.posts : null;
        const now = Number(r.acct.post_count);
        if (base === null) s.baseline = { posts: now };
        return base !== null && now > base ? { ok: true, detail: `New post seen on-chain (post count ${base} → ${now}) ✅` } : { ok: false, detail: 'I don\'t see a new post from you yet. Publish it, wait ~10s, then `!next`.' };
      },
    },
  },
  'testnet-faucet-tokens': {
    needs: 'account', defaultNet: 'testnet',
    baseline: async (s) => ({ alpha: s.address ? units(await prana.nativeBalance(s.address, 'alpha'), 18) : null }),
    steps: {
      1: async (s) => { const r = await needAccount(s, 'testnet'); return r.ok ? { ok: true, detail: `@${s.account} exists on the testnet ✅` } : r; },
      2: async (s) => { const r = await needAccount(s, 'testnet'); if (!r.ok) return r; return parseFloat(r.acct.balance) > 0 ? { ok: true, detail: `Grant landed: ${r.acct.balance} ✅` } : { ok: false, detail: 'No TESTS yet — give the welcomer a few minutes.' }; },
      3: async (s) => pranaRaised(s, 'alpha'),
      4: async (s) => pranaRaised(s, 'alpha'),
    },
  },
  'prana-testnet-faucet': {
    needs: 'address',
    baseline: async (s) => ({ alpha: s.address ? units(await prana.nativeBalance(s.address, 'alpha'), 18) : null }),
    steps: { 2: async (s) => pranaRaised(s, 'alpha'), 3: async (s) => pranaRaised(s, 'alpha') },
  },
  'add-prana-metamask': {
    needs: null,
    steps: { 2: async () => { const id = await prana.chainId('mainnet'); return id === 712217 ? { ok: true, detail: 'PRANA RPC answers chainId 712217 — your wallet can connect (I can\'t see your wallet itself; that part is a self-check) ✅' } : { ok: null, detail: 'The PRANA RPC isn\'t answering right now.' }; } },
  },
  'bridge-vkbt-cure-prana': {
    needs: 'address',
    baseline: async (s) => (s.address ? { wVKBT: await tokenBal(PRANA.wVKBT, s.address, 8), wCURE: await tokenBal(PRANA.wCURE, s.address, 8) } : {}),
    steps: {
      5: async (s) => {
        const a = needAddress(s); if (!a.ok) return a;
        const [v, c] = await Promise.all([tokenBal(PRANA.wVKBT, s.address, 8), tokenBal(PRANA.wCURE, s.address, 8)]);
        if (v === null || c === null) return { ok: null, detail: 'Can\'t read PRANA right now — try again.' };
        const b = s.baseline || {};
        if (v > (b.wVKBT || 0) || c > (b.wCURE || 0)) { s.mid = { wVKBT: v, wCURE: c }; return { ok: true, detail: `Minted on PRANA ✅ — you hold ${fmt(v)} wVKBT / ${fmt(c)} wCURE` }; }
        return { ok: false, detail: 'Not minted yet — the relayer waits for 12 Hive confirmations. Try `!next` in a few minutes.' };
      },
      8: async (s) => {
        const a = needAddress(s); if (!a.ok) return a;
        const [v, c] = await Promise.all([tokenBal(PRANA.wVKBT, s.address, 8), tokenBal(PRANA.wCURE, s.address, 8)]);
        if (v === null || c === null) return { ok: null, detail: 'Can\'t read PRANA right now.' };
        const m = s.mid || s.baseline || {};
        return v < (m.wVKBT || 0) || c < (m.wCURE || 0) ? { ok: true, detail: 'Withdraw burned your wrapped tokens on PRANA ✅ — VKBT/CURE is released on Hive-Engine after 12 confirmations.' } : { ok: false, detail: 'I don\'t see the withdraw on PRANA yet.' };
      },
    },
  },
  'kulaswap-swap': {
    needs: 'address',
    baseline: async (s) => ({ nonce: s.address ? await prana.nonce(s.address) : null }),
    steps: {
      1: async (s) => { const a = needAddress(s); if (!a.ok) return a; const b = units(await prana.nativeBalance(s.address), 18); if (b === null) return { ok: null, detail: 'Can\'t read PRANA right now.' }; return b > 0 ? { ok: true, detail: `Your address has ${fmt(b)} PRANA for gas ✅` } : { ok: false, detail: 'That address has no PRANA for gas yet — you need a little to swap (mine some: `!guide pool`).' }; },
      5: async (s) => nonceRaised(s, 'swap'),
      6: async (s) => nonceRaised(s, 'swap'),
    },
  },
  'stake-kula-vekula': {
    needs: 'address',
    baseline: async (s) => ({ kula: s.address ? await tokenBal(PRANA.KULA, s.address, 18) : null, ve: await tokenBal(PRANA.KULA, PRANA.veKULA, 18) }),
    steps: {
      1: async (s) => { const a = needAddress(s); if (!a.ok) return a; const k = await tokenBal(PRANA.KULA, s.address, 18); if (k === null) return { ok: null, detail: 'Can\'t read PRANA right now.' }; return k > 0 ? { ok: true, detail: `You hold ${fmt(k)} KULA ✅` } : { ok: false, detail: 'That address holds no KULA yet — swap for some first (`!guide swap`).' }; },
      3: async (s) => {
        const a = needAddress(s); if (!a.ok) return a;
        const [k, ve] = await Promise.all([tokenBal(PRANA.KULA, s.address, 18), tokenBal(PRANA.KULA, PRANA.veKULA, 18)]);
        if (k === null || ve === null) return { ok: null, detail: 'Can\'t read PRANA right now.' };
        const b = s.baseline || {};
        return b.kula !== null && b.kula !== undefined && k < b.kula && ve > (b.ve || 0) ? { ok: true, detail: `Locked ✅ — ${fmt(b.kula - k)} KULA moved into veKULA` } : { ok: false, detail: 'I don\'t see the lock yet — confirm BOTH transactions (approve, then lock) in your wallet.' };
      },
    },
  },
  'melek-to-wmelek-engine': {
    needs: 'account', defaultNet: 'mainnet',
    baseline: async (s) => ({ wmelek: s.account ? await melekEngine.balance(s.account, 'WMELEK') : null, t0: Date.now() }),
    steps: {
      1: async (s) => {
        const r = await needAccount(s); if (!r.ok) return r;
        const h = await melek.history(s.account, 'mainnet', 50);
        if (!Array.isArray(h)) return { ok: null, detail: 'Can\'t read your history right now.' };
        const hit = h.find(([, e]) => e && e.op && e.op[0] === 'transfer' && e.op[1].from === s.account && e.op[1].to === 'wmelek-bridge');
        return hit ? { ok: true, detail: `Deposit seen: ${hit[1].op[1].amount} → @wmelek-bridge ✅` } : { ok: false, detail: 'No transfer to @wmelek-bridge from you yet.' };
      },
      2: async (s) => {
        const r = await needAccount(s); if (!r.ok) return r;
        const w = await melekEngine.balance(s.account, 'WMELEK');
        if (w === null) return { ok: null, detail: 'MELEK-Engine isn\'t answering right now.' };
        const b = s.baseline && s.baseline.wmelek !== null ? s.baseline.wmelek : 0;
        return w > b ? { ok: true, detail: `WMELEK credited ✅ — balance ${w}` } : { ok: false, detail: 'Not credited yet — the relayer waits for the transfer to be final.' };
      },
    },
  },
  'pool-browser-mine': { needs: 'address', steps: { 4: (s) => poolSeen(s), 5: (s) => poolSeen(s) } },
  'pool-own-miner-xmrig': { needs: 'address', steps: { 5: (s) => poolSeen(s) } },
  'become-a-witness': {
    needs: 'account', defaultNet: 'mainnet',
    steps: { 6: async (s) => { const r = await needAccount(s); if (!r.ok) return r; const w = await melek.witness(s.account, s.net); return w ? { ok: true, detail: `@${s.account} is registered as a witness ✅` } : { ok: false, detail: 'No witness registration on-chain yet.' }; } },
  },
};

async function pranaRaised(s, net) {
  const a = needAddress(s); if (!a.ok) return a;
  const b = units(await prana.nativeBalance(s.address, net), 18);
  if (b === null) return { ok: null, detail: 'Can\'t read the PRANA testnet right now.' };
  const base = s.baseline && Number.isFinite(s.baseline.alpha) ? s.baseline.alpha : 0;
  return b > base ? { ok: true, detail: `Test PRANA arrived: balance ${fmt(b)} ✅` } : { ok: false, detail: 'No drip seen yet (one per address per 24h).' };
}
async function nonceRaised(s) {
  const a = needAddress(s); if (!a.ok) return a;
  const n = await prana.nonce(s.address);
  if (n === null) return { ok: null, detail: 'Can\'t read PRANA right now.' };
  const base = s.baseline && Number.isFinite(s.baseline.nonce) ? s.baseline.nonce : null;
  if (base === null) { s.baseline = { ...(s.baseline || {}), nonce: n }; return { ok: false, detail: 'Baseline recorded — do the swap, then `!next`.' }; }
  return n > base ? { ok: true, detail: `New transaction(s) from your address on PRANA ✅ (check it on ${CFG.pranascan.mainnet}/address/${s.address})` } : { ok: false, detail: 'No new transaction from your address yet.' };
}
async function poolSeen(s) {
  const a = s.address;
  if (!a) return { ok: false, detail: 'I need your PUBLIC payout address: `!guide set <address>`' };
  const isEvm = /^0x[0-9a-fA-F]{40}$/.test(a);
  const pool = isEvm ? 'prana-mainnet' : 'xmr-stagenet';
  const login = isEvm ? a : poolLoginAddress('xmr', a).address;
  const st = await getJSON(`${CFG.pool}/pools/${pool}/miners/${encodeURIComponent(login)}`);
  if (!st) return { ok: null, detail: 'The pool API isn\'t answering right now.' };
  const seen = Number(st.pendingShares) > 0 || Number(st.pendingBalance) > 0 || Number(st.totalPaid) > 0 || (Array.isArray(st.performanceSamples) && st.performanceSamples.length > 0) || (st.performance && Object.keys(st.performance.workers || {}).length > 0);
  return seen ? { ok: true, detail: `The pool sees your shares ✅ (pending ${st.pendingShares ?? 0})` } : { ok: false, detail: 'The pool hasn\'t recorded shares for that address yet — keep mining a minute, then `!next`.' };
}

// ── sessions ──────────────────────────────────────────────────────────────────────────────────────
const sKey = (platform, userId) => `guide:${platform}:${userId}`;

function fmtStep(flow, s) {
  const st = flow.steps[s.step - 1];
  const v = VERIFIERS[flow.id];
  const checked = v && v.steps && v.steps[st.n];
  return [
    `**${flow.id}** — step ${st.n}/${flow.steps.length}${s.net && v && v.needs === 'account' ? ` (${s.net})` : ''}`,
    `➡️ ${st.do}`,
    st.url ? `🔗 ${st.url}` : '',
    st.why ? `_why: ${st.why}_` : '',
    checked ? '✔️ When done, type `!next` — I\'ll check it on-chain.' : '☑️ Self-check step (no on-chain trace) — type `!next` when done.',
  ].filter(Boolean).join('\n');
}

function applyIdentity(s, tokens) {
  for (const t of tokens) {
    if (t === 'testnet' || t === 'mainnet') { s.net = t; continue; }
    if (!t.startsWith('@') && !t.startsWith('0x') && !/^[457Z]/.test(t)) continue;
    const id = parseIdentity(t);
    if (id && id.kind === 'prana') s.address = id.value;
    else if (id && id.kind === 'melek' && t.startsWith('@')) s.account = id.value;
    else if (/^[1-9A-HJ-NP-Za-km-z]{95,110}$/.test(t)) s.address = t; // XMR/ZEPH payout address
  }
}

export async function listGuides() {
  const flows = await loadFlows();
  const works = flows.filter((f) => f.status === 'WORKS');
  const byId = new Map(works.map((f) => [f.id, f]));
  const feat = FEATURED.filter((id) => byId.has(id));
  const others = works.filter((f) => !FEATURED.includes(f.id));
  const wip = flows.filter((f) => f.status !== 'WORKS').map((f) => f.id);
  return [
    '**Guides** — I walk you step by step and check each step on-chain where it leaves a trace. I never need your password or keys.',
    ...feat.map((id) => `• \`!guide ${Object.keys(ALIASES).find((k) => ALIASES[k] === id) || id}\` — ${byId.get(id).intent}`),
    others.length ? `Also: ${others.map((f) => f.id).join(', ')} → \`!guide <name>\`` : '',
    wip.length ? `🚧 Under construction (no guide yet): ${wip.join(', ')}` : '',
  ].filter(Boolean).join('\n');
}

/**
 * guideCommand(cmd, args, { platform, userId }, { store, now }) → reply text. Never throws.
 * cmd ∈ guide | next | step | back
 */
export async function guideCommand(cmd, args = [], who = {}, { store = defaultStore(), now = Date.now() } = {}) {
  try {
    return await _guide(cmd, args.map(String), who, store, now);
  } catch {
    return 'The guide hit an error — your progress is kept. Try `!step`.';
  }
}

async function _guide(cmd, args, who, store, now) {
  const key = sKey(who.platform, who.userId);
  let s = store.get(key, null);
  const flows = await loadFlows(now);
  const flowOf = (id) => flows.find((f) => f.id === id);

  if (cmd === 'guide') {
    const sub = (args[0] || '').toLowerCase();
    if (!sub || sub === 'list' || sub === 'all') return listGuides();
    if (sub === 'stop' || sub === 'end' || sub === 'quit') { store.del(key); return 'Guide ended. `!guide` to pick another.'; }
    if (sub === 'status') return s ? fmtStep(flowOf(s.flowId), s) : 'No guide running — `!guide` to pick one.';
    if (sub === 'set') {
      if (!s) return 'Start a guide first: `!guide <topic>`.';
      applyIdentity(s, args.slice(1).map((t) => (/^[a-z][a-z0-9.-]{2,}$/.test(t) && !/^(testnet|mainnet)$/.test(t) ? '@' + t : t)));
      if (VERIFIERS[s.flowId] && VERIFIERS[s.flowId].baseline) s.baseline = await VERIFIERS[s.flowId].baseline(s).catch(() => s.baseline || {});
      store.set(key, s);
      return `Got it — ${[s.account && '@' + s.account, s.address].filter(Boolean).join(' · ') || 'nothing recognised (use @account or a 0x address)'}.\n\n${fmtStep(flowOf(s.flowId), s)}`;
    }
    const topic = args.filter((t) => !/^(@|0x|testnet$|mainnet$)/i.test(t)).join(' ');
    const flow = findFlow(topic, flows);
    if (!flow) return `I don't have a guide for "${topic.slice(0, 60)}". \`!guide\` lists them.`;
    if (flow.status !== 'WORKS' || !Array.isArray(flow.steps) || !flow.steps.length) return `🚧 ${flow.answer || `${flow.id} is under construction and not available yet.`}`;
    const v = VERIFIERS[flow.id];
    s = { flowId: flow.id, step: 1, net: (v && v.defaultNet) || 'mainnet', account: null, address: null, baseline: {}, startedAt: now };
    applyIdentity(s, args);
    if (v && v.baseline) s.baseline = await v.baseline(s).catch(() => ({}));
    store.set(key, s);
    const pre = (flow.prerequisites || []).length ? `You'll need: ${flow.prerequisites.join('; ')}\n` : '';
    const keys = flow.keys ? `🔐 ${flow.keys}\n` : '';
    const need = v && v.needs === 'account' && !s.account ? 'Tell me your PUBLIC account name for the on-chain checks: `!guide set @name`\n' : v && v.needs === 'address' && !s.address ? 'Tell me your PUBLIC address for the on-chain checks: `!guide set 0x…`\n' : '';
    return `${flow.intent}\n${pre}${keys}${need}\n${fmtStep(flow, s)}`;
  }

  if (!s) return 'No guide running — `!guide` to pick one.';
  const flow = flowOf(s.flowId);
  if (!flow || flow.status !== 'WORKS') { store.del(key); return `🚧 ${flow && flow.answer ? flow.answer : 'That guide is no longer available.'}`; }

  if (cmd === 'step') return fmtStep(flow, s);
  if (cmd === 'back') { s.step = Math.max(1, s.step - 1); store.set(key, s); return fmtStep(flow, s); }

  // cmd === 'next': verify the current step before advancing
  applyIdentity(s, args);
  const st = flow.steps[s.step - 1];
  const check = VERIFIERS[flow.id] && VERIFIERS[flow.id].steps && VERIFIERS[flow.id].steps[st.n];
  let note = '☑️ self-check';
  if (check) {
    const r = await check(s).catch(() => ({ ok: null, detail: 'The check failed to run — try again.' }));
    store.set(key, s); // verifiers may record baselines
    if (r.ok !== true) return `${r.ok === null ? '⏳' : '✋'} ${r.detail}\n(Still on step ${st.n}. \`!step\` repeats it.)`;
    note = r.detail;
  }
  if (s.step >= flow.steps.length) {
    store.del(key);
    return `${note}\n🎉 Done — that's the whole **${flow.id}** guide. \`!guide\` for another.`;
  }
  s.step += 1;
  store.set(key, s);
  return `${note}\n\n${fmtStep(flow, s)}`;
}
