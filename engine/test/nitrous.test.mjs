/**
 * nitrous.test.mjs — the Nitrous-equivalent per-token front-end generator.
 *
 * Offline. Verifies: tokenSnapshot pulls the right token/holders/rule/posts/
 * leaderboard; renderTokenSite produces a branded page from a config theme;
 * esc() escapes attacker-influenced interpolation (token name, account name,
 * theme strings); unknown symbol soft-fails to a 404 page (never throws); the
 * HTTP handler routes /:SYMBOL and /.
 *
 * Run: node --test engine/test/nitrous.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { State } from '../lib/state.mjs';
import { bootstrapGenesis } from '../lib/genesis.mjs';
import { tokens } from '../contracts/tokens.mjs';
import { rewards } from '../contracts/rewards.mjs';
import {
  renderTokenSite,
  tokenSnapshot,
  makeNitrousHandler,
  esc,
} from '../nitrous/render.mjs';

function ctx(sender, blockNum = 1) {
  return { sender, blockNum, blockId: 'b', txId: 't', authLevel: 'active' };
}

// Build a tribe with a reward rule, votes, and a matured+paid post.
function tribeState() {
  const s = new State(null);
  bootstrapGenesis(s);
  tokens.transfer(s, ctx('hathor'), { symbol: 'APIS', to: 'alice', quantity: '500' });
  tokens.create(s, ctx('alice'), { symbol: 'TRIBE', name: 'My Tribe', precision: 3, maxSupply: '1000000' });
  tokens.issue(s, ctx('alice'), { symbol: 'TRIBE', to: 'bob', quantity: '100' });
  tokens.issue(s, ctx('alice'), { symbol: 'TRIBE', to: 'carol', quantity: '300' });
  tokens.stake(s, ctx('bob'), { symbol: 'TRIBE', quantity: '100' });
  tokens.stake(s, ctx('carol'), { symbol: 'TRIBE', quantity: '300' });
  rewards.setReward(s, ctx('alice'), {
    symbol: 'TRIBE', emissionPerWindow: '12', windowBlocks: 1, authorBps: 5000, curve: 'linear',
  });
  rewards.vote(s, ctx('bob', 1), { author: 'dave', permlink: 'p1', symbol: 'TRIBE' });
  rewards.vote(s, ctx('carol', 1), { author: 'dave', permlink: 'p1', symbol: 'TRIBE' });
  rewards.payout(s, ctx('x', 3), { symbol: 'TRIBE' });
  return s;
}

test('tokenSnapshot: pulls token, holders, rule, posts, leaderboard', () => {
  const s = tribeState();
  const snap = tokenSnapshot(s, 'tribe'); // case-insensitive
  assert.ok(snap);
  assert.equal(snap.token.symbol, 'TRIBE');
  assert.equal(snap.token.issuer, 'alice');
  assert.ok(snap.rule);
  assert.equal(snap.rule.authorPct, '50.00');
  assert.equal(snap.rule.curatorPct, '50.00');
  // holders sorted by total holding (carol staked 300, dave earned 6, ...)
  assert.ok(snap.holders.length >= 2);
  // the post shows up and is paid
  const post = snap.posts.find((p) => p.postKey === 'dave/p1');
  assert.ok(post);
  assert.equal(post.paid, true);
  // leaderboard has dave (earned 6 as author)
  assert.ok(snap.leaderboard.some((l) => l.account === 'dave'));
});

test('tokenSnapshot: unknown token returns null', () => {
  const s = tribeState();
  assert.equal(tokenSnapshot(s, 'GHOST'), null);
});

test('renderTokenSite: branded page from theme config, esc() interpolation', () => {
  const s = tribeState();
  const html = renderTokenSite(s, 'TRIBE', {
    name: 'Cool Tribe',
    tagline: 'best tribe',
    accent: '#ff0066',
    logoText: '★',
  });
  assert.match(html, /<!doctype html>/);
  assert.match(html, /Cool Tribe/);
  assert.match(html, /TRIBE/);
  assert.match(html, /best tribe/);
  assert.match(html, /#ff0066/); // accent applied
  assert.match(html, /dave\/p1/); // post listed
  assert.match(html, /@alice/); // issuer
  // reward pool config surfaced
  assert.match(html, /window 1 blocks/);
  assert.match(html, /linear curve/);
});

test('renderTokenSite: escapes attacker-influenced names + rejects bad colour', () => {
  const s = new State(null);
  bootstrapGenesis(s);
  // token NAME is user-chosen on L1; ensure it is escaped in output.
  tokens.transfer(s, ctx('hathor'), { symbol: 'APIS', to: 'alice', quantity: '500' });
  tokens.create(s, ctx('alice'), {
    symbol: 'XSS',
    name: '<script>alert(1)</script>',
    precision: 0,
    maxSupply: '100',
  });
  const html = renderTokenSite(s, 'XSS', {
    tagline: '<img src=x onerror=alert(1)>',
    accent: 'red"; }/**/body{display:none', // malicious colour -> must be dropped
  });
  // no raw <script> from the token name; angle brackets are escaped
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.match(html, /&lt;script&gt;/);
  assert.ok(!html.includes('<img src=x onerror'));
  // bad colour rejected -> falls back to default accent, never injected raw
  assert.ok(!html.includes('display:none'));
});

test('renderTokenSite: unknown symbol -> soft-fail 404 page, no throw', () => {
  const s = tribeState();
  let html;
  assert.doesNotThrow(() => {
    html = renderTokenSite(s, 'NOPE');
  });
  assert.match(html, /not found/i);
  assert.match(html, /NOPE/);
});

test('makeNitrousHandler: routes / (index) and /:SYMBOL', async () => {
  const s = tribeState();
  const handler = makeNitrousHandler(s, (sym) => ({ name: `${sym} site` }));

  function call(url) {
    return new Promise((resolve) => {
      let body = '';
      const res = {
        writeHead(code, headers) { this._code = code; this._headers = headers; },
        end(chunk) { body += chunk || ''; resolve({ code: this._code, body, headers: this._headers }); },
      };
      handler({ url }, res);
    });
  }

  const index = await call('/');
  assert.equal(index.code, 200);
  assert.match(index.body, /token tribes/i);
  assert.match(index.body, /TRIBE/);

  const page = await call('/TRIBE');
  assert.equal(page.code, 200);
  assert.match(page.body, /TRIBE site/); // theme from themeFor()
  assert.match(page.headers['content-type'], /text\/html/);

  const missing = await call('/GHOST');
  assert.equal(missing.code, 404);
  assert.match(missing.body, /not found/i);
});

test('esc escapes the five HTML-significant chars', () => {
  assert.equal(esc(`<>&"'`), '&lt;&gt;&amp;&quot;&#39;');
  assert.equal(esc(null), '');
  assert.equal(esc(undefined), '');
});
