// steemd.mjs — Hathor as MELEK's steemd: a full, deterministic chain-query command set answered from the
// LIVE MELEK mainnet (condenser_api), 24/7. No LLM, no fleet queue, no keys — read-only RPC with node
// failover (live.mjs melekCallX). If every node is down the last good answer (≤15 min) is served and
// marked "as of N ago", otherwise an honest "chain unreachable" line.
//
//   account balance rc delegations followers following post payout votes replies blog trending hot new
//   witness witnesses schedule missed feed chain hardfork rewardfund block tx hathor engine nodes
//
// Every command is also reachable as `!steemd <cmd> …` / `!sb <cmd> …`.

import { melekCallX, melekEngine, nodeHealth, fmt, escChat } from './live.mjs';

const NET = 'mainnet';
const ACCT_RX = /^[a-z][a-z0-9-]{2,15}(\.[a-z][a-z0-9-]{2,15})*$/;
export const acctArg = (a) => { const s = String(a || '').trim().replace(/^@/, '').toLowerCase(); return ACCT_RX.test(s) ? s : null; };

/** "@author/permlink" or a melek.salon URL → { author, permlink } | null */
export function postRef(a) {
  const s = String(a || '').trim();
  const m = s.match(/@([a-z][a-z0-9.-]{2,})\/([a-z0-9-]+)\/?$/i);
  return m ? { author: m[1].toLowerCase(), permlink: m[2].toLowerCase() } : null;
}

const ago = (ms) => (ms < 60_000 ? `${Math.round(ms / 1000)}s` : `${Math.round(ms / 60_000)}m`);
const UNREACHABLE = '⏳ The MELEK chain is unreachable from every node I know right now — try again in a minute.';

async function q(method, params = []) {
  const r = await melekCallX(NET, method, params);
  return { v: r.result, stale: r.stale || 0, err: r.error || null, node: r.node || null };
}
const unreachable = (r) => (r.v === null || r.v === undefined) && !r.node && !r.stale;
const staleNote = (...rs) => { const s = Math.max(0, ...rs.map((r) => r.stale || 0)); return s ? `\n_(chain unreachable — showing data as of ${ago(s)} ago)_` : ''; };

const amount = (s) => parseFloat(String(s || '0'));
async function vestsToMelek() {
  const g = await q('condenser_api.get_dynamic_global_properties');
  if (!g.v) return { per: null, g };
  return { per: amount(g.v.total_vesting_fund_steem) / amount(g.v.total_vesting_shares), g };
}
export function reputation(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n === 0) return 25;
  const l = Math.max(Math.log10(Math.abs(n)) - 9, 0) * (n < 0 ? -9 : 9) + 25;
  return Math.round(l * 10) / 10;
}
/** HF25 voting mana → percent, regenerated to `nowSec` over 5 days. */
export function votingMana(a, nowSec = Date.now() / 1000) {
  const max = (amount(a.vesting_shares) + amount(a.received_vesting_shares) - amount(a.delegated_vesting_shares)) * 1e6;
  if (!(max > 0) || !a.voting_manabar) return null;
  const cur = Number(a.voting_manabar.current_mana) + (max * (nowSec - Number(a.voting_manabar.last_update_time))) / 432000;
  return Math.min(100, Math.max(0, (cur / max) * 100));
}

// ── commands ──────────────────────────────────────────────────────────────────────────────────────
const C = {};

C.account = async ([a]) => {
  const name = acctArg(a);
  if (!name) return 'Usage: `!account @name`';
  const [r, vm, fc, rep] = await Promise.all([q('condenser_api.get_accounts', [[name]]), vestsToMelek(), q('condenser_api.get_follow_count', [name]), q('condenser_api.get_account_reputations', [name, 1])]);
  if (!r.v) return UNREACHABLE;
  const x = r.v[0];
  if (!x) return `No MELEK account @${name}.`;
  const per = vm.per;
  const own = amount(x.vesting_shares) * (per || 0);
  const del = amount(x.delegated_vesting_shares) * (per || 0);
  const rec = amount(x.received_vesting_shares) * (per || 0);
  const mana = votingMana(x);
  const repv = rep.v && rep.v[0] && rep.v[0].account === name ? reputation(rep.v[0].reputation) : reputation(x.reputation);
  return [
    `**@${name}** — rep ${repv} · created ${x.created && !x.created.startsWith('1970') ? x.created.slice(0, 10) : 'genesis'} · posts ${x.post_count}`,
    `• Liquid ${x.balance} · ${x.sbd_balance} · savings ${x.savings_balance}`,
    per ? `• POWER ${fmt(own)} MELEK (delegated out ${fmt(del)} · in ${fmt(rec)}) → effective ${fmt(own - del + rec)}` : '• POWER: unavailable',
    `• Voting mana ${mana === null ? 'n/a' : fmt(mana) + '%'} · witness votes ${x.witnesses_voted_for}${x.proxy ? ` (proxy @${x.proxy})` : ''}`,
    fc.v ? `• Followers ${fc.v.follower_count} · following ${fc.v.following_count}` : '',
    amount(x.reward_steem_balance) + amount(x.reward_vesting_steem) + amount(x.reward_sbd_balance) > 0 ? `• Unclaimed rewards: ${x.reward_steem_balance} · ${x.reward_sbd_balance} · ${x.reward_vesting_steem} POWER` : '',
    `🔗 https://melek.salon/@${name}`,
  ].filter(Boolean).join('\n') + staleNote(r, vm.g);
};
C.acct = C.account;

C.balance = async ([a]) => {
  const name = acctArg(a);
  if (!name) return 'Usage: `!balance @name`';
  const [r, vm] = await Promise.all([q('condenser_api.get_accounts', [[name]]), vestsToMelek()]);
  if (!r.v) return UNREACHABLE;
  const x = r.v[0];
  if (!x) return `No MELEK account @${name}.`;
  const p = vm.per ? fmt(amount(x.vesting_shares) * vm.per) + ' MELEK' : 'n/a';
  return `**@${name}** · ${x.balance} · ${x.sbd_balance} · POWER ${p} · savings ${x.savings_balance}` + staleNote(r, vm.g);
};

C.rc = async ([a]) => {
  const name = acctArg(a);
  if (!name) return 'Usage: `!rc @name`';
  const [rc, r] = await Promise.all([q('rc_api.find_rc_accounts', { accounts: [name] }), q('condenser_api.get_accounts', [[name]])]);
  const row = rc.v && rc.v.rc_accounts && rc.v.rc_accounts[0];
  if (row) {
    const max = Number(row.max_rc);
    const pct = max > 0 ? (Number(row.rc_manabar.current_mana) / max) * 100 : null;
    return `**@${name}** RC ${pct === null ? 'n/a' : fmt(Math.min(100, pct)) + '%'} of ${fmt(max)}` + staleNote(rc);
  }
  if (!r.v) return UNREACHABLE;
  if (!r.v[0]) return `No MELEK account @${name}.`;
  const mana = votingMana(r.v[0]);
  return `**@${name}** — this node doesn't publish RC; voting mana is ${mana === null ? 'n/a' : fmt(mana) + '%'}. New accounts get POWER delegated by Hathor's welcomer.` + staleNote(r);
};

C.delegations = async ([a]) => {
  const name = acctArg(a);
  if (!name) return 'Usage: `!delegations @name`';
  const [r, vm, acc] = await Promise.all([q('condenser_api.get_vesting_delegations', [name, '', 25]), vestsToMelek(), q('condenser_api.get_accounts', [[name]])]);
  if (!r.v) return UNREACHABLE;
  const per = vm.per || 0;
  const rows = r.v.map((d) => `@${d.delegatee} ${fmt(amount(d.vesting_shares) * per)}`);
  const recv = acc.v && acc.v[0] ? fmt(amount(acc.v[0].received_vesting_shares) * per) : 'n/a';
  return `**@${name} delegations** — out (${rows.length}${rows.length === 25 ? '+' : ''}): ${rows.join(' · ') || 'none'}\nReceived in total: ${recv} MELEK POWER` + staleNote(r);
};

C.followers = async ([a]) => {
  const name = acctArg(a);
  if (!name) return 'Usage: `!followers @name`';
  const [fc, f] = await Promise.all([q('condenser_api.get_follow_count', [name]), q('condenser_api.get_followers', [name, '', 'blog', 10])]);
  if (!fc.v) return UNREACHABLE;
  return `**@${name}** — ${fc.v.follower_count} followers · ${fc.v.following_count} following\nLatest: ${(f.v || []).map((x) => '@' + x.follower).join(' ') || '—'}` + staleNote(fc);
};
C.following = async ([a]) => {
  const name = acctArg(a);
  if (!name) return 'Usage: `!following @name`';
  const f = await q('condenser_api.get_following', [name, '', 'blog', 10]);
  if (!f.v) return UNREACHABLE;
  return `**@${name} follows:** ${f.v.map((x) => '@' + x.following).join(' ') || 'nobody yet'}` + staleNote(f);
};

function payoutLine(c) {
  const pending = amount(c.pending_payout_value);
  const paid = amount(c.total_payout_value) + amount(c.curator_payout_value);
  const open = !String(c.cashout_time || '').startsWith('1969');
  return open ? `pending ${c.pending_payout_value} (pays out ${c.cashout_time}Z)` : `paid ${fmt(paid)} (author ${c.total_payout_value} · curators ${c.curator_payout_value})${pending ? '' : ''}`;
}

C.post = async ([a]) => {
  const ref = postRef(a);
  if (!ref) return 'Usage: `!post @author/permlink` (or paste the melek.salon link)';
  const r = await q('condenser_api.get_content', [ref.author, ref.permlink]);
  if (!r.v) return UNREACHABLE;
  const c = r.v;
  if (!c.author) return `No post @${ref.author}/${ref.permlink}.`;
  return [
    `**${escChat(c.title || '(comment)')}** by @${c.author} · ${c.created.slice(0, 16)}Z`,
    `• ${c.net_votes} votes · ${c.children} replies · ${payoutLine(c)}`,
    `🔗 https://melek.salon/@${c.author}/${c.permlink}`,
  ].join('\n') + staleNote(r);
};
C.comment = C.post;
C.payout = async ([a]) => {
  const ref = postRef(a);
  if (!ref) return 'Usage: `!payout @author/permlink`';
  const r = await q('condenser_api.get_content', [ref.author, ref.permlink]);
  if (!r.v) return UNREACHABLE;
  if (!r.v.author) return `No post @${ref.author}/${ref.permlink}.`;
  const c = r.v;
  return `**Payout** @${c.author}/${c.permlink}: ${payoutLine(c)} · max accepted ${c.max_accepted_payout} · beneficiaries ${(c.beneficiaries || []).map((b) => `@${b.account} ${b.weight / 100}%`).join(', ') || 'none'}` + staleNote(r);
};
C.votes = async ([a]) => {
  const ref = postRef(a);
  if (!ref) return 'Usage: `!votes @author/permlink`';
  const r = await q('condenser_api.get_active_votes', [ref.author, ref.permlink]);
  if (!r.v) return UNREACHABLE;
  const v = r.v.slice().sort((x, y) => Number(y.rshares) - Number(x.rshares));
  return `**${v.length} votes** on @${ref.author}/${ref.permlink}: ${v.slice(0, 12).map((x) => `@${x.voter} ${x.percent / 100}%`).join(' · ') || 'none yet'}` + staleNote(r);
};
C.replies = async ([a]) => {
  const ref = postRef(a);
  if (!ref) return 'Usage: `!replies @author/permlink`';
  const r = await q('condenser_api.get_content_replies', [ref.author, ref.permlink]);
  if (!r.v) return UNREACHABLE;
  return `**${r.v.length} replies**:\n${r.v.slice(0, 8).map((c) => `• @${c.author}: ${escChat(String(c.body || '').replace(/\s+/g, ' ').slice(0, 80))}`).join('\n') || 'none yet'}` + staleNote(r);
};

async function discussions(method, tag, n = 5, label, showTag = true) {
  const r = await q(method, [{ tag: tag || '', limit: n }]);
  if (!r.v) return UNREACHABLE;
  return `**${label}${tag && showTag ? ` #${escChat(tag)}` : ''}**\n${r.v.map((c, i) => `${i + 1}. ${escChat(c.title).slice(0, 70)} — @${c.author} · ${c.pending_payout_value} · https://melek.salon/@${c.author}/${c.permlink}`).join('\n') || 'nothing yet'}` + staleNote(r);
}
C.trending = ([t]) => discussions('condenser_api.get_discussions_by_trending', t, 5, 'Trending');
C.hot = ([t]) => discussions('condenser_api.get_discussions_by_hot', t, 5, 'Hot');
C.new = ([t]) => discussions('condenser_api.get_discussions_by_created', t, 5, 'New');
C.created = C.new;
C.blog = async ([a]) => {
  const name = acctArg(a);
  if (!name) return 'Usage: `!blog @name`';
  return discussions('condenser_api.get_discussions_by_blog', name, 5, `Latest from @${name}`, false);
};

C.witness = async ([a]) => {
  const name = acctArg(a || 'hathor');
  if (!name) return 'Usage: `!witness @name`';
  const [w, sch] = await Promise.all([q('condenser_api.get_witness_by_account', [name]), q('condenser_api.get_active_witnesses')]);
  if (unreachable(w)) return UNREACHABLE;
  if (!w.v) return `@${name} is not a registered witness.`;
  const x = w.v;
  const active = Array.isArray(sch.v) && sch.v.includes(name);
  const disabled = /^[A-Z]+1111111111111111111111111111111114T1Anm$/.test(x.signing_key);
  return [
    `**Witness @${name}** — ${disabled ? '⛔ disabled (null signing key)' : active ? '🟢 in the active schedule' : '⚪ standby'} · v${x.running_version} (HF vote ${x.hardfork_version_vote})`,
    `• Last block #${fmt(x.last_confirmed_block_num)} · missed ${fmt(x.total_missed)} · vote weight ${fmt(Number(x.votes))}`,
    `• Price feed: ${x.sbd_exchange_rate.base} / ${x.sbd_exchange_rate.quote} (updated ${String(x.last_sbd_exchange_update).startsWith('1970') ? 'never' : x.last_sbd_exchange_update + 'Z'})`,
    `• Props: account fee ${x.props.account_creation_fee} · block size ${x.props.maximum_block_size}`,
    x.url ? `🔗 ${escChat(x.url)}` : '',
  ].filter(Boolean).join('\n') + staleNote(w);
};
C.hathor = () => C.witness(['hathor']);
C.missed = async ([a]) => {
  const name = acctArg(a || 'hathor');
  const w = await q('condenser_api.get_witness_by_account', [name]);
  if (unreachable(w)) return UNREACHABLE;
  if (!w.v) return `@${name} is not a registered witness.`;
  return `@${name} has missed ${fmt(w.v.total_missed)} blocks in total · last produced #${fmt(w.v.last_confirmed_block_num)}` + staleNote(w);
};
C.witnesses = async () => {
  const [w, act] = await Promise.all([q('condenser_api.get_witnesses_by_vote', ['', 21]), q('condenser_api.get_active_witnesses')]);
  if (!w.v) return UNREACHABLE;
  const on = new Set(Array.isArray(act.v) ? act.v : []);
  return `**Witnesses by vote**\n${w.v.map((x, i) => `${i + 1}. ${on.has(x.owner) ? '🟢' : '⚪'} @${x.owner} · missed ${fmt(x.total_missed)} · v${x.running_version}`).join('\n')}` + staleNote(w);
};
C.schedule = async () => {
  const s = await q('condenser_api.get_witness_schedule');
  if (!s.v) return UNREACHABLE;
  const order = s.v.current_shuffled_witnesses.filter(Boolean);
  return `**Schedule** (${s.v.num_scheduled_witnesses} witnesses, next shuffle at #${fmt(s.v.next_shuffle_block_num)}): ${order.map((x) => '@' + x).join(' → ')}\nMedian props: account fee ${s.v.median_props.account_creation_fee}` + staleNote(s);
};

C.feed = async () => {
  const [m, f] = await Promise.all([q('condenser_api.get_current_median_history_price'), q('condenser_api.get_feed_history')]);
  if (!m.v) return UNREACHABLE;
  const base = amount(m.v.base);
  const quote = amount(m.v.quote);
  if (!base || !quote) return `**MBD price feed**: no witness price feed is published yet (median ${m.v.base} / ${m.v.quote}), so there is no on-chain MBD price.` + staleNote(m);
  return `**MBD median price**: 1 MELEK = ${fmt(base / quote)} MBD (${m.v.base} / ${m.v.quote}) · ${f.v ? f.v.price_history.length : 'n/a'} feed points` + staleNote(m);
};
C.mbd = C.feed;

C.chain = async () => {
  const [g, hf, cp] = await Promise.all([q('condenser_api.get_dynamic_global_properties'), q('condenser_api.get_hardfork_version'), q('condenser_api.get_chain_properties')]);
  if (!g.v) return UNREACHABLE;
  const d = g.v;
  return [
    `**MELEK chain** — block #${fmt(d.head_block_number)} at ${d.time}Z by @${d.current_witness} · irreversible #${fmt(d.last_irreversible_block_num)} · HF ${hf.v || 'n/a'}`,
    `• Supply ${d.current_supply} · ${d.current_sbd_supply} · POWER fund ${d.total_vesting_fund_steem}`,
    `• Rewards split: ${d.content_reward_percent / 100}% content · ${d.vesting_reward_percent / 100}% stakers · ${d.sps_fund_percent / 100}% DAO fund`,
    cp.v ? `• Account creation fee ${cp.v.account_creation_fee} · max block ${fmt(cp.v.maximum_block_size)} bytes` : '',
  ].filter(Boolean).join('\n') + staleNote(g);
};
C.props = C.chain;
C.hardfork = async () => {
  const h = await q('condenser_api.get_hardfork_version');
  return h.v ? `MELEK hardfork version: **${h.v}**` + staleNote(h) : UNREACHABLE;
};
C.rewardfund = async () => {
  const r = await q('condenser_api.get_reward_fund', ['post']);
  if (!r.v) return UNREACHABLE;
  return `**Reward fund** ${r.v.reward_balance} · recent claims ${fmt(Number(r.v.recent_claims))} · curation ${r.v.percent_curation_rewards / 100}% · curves ${r.v.author_reward_curve} / ${r.v.curation_reward_curve}` + staleNote(r);
};

C.block = async ([n]) => {
  let num = Number(n);
  if (!n) {
    const g = await q('condenser_api.get_dynamic_global_properties');
    if (!g.v) return UNREACHABLE;
    num = g.v.head_block_number;
  }
  if (!Number.isInteger(num) || num < 1) return 'Usage: `!block [number]`';
  const b = await q('condenser_api.get_block', [num]);
  if (unreachable(b)) return UNREACHABLE;
  if (!b.v) return `No block #${num} yet.`;
  const txs = b.v.transactions || [];
  const kinds = {};
  for (const t of txs) for (const op of t.operations || []) kinds[op[0]] = (kinds[op[0]] || 0) + 1;
  return `**Block #${fmt(num)}** · ${b.v.timestamp}Z · by @${b.v.witness} · ${txs.length} tx${txs.length ? ' — ' + Object.entries(kinds).map(([k, v]) => `${k}×${v}`).join(', ') : ''}` + staleNote(b);
};
C.tx = async ([id, blk]) => {
  if (!/^[0-9a-f]{40}$/i.test(String(id || ''))) return 'Usage: `!tx <40-hex transaction id> [block number]`';
  const t = await q('condenser_api.get_transaction', [String(id).toLowerCase()]);
  if (t.v) return `**tx ${id}** in block #${fmt(t.v.block_num)}: ${(t.v.operations || []).map((o) => o[0]).join(', ')}` + staleNote(t);
  if (!blk) return 'This node can\'t look transactions up by id alone — add the block number: `!tx <id> <block>`.';
  const b = await q('condenser_api.get_block', [Number(blk)]);
  if (!b.v) return UNREACHABLE;
  const i = (b.v.transaction_ids || []).indexOf(String(id).toLowerCase());
  if (i < 0) return `tx ${id} is not in block #${blk}.`;
  const ops = b.v.transactions[i].operations || [];
  return `**tx ${id}** in block #${fmt(Number(blk))}: ${ops.map((o) => `${o[0]}${o[1] && o[1].from ? ` @${o[1].from}→@${o[1].to} ${o[1].amount || ''}` : ''}`).join('; ')}` + staleNote(b);
};

C.engine = async ([a, sym]) => {
  const name = acctArg(a);
  if (name) {
    const s = String(sym || '').toUpperCase();
    const toks = await melekEngine.tokens();
    if (!Array.isArray(toks)) return '⏳ MELEK-Engine is unreachable right now.';
    const list = s ? [s] : toks.map((t) => t.symbol);
    const bals = await Promise.all(list.map(async (x) => [x, await melekEngine.balance(name, x)]));
    if (bals.every(([, b]) => b === null)) return '⏳ MELEK-Engine is unreachable right now.';
    return `**@${name} on MELEK-Engine**: ${bals.map(([x, b]) => `${x} ${b === null ? 'n/a' : b}`).join(' · ')}`;
  }
  const toks = await melekEngine.tokens();
  if (!Array.isArray(toks)) return '⏳ MELEK-Engine is unreachable right now.';
  return `**MELEK-Engine tokens** (${toks.length}): ${toks.map((t) => `${t.symbol} ${t.supply}`).join(' · ')} — \`!engine @name\` for balances · https://engine.melek.salon/`;
};

C.nodes = async () => {
  const h = nodeHealth();
  return `**MELEK RPC nodes** (failover order): ${h.mainnet.map((n, i) => `${i + 1}. ${n.benched ? '🔴' : '🟢'} ${n.url.replace(/^https?:\/\//, '')} ok ${n.ok}/fail ${n.fail}`).join(' · ')}`;
};

export const STEEMD_COMMANDS = Object.keys(C);

/** steemdCommand(cmd, args) → reply text | null (not a chain command). Never throws. */
export async function steemdCommand(cmd, args = []) {
  const f = C[String(cmd || '').toLowerCase()];
  if (!f) return null;
  try { return await f(args.map(String)); } catch { return UNREACHABLE; }
}
