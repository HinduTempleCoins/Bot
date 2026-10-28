// discord-organize.test.mjs — the pure planner: creates + moves only, never deletes.
import { test } from 'node:test';
import assert from 'node:assert';
import { planChanges, renderPlan, LAYOUT, applyPlan, __setFetch, topicFor } from './discord-organize.mjs';

const cat = (id, name) => ({ id, name, type: 4 });
const txt = (id, name, parent_id = null) => ({ id, name, type: 0, parent_id });

test('empty guild → all categories and channels created, nothing moved', () => {
  const plan = planChanges([]);
  assert.equal(plan.summary.createCategories, LAYOUT.length);
  assert.ok(plan.summary.createChannels > 10);
  assert.equal(plan.summary.moveChannels, 0);
  assert.ok(!plan.ops.some((o) => /delete|remove/.test(o.kind))); // never destructive
});

test('existing channels are MOVED into their category, not recreated', () => {
  const plan = planChanges([txt('1', 'general'), txt('2', 'mining')]);
  const moveGeneral = plan.ops.find((o) => o.kind === 'move-channel' && o.name === 'general');
  assert.ok(moveGeneral);
  assert.equal(moveGeneral.category, '🎮 COMMUNITY');
  // 'general' is in COMMUNITY's create list but must NOT be created again
  assert.ok(!plan.ops.some((o) => o.kind === 'create-channel' && o.name === 'general'));
});

test('operator 2026-06-18: legacy channels routed to their final homes', () => {
  const plan = planChanges([
    txt('1', 'rs3'), txt('2', 'minecraft'),
    txt('3', 'graphene-blockchains'), txt('4', 'bible'), txt('5', 'biohacking'), txt('6', 'shaivism'),
  ]);
  const moved = (name) => plan.ops.find((o) => o.kind === 'move-channel' && o.name === name);
  assert.equal(moved('rs3').category, '🕹️ GAMES');                 // rs3 → Games
  assert.equal(moved('minecraft').category, '🕹️ GAMES');
  assert.equal(moved('graphene-blockchains').category, '⛓️ MELEK CHAIN'); // → chain
  assert.equal(moved('biohacking').category, '🎮 COMMUNITY');       // stays in the catch-all
  assert.equal(moved('bible').category, '⛪ RELIGION');             // → Religion
  assert.equal(moved('shaivism').category, '⛪ RELIGION');
  // Religion is a new category with the new channels created in it
  assert.ok(plan.ops.some((o) => o.kind === 'create-category' && o.name === '⛪ RELIGION'));
  for (const n of ['prayer-requests', 'lizard-people', 'hierophant']) {
    const c = plan.ops.find((o) => o.kind === 'create-channel' && o.name === n);
    assert.equal(c.category, '⛪ RELIGION', `${n} created in Religion`);
  }
  // WIKI no longer carries sacred-texts; TRADE no longer carries what-ifs (not created)
  assert.ok(!plan.ops.some((o) => o.kind === 'create-channel' && o.name === 'sacred-texts'));
  assert.ok(!plan.ops.some((o) => o.kind === 'create-channel' && o.name === 'what-ifs'));
});

test('channels already in the right category are left alone', () => {
  const guild = [cat('c1', '🎮 COMMUNITY'), txt('1', 'general', 'c1')];
  const plan = planChanges(guild);
  assert.ok(!plan.ops.some((o) => o.kind === 'move-channel' && o.name === 'general'));
  assert.ok(!plan.ops.some((o) => o.kind === 'create-category' && o.name === '🎮 COMMUNITY'));
});

test('unknown channels are untouched and counted', () => {
  const plan = planChanges([txt('9', 'my-special-channel')]);
  assert.equal(plan.summary.untouched, 1);
  assert.ok(!plan.ops.some((o) => o.id === '9'));
});

test('a channel matches at most one category (first wins)', () => {
  const plan = planChanges([txt('1', 'welcome')]);
  const moves = plan.ops.filter((o) => o.kind === 'move-channel' && o.id === '1');
  assert.equal(moves.length, 1);
  assert.equal(moves[0].category, '📜 START HERE');
});

test('renderPlan mentions the non-destructive guarantee', () => {
  const out = renderPlan(planChanges([]));
  assert.match(out, /nothing deleted/);
});

test('applyPlan reuses a passed-in channel list instead of re-fetching (no redundant GET)', async () => {
  process.env.DISCORD_TOKEN = 'x'; // authHeaders needs it set; never logged
  let getCount = 0;
  __setFetch(async (url, opts) => {
    const method = (opts && opts.method) || 'GET';
    if (method === 'GET') getCount++;
    return { ok: true, status: 200, json: async () => ({ id: 'new1' }) };
  });
  const existing = [cat('c1', '🎮 COMMUNITY')];
  // a plan with one create-category op so applyPlan does real work
  await applyPlan('guild123', { ops: [{ kind: 'create-category', name: '🆕 X', adminOnly: false }] }, existing);
  assert.equal(getCount, 0, 'applyPlan must not GET channels when existing is supplied');
  __setFetch(null);
  delete process.env.DISCORD_TOKEN;
});

test('applyPlan fetches the channel list itself when none is supplied', async () => {
  process.env.DISCORD_TOKEN = 'x';
  let getCount = 0;
  __setFetch(async (url, opts) => {
    const method = (opts && opts.method) || 'GET';
    if (method === 'GET') { getCount++; return { ok: true, status: 200, json: async () => [] }; }
    return { ok: true, status: 200, json: async () => ({ id: 'new1' }) };
  });
  await applyPlan('guild123', { ops: [] }); // no existing arg → one GET
  assert.equal(getCount, 1, 'applyPlan fetches once when existing is omitted');
  __setFetch(null);
  delete process.env.DISCORD_TOKEN;
});

// ── links in channel topics (added 2026-10-27) ──────────────────────────────────────────────────

test('every section carries links, and each topic fits Discord\'s 1024-char cap', () => {
  for (const sec of LAYOUT) {
    assert.ok(Array.isArray(sec.links) && sec.links.length > 0, `${sec.category} has no links`);
    const topic = topicFor(sec);
    assert.ok(topic.length > 0, `${sec.category} produced an empty topic`);
    assert.ok(topic.length <= 1024, `${sec.category} topic is ${topic.length} chars, over the cap`);
    for (const [label, url] of sec.links) {
      assert.ok(label && typeof label === 'string', `${sec.category} has a link with no label`);
      assert.match(url, /^https:\/\//, `${sec.category} link ${label} is not https`);
    }
  }
});

test('topicFor truncates at a link boundary rather than mid-URL', () => {
  const many = Array.from({ length: 80 }, (_, i) => [`Label ${i}`, `https://example-${i}.soapbox.community`]);
  const topic = topicFor({ category: '🧰 TOOLS', links: many });
  assert.ok(topic.length <= 1024);
  assert.ok(!/https:\/\/[a-z0-9-]*$/.test(topic) || topic.endsWith('community'), 'must not end mid-URL');
  assert.ok(!topic.endsWith(' ·'), 'must not end on a dangling separator');
});

test('the planner sets a link topic on each section and never deletes or renames', () => {
  const plan = planChanges([]);
  assert.equal(plan.summary.setTopics, LAYOUT.length, 'one topic op per section');
  for (const o of plan.ops) {
    assert.ok(['create-category', 'create-channel', 'move-channel', 'set-topic'].includes(o.kind), `unexpected op ${o.kind}`);
  }
});

test('a topic already correct produces no op — re-running is a no-op', () => {
  const sec = LAYOUT[0];
  const anchor = sec.create[0];
  const existing = [
    { id: 'c1', name: sec.category, type: 4 },
    { id: 't1', name: anchor, type: 0, parent_id: 'c1', topic: topicFor(sec) },
  ];
  const plan = planChanges(existing, [sec]);
  assert.equal(plan.ops.filter((o) => o.kind === 'set-topic').length, 0, 'no topic op when it already matches');
});

test('ADDITIVE ONLY: the sections added later never claim a channel an older section owns', () => {
  // The ten categories the operator set are frozen. A later section stealing one of their
  // match names would silently move that channel out of its category on the next apply.
  const frozen = LAYOUT.slice(0, 10);
  const added = LAYOUT.slice(10);
  const owned = new Set(frozen.flatMap((s) => (s.match || []).map((x) => x.toLowerCase())));
  for (const sec of added) {
    for (const name of sec.match || []) {
      assert.ok(!owned.has(name.toLowerCase()), `${sec.category} would steal #${name} from an operator-set category`);
    }
  }
});

test('the ten operator-set category names are unchanged', () => {
  assert.deepEqual(LAYOUT.slice(0, 10).map((s) => s.category), [
    '📜 START HERE', '🎮 COMMUNITY', '⛓️ MELEK CHAIN', '⛏️ MINING POOL', '🧼 SOAPBOX',
    '📈 TRADE & MARKETS', '📚 WIKI', '🕹️ GAMES', '⛪ RELIGION', '🔧 OPERATOR',
  ], 'renaming one of these orphans its channels — see the layout comment');
});
