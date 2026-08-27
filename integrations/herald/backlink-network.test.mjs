// backlink-network.test.mjs — OFFLINE tests for the Herald curated backlink network.
// Proves the anti-penalty rules: category/relevance match, per-site cap, natural reciprocity, quality
// gate, rate limit, appropriate rel — and that networkHealth() REJECTS a link-farm ("everyone links to
// everyone") scenario. Pure, deterministic (injected clock), never throws, no network.

import { test } from 'node:test';
import assert from 'node:assert';
import {
  createBacklinkNetwork, relevance, siteQuality, passesGate, safeHref, esc,
  MAX_LINKS_PER_SITE, RATE_MAX_NEW, RECIPROCITY_MAX_RATIO, QUALITY_MIN, CATEGORIES,
} from './backlink-network.mjs';

const DAY = 86400000;
// A clock we can advance between calls.
function clockAt(start) { const c = { t: start }; return { now: () => c.t, adv: (ms) => { c.t += ms; }, set: (v) => { c.t = v; } }; }

// Build a network with N members in a given category, all opted-in + high quality.
function seed(net, list) {
  for (const [id, category] of list) {
    net.register({ id, name: id.toUpperCase(), url: `https://${id}.example`, category, optIn: true, quality: 85 });
  }
}

test('relevance: same category is "same", adjacent is "related", unrelated/unknown is "none"', () => {
  assert.equal(relevance('business', 'business'), 'same');
  assert.equal(relevance('business', 'finance'), 'related');
  assert.equal(relevance('business', 'health'), 'none');
  assert.equal(relevance('business', 'made-up'), 'none');   // unknown fails closed
  assert.equal(relevance('', ''), 'none');
});

test('quality gate: needs opt-in, live, https url, valid category, not flagged, score >= QUALITY_MIN', () => {
  const base = { url: 'https://a.example', category: 'business', name: 'A', optIn: true };
  assert.ok(passesGate(base));
  assert.ok(!passesGate({ ...base, optIn: false }), 'opt-in required');
  assert.ok(!passesGate({ ...base, live: false }), 'must be live');
  assert.ok(!passesGate({ ...base, flagged: true }), 'flagged fails');
  assert.ok(!passesGate({ ...base, url: 'javascript:alert(1)' }), 'must be a real http(s) url');
  assert.ok(!passesGate({ ...base, category: 'nope' }), 'valid category required');
  assert.ok(!passesGate({ ...base, quality: 10 }), 'below QUALITY_MIN fails');
  assert.equal(siteQuality({ ...base, flagged: true }), 0);
  assert.ok(QUALITY_MIN > 0);
});

test('linksFor respects CATEGORY MATCH — irrelevant sites never surface', () => {
  const net = createBacklinkNetwork({ now: () => 1000 });
  seed(net, [['a', 'business'], ['b', 'finance'], ['c', 'health'], ['d', 'travel']]);
  // record placements so rate budget is not the limiter; but a fresh look at 'a':
  const links = net.linksFor('a', { at: 1000 });
  const cats = links.map((l) => l.category);
  assert.ok(cats.includes('finance'), 'finance is related to business → allowed');
  assert.ok(!cats.includes('health'), 'health is irrelevant to business → excluded');
  assert.ok(!cats.includes('travel'), 'travel is irrelevant to business → excluded');
  for (const l of links) assert.notEqual(relevance('business', l.category), 'none');
});

test('linksFor respects the PER-SITE CAP', () => {
  const net = createBacklinkNetwork({ maxLinksPerSite: MAX_LINKS_PER_SITE, now: () => 0 });
  // many same-category members so the cap (not relevance/rate) is what binds
  const many = [];
  for (let i = 0; i < 12; i++) many.push([`s${i}`, 'business']);
  seed(net, many);
  // Pre-place plenty of links from s0 across many days so rate budget never binds, then read the cap.
  const clock = clockAt(0);
  for (let i = 1; i <= 10; i++) { net.recordPlacement({ from: 's0', to: `s${i}`, at: i * DAY }); }
  const links = net.linksFor('s0', { at: 11 * DAY });
  assert.ok(links.length <= MAX_LINKS_PER_SITE, `must not exceed cap ${MAX_LINKS_PER_SITE}, got ${links.length}`);
  assert.equal(links.length, MAX_LINKS_PER_SITE, 'with 10 placed same-category members the cap binds exactly');
});

test('linksFor respects the RATE LIMIT — a fresh site introduces at most RATE_MAX_NEW new links', () => {
  const net = createBacklinkNetwork({ now: () => 0 });
  const many = [];
  for (let i = 0; i < 12; i++) many.push([`s${i}`, 'business']);
  seed(net, many);
  // Nothing placed yet → every candidate is "new" → the rate limit binds, not the per-site cap.
  const links = net.linksFor('s0', { at: 0 });
  assert.equal(links.length, RATE_MAX_NEW, `a fresh site is rate-limited to ${RATE_MAX_NEW} new links`);
  assert.ok(RATE_MAX_NEW < MAX_LINKS_PER_SITE, 'rate limit is tighter than the per-site cap (both observable)');
});

test('linksFor respects NATURAL (not blanket) RECIPROCITY — reciprocal links are capped', () => {
  const net = createBacklinkNetwork({ maxLinksPerSite: MAX_LINKS_PER_SITE, now: () => 0 });
  const many = [];
  for (let i = 0; i < 12; i++) many.push([`s${i}`, 'business']);
  seed(net, many);
  // Make s1..s6 all link BACK to s0 (so they are reciprocal candidates), spread over days.
  for (let i = 1; i <= 6; i++) net.recordPlacement({ from: `s${i}`, to: 's0', at: i * DAY });
  // Also let s0 place links over many days so the rate budget doesn't bind.
  for (let i = 1; i <= 6; i++) net.recordPlacement({ from: 's0', to: `s${i}`, at: i * DAY });
  const links = net.linksFor('s0', { at: 10 * DAY });
  const reciprocal = links.filter((l) => l.reciprocal).length;
  assert.ok(reciprocal <= Math.floor(MAX_LINKS_PER_SITE * RECIPROCITY_MAX_RATIO),
    `reciprocal links (${reciprocal}) must be capped to floor(cap*${RECIPROCITY_MAX_RATIO})`);
  assert.ok(reciprocal < links.length || links.length === 0, 'not every surfaced link is reciprocal');
});

test('appropriate rel: reciprocal / lower-quality links get rel="nofollow"; not everything is follow', () => {
  const net = createBacklinkNetwork({ now: () => 0 });
  // one high-quality same-category peer (follow-eligible) + one reciprocal peer (nofollow)
  net.register({ id: 'a', name: 'A', url: 'https://a.example', category: 'business', optIn: true, quality: 90 });
  net.register({ id: 'b', name: 'B', url: 'https://b.example', category: 'business', optIn: true, quality: 95 });
  net.register({ id: 'c', name: 'C', url: 'https://c.example', category: 'business', optIn: true, quality: 95 });
  net.recordPlacement({ from: 'c', to: 'a', at: 0 });   // c links back to a → reciprocal for a
  const links = net.linksFor('a', { at: 0 });
  const byId = Object.fromEntries(links.map((l) => [l.id, l]));
  if (byId.c) assert.equal(byId.c.rel, 'nofollow', 'reciprocal link must be nofollow');
  // at least one non-reciprocal high-quality same-category link should be editorial follow
  const followed = links.filter((l) => l.rel === '');
  assert.ok(followed.length >= 1, 'a curated network still gives some editorial follow links');
});

test('networkHealth REJECTS an everyone-links-to-everyone LINK FARM (caps + irrelevance + reciprocity)', () => {
  const net = createBacklinkNetwork({ now: () => 0 });
  // 8 sites across two DIFFERENT category clusters that are NOT relevant to each other.
  const list = [];
  for (let i = 0; i < 4; i++) list.push([`biz${i}`, 'business']);
  for (let i = 0; i < 4; i++) list.push([`med${i}`, 'health']);
  seed(net, list);
  const all = list.map(([id]) => id);
  // everyone links to everyone else, all at the SAME instant (a burst) — the classic PBN pattern.
  for (const from of all) for (const to of all) if (from !== to) net.recordPlacement({ from, to, at: 0 });
  const health = net.networkHealth();
  assert.equal(health.ok, false, 'a link farm must be flagged, not healthy');
  const types = health.flags.map((f) => f.type);
  assert.ok(types.includes('cap'), 'per-site cap exceeded is flagged');          // 7 outbound > 5
  assert.ok(types.includes('irrelevance'), 'cross-category links are flagged');   // business<->health
  assert.ok(types.includes('reciprocity'), 'over-reciprocity is flagged');        // all mutual
  assert.ok(types.includes('rate'), 'burst introductions are flagged');           // all at at=0
  assert.ok(health.score < 50, 'a link farm scores poorly');
});

test('a small curated relevant network is HEALTHY', () => {
  const net = createBacklinkNetwork({ now: () => 0 });
  seed(net, [['a', 'business'], ['b', 'finance'], ['c', 'tech']]);
  // a few relevant, spaced, one-directional links
  net.recordPlacement({ from: 'a', to: 'b', at: 0 });
  net.recordPlacement({ from: 'b', to: 'c', at: DAY });
  net.recordPlacement({ from: 'c', to: 'a', at: 2 * DAY });
  const health = net.networkHealth();
  assert.equal(health.ok, true, `curated network should be healthy, flags=${JSON.stringify(health.flags)}`);
  assert.ok(health.score >= 80);
});

test('renderRelatedBlock escapes hostile member names and neutralizes bad URLs', () => {
  const net = createBacklinkNetwork({ now: () => 0 });
  net.register({ id: 'a', name: 'A', url: 'https://a.example', category: 'business', optIn: true, quality: 90 });
  // a member whose name is an XSS payload; url is a real https so it can surface
  net.register({ id: 'x', name: '<script>alert(1)</script>', url: 'https://x.example', category: 'business', optIn: true, quality: 90 });
  const html = net.renderRelatedBlock('a', { at: 0 });
  assert.ok(!html.includes('<script>alert(1)</script>'), 'hostile name must be escaped');
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /rel="/);                        // rel attribute present (nofollow discipline)
  assert.match(html, /Related sites/);
  assert.match(html, /disclosed/i);                   // disclosure line present
});

test('register rejects bad input and never throws; javascript: url is refused', () => {
  const net = createBacklinkNetwork({ now: () => 0 });
  assert.equal(net.register({}).ok, false);
  assert.equal(net.register({ id: 'a', url: 'javascript:alert(1)', category: 'business' }).ok, false);
  assert.equal(net.register({ id: 'a', url: 'https://a.example', category: 'nope' }).ok, false);
  assert.equal(net.register({ id: 'a', url: 'https://a.example', category: 'business', optIn: true }).ok, true);
  // linksFor on an unknown / gated-out site is [] not a throw
  assert.deepEqual(net.linksFor('ghost'), []);
  assert.deepEqual(net.linksFor(null), []);
});

test('safeHref + esc soundness', () => {
  assert.equal(safeHref('javascript:alert(1)'), '');
  assert.equal(safeHref('data:text/html,x'), '');
  assert.equal(safeHref('https://ok.example/x'), 'https://ok.example/x');
  assert.equal(esc('<b>&"\'' ), '&lt;b&gt;&amp;&quot;&#39;');
});

test('toDirectory returns only gated members for the discovery seam', () => {
  const net = createBacklinkNetwork({ now: () => 0 });
  net.register({ id: 'a', name: 'A', url: 'https://a.example', category: 'business', optIn: true, quality: 90 });
  net.register({ id: 'b', name: 'B', url: 'https://b.example', category: 'business', optIn: false }); // not opted in
  const dir = net.toDirectory();
  assert.equal(dir.length, 1);
  assert.equal(dir[0].id, 'a');
  assert.ok('category' in dir[0] && 'url' in dir[0]);
});

test('CATEGORIES is a non-empty stable list', () => {
  assert.ok(Array.isArray(CATEGORIES) && CATEGORIES.length >= 8);
  assert.ok(CATEGORIES.includes('business') && CATEGORIES.includes('portfolio'));
});
