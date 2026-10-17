// steemd.test.mjs — Hathor as MELEK's steemd: every chain command answers from the (faked) live chain,
// RPC failover keeps answering when a node dies, the last good answer is served (marked stale) when all
// nodes die, and nothing here touches an LLM or the fleet queue. Offline.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { __setFetch, nodeHealth } from './live.mjs';
import { steemdCommand, STEEMD_COMMANDS, postRef, reputation, votingMana } from './steemd.mjs';
import { handle } from './brain.mjs';
import { runCommand } from '../integrations/soapbox/steemd.mjs';
import { baseState, fakeFetch } from './test-fakes.mjs';

let st;
const POST = { author: 'afrose', permlink: 'bird', title: 'Bird.', created: '2026-10-17T04:54:48', net_votes: 1, children: 1, pending_payout_value: '32.447 MELEK', total_payout_value: '0.000 MBD', curator_payout_value: '0.000 MBD', cashout_time: '2026-10-24T04:54:48', max_accepted_payout: '1000000.000 MBD', beneficiaries: [], body: 'Colourful bird.' };
const WIT = { owner: 'hathor', running_version: '0.25.0', hardfork_version_vote: '0.25.0', last_confirmed_block_num: 1686182, total_missed: 37531, votes: '331276191', signing_key: 'MELEK8Aiv3FSiodGTMvYxtWTcuLNVYax6wZrGGRaX8ye5WmyMAn7GeX', sbd_exchange_rate: { base: '0.000 MELEK', quote: '0.000 MELEK' }, last_sbd_exchange_update: '1970-01-01T00:00:00', props: { account_creation_fee: '0.030 MELEK', maximum_block_size: 65536 }, url: 'https://witness.melek.salon' };

beforeEach(() => {
  st = baseState();
  const m = st.melek.mainnet;
  m.accounts.hathor = { name: 'hathor', created: '1970-01-01T00:00:00', post_count: 103, balance: '137859.946 MELEK', sbd_balance: '0.000 MBD', savings_balance: '0.000 MELEK', vesting_shares: '172.825531 VESTS', delegated_vesting_shares: '111.654888 VESTS', received_vesting_shares: '44.074476 VESTS', voting_manabar: { current_mana: 73943209, last_update_time: Math.floor(Date.now() / 1000) }, witnesses_voted_for: 3, proxy: '', reputation: 3136619, reward_steem_balance: '0.000 MELEK', reward_vesting_steem: '0.156 MELEK', reward_sbd_balance: '0.000 MBD' };
  m.witnesses.hathor = WIT;
  Object.assign(m.extra, {
    'condenser_api.get_follow_count': ([a]) => ({ account: a, follower_count: 6, following_count: 0 }),
    'condenser_api.get_account_reputations': () => [{ account: 'hathor', reputation: 3136619 }],
    'condenser_api.get_vesting_delegations': () => [{ delegatee: 'onboarder', vesting_shares: '90.000000 VESTS' }],
    'condenser_api.get_followers': () => [{ follower: 'mspbro' }],
    'condenser_api.get_following': () => [],
    'condenser_api.get_content': ([a, p]) => (a === 'afrose' && p === 'bird' ? POST : { author: '', permlink: '' }),
    'condenser_api.get_active_votes': () => [{ voter: 'hathor', percent: 100, rshares: '5' }, { voter: 'maat', percent: 5000, rshares: '9' }],
    'condenser_api.get_content_replies': () => [{ author: 'juba', body: 'nice' }],
    'condenser_api.get_discussions_by_trending': () => [POST],
    'condenser_api.get_discussions_by_hot': () => [POST],
    'condenser_api.get_discussions_by_created': () => [POST],
    'condenser_api.get_discussions_by_blog': () => [POST],
    'condenser_api.get_active_witnesses': () => ['thoth', 'initminer', 'maat', 'hathor', 'seshat', ''],
    'condenser_api.get_witnesses_by_vote': () => [{ ...WIT, owner: 'maat', total_missed: 110390 }, WIT],
    'condenser_api.get_witness_schedule': () => ({ current_shuffled_witnesses: ['maat', 'hathor', ''], num_scheduled_witnesses: 2, next_shuffle_block_num: 1686179, median_props: { account_creation_fee: '0.030 MELEK' } }),
    'condenser_api.get_current_median_history_price': () => ({ base: '0.000 MELEK', quote: '0.000 MELEK' }),
    'condenser_api.get_feed_history': () => ({ price_history: [] }),
    'condenser_api.get_hardfork_version': () => '0.25.0',
    'condenser_api.get_chain_properties': () => ({ account_creation_fee: '0.030 MELEK', maximum_block_size: 65536 }),
    'condenser_api.get_reward_fund': () => ({ reward_balance: '851454.694 MELEK', recent_claims: '5856806321', percent_curation_rewards: 5000, author_reward_curve: 'convergent_linear', curation_reward_curve: 'convergent_square_root' }),
    'condenser_api.get_block': ([n]) => (n <= 1_000_000 ? { timestamp: '2026-10-17T04:58:44', witness: 'initminer', transaction_ids: ['ab'.repeat(20)], transactions: [{ operations: [['transfer', { from: 'a', to: 'b', amount: '1.000 MELEK' }]] }] } : null),
    'condenser_api.get_transaction': () => ({ __rpcError: 'This API is not supported for account history backed by RocksDB' }),
    'rc_api.find_rc_accounts': () => ({ rc_accounts: [] }),
  });
  m.dgp.head_block_number = 1_000_000;
  m.dgp.time = '2026-10-17T06:17:40';
  m.dgp.current_witness = 'maat';
  m.dgp.last_irreversible_block_num = 999_997;
  st.engine.tokens = [{ symbol: 'WMELEK', supply: '1.000' }, { symbol: 'APIS', supply: '0.000' }];
  st.engine.balances['hathor|WMELEK'] = 0;
  __setFetch(fakeFetch(st));
});

test('helpers: post refs, reputation, voting mana', () => {
  assert.deepEqual(postRef('@a-b/perm-1'), { author: 'a-b', permlink: 'perm-1' });
  assert.deepEqual(postRef('https://melek.salon/melek/@afrose/bird'), { author: 'afrose', permlink: 'bird' });
  assert.equal(postRef('nope'), null);
  assert.equal(reputation(0), 25);
  assert.equal(reputation(3136619), 25);
  assert.ok(reputation(1e12) > 50);
  const pct = votingMana({ vesting_shares: '100 VESTS', received_vesting_shares: '0', delegated_vesting_shares: '0', voting_manabar: { current_mana: 50e6, last_update_time: 1000 } }, 1000);
  assert.equal(pct, 50);
});

test('account / balance / rc / delegations / followers / following', async () => {
  const a = await steemdCommand('account', ['@hathor']);
  assert.match(a, /137859\.946 MELEK/);
  assert.match(a, /Followers 6/);
  assert.match(a, /POWER [\d,.]+ MELEK \(delegated out/);
  assert.match(a, /Voting mana/);
  assert.match(await steemdCommand('account', ['@ghost']), /No MELEK account @ghost/);
  assert.match(await steemdCommand('account', []), /Usage/);
  assert.match(await steemdCommand('balance', ['hathor']), /137859\.946 MELEK/);
  assert.match(await steemdCommand('rc', ['hathor']), /doesn't publish RC; voting mana/);
  assert.match(await steemdCommand('delegations', ['hathor']), /@onboarder/);
  assert.match(await steemdCommand('followers', ['hathor']), /6 followers.*\n.*@mspbro/);
  assert.match(await steemdCommand('following', ['hathor']), /nobody yet/);
});

test('posts: post / payout / votes / replies / trending / hot / new / blog', async () => {
  assert.match(await steemdCommand('post', ['https://melek.salon/melek/@afrose/bird']), /\*\*Bird\.\*\* by @afrose.*\n.*pending 32\.447 MELEK/);
  assert.match(await steemdCommand('post', ['@afrose/missing']), /No post/);
  assert.match(await steemdCommand('payout', ['@afrose/bird']), /beneficiaries none/);
  assert.match(await steemdCommand('votes', ['@afrose/bird']), /2 votes.*@maat 50%/);
  assert.match(await steemdCommand('replies', ['@afrose/bird']), /@juba: nice/);
  for (const c of ['trending', 'hot', 'new']) assert.match(await steemdCommand(c, []), /Bird\. — @afrose/);
  assert.match(await steemdCommand('blog', ['hathor']), /Latest from @hathor\*\*/);
});

test('witnesses: witness / hathor / missed / witnesses / schedule', async () => {
  const w = await steemdCommand('witness', ['hathor']);
  assert.match(w, /🟢 in the active schedule/);
  assert.match(w, /missed 37,531/);
  assert.match(w, /updated never/);
  assert.equal(await steemdCommand('hathor', []), w);
  assert.match(await steemdCommand('witness', ['nobody']), /not a registered witness/);
  assert.match(await steemdCommand('missed', ['hathor']), /37,531 blocks/);
  assert.match(await steemdCommand('witnesses', []), /1\. 🟢 @maat · missed 110,390/);
  assert.match(await steemdCommand('schedule', []), /@maat → @hathor/);
});

test('chain: feed (honest when no feed) / chain / hardfork / rewardfund / block / tx', async () => {
  assert.match(await steemdCommand('feed', []), /no witness price feed is published yet/);
  st.melek.mainnet.extra['condenser_api.get_current_median_history_price'] = () => ({ base: '0.500 MBD', quote: '1.000 MELEK' });
  assert.match(await steemdCommand('mbd', []), /1 MELEK = 0\.5 MBD/);
  assert.match(await steemdCommand('chain', []), /block #1,000,000 .* by @maat .* HF 0\.25\.0/);
  assert.match(await steemdCommand('hardfork', []), /0\.25\.0/);
  assert.match(await steemdCommand('rewardfund', []), /851454\.694 MELEK/);
  assert.match(await steemdCommand('block', []), /Block #1,000,000.*transfer×1/);
  assert.match(await steemdCommand('block', ['2000000']), /No block #2000000 yet/);
  const id = 'ab'.repeat(20);
  assert.match(await steemdCommand('tx', [id]), /add the block number/);
  assert.match(await steemdCommand('tx', [id, '5']), /transfer @a→@b 1\.000 MELEK/);
  assert.match(await steemdCommand('tx', ['xyz']), /Usage/);
});

test('engine tokens and balances', async () => {
  assert.match(await steemdCommand('engine', []), /WMELEK 1\.000/);
  assert.match(await steemdCommand('engine', ['@hathor', 'WMELEK']), /WMELEK 0/);
});

test('RPC FAILOVER: first node down → second node answers; !nodes shows the bench', async () => {
  st.down.add('melek.salon');
  assert.match(await steemdCommand('balance', ['hathor']), /137859\.946 MELEK/);
  const h = nodeHealth().mainnet;
  assert.equal(h[0].benched, true);
  assert.equal(h[1].benched, false);
  assert.match(await steemdCommand('nodes', []), /🔴 melek\.salon\/rpc .*🟢 wallet\.melek\.salon\/rpc/);
});

test('ALL nodes down → last good answer marked stale; nothing cached → honest unreachable', async () => {
  await steemdCommand('hardfork', []);
  st.down.add('melek.salon'); st.down.add('wallet.melek.salon');
  assert.match(await steemdCommand('hardfork', []), /0\.25\.0[\s\S]*chain unreachable — showing data as of/);
  for (const c of STEEMD_COMMANDS.filter((x) => x !== 'engine' && x !== 'nodes' && x !== 'tx')) {
    const r = await steemdCommand(c, ['@hathor']);
    assert.equal(typeof r, 'string', c);
  }
  assert.match(await steemdCommand('witnesses', []), /unreachable/);
});

test('every steemd command is reachable through the brain and via !steemd/!sb; legacy !sb verbs stay legacy', async () => {
  for (const c of STEEMD_COMMANDS) {
    const r = await handle({ platform: 'discord', userId: 'u', text: `!${c} @hathor` }, { commandsEnabled: true });
    assert.equal(r.handled, true, c);
  }
  assert.match((await handle({ platform: 'telegram', userId: 'u', text: '/steemd witness hathor' }, {})).reply, /Witness @hathor/);
  assert.match((await handle({ platform: 'discord', userId: 'u', text: '!sb chain' }, {})).reply, /MELEK chain/);
  assert.equal((await handle({ platform: 'discord', userId: 'u', text: '!sb markets' }, {})).handled, false);
  // the legacy steemd router now grows with the mainnet chain set
  assert.match((await runCommand('rewardfund')).text, /Reward fund/);
});

test('deterministic: the command brain never imports the AI route or the fleet queue', () => {
  for (const f of ['brain.mjs', 'steemd.mjs', 'tokenomics.mjs', 'faucet.mjs', 'tip.mjs', 'guide.mjs', 'links.mjs', 'live.mjs']) {
    const src = readFileSync(new URL(`./${f}`, import.meta.url), 'utf8');
    assert.ok(!/ai-route|fleetq|perceive|generativeai|openrouter/i.test(src.replace(/^\s*\/\/.*$/gm, '')), f);
  }
});
