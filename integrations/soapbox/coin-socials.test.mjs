// coin-socials.test.mjs — offline. Run: node --test integrations/soapbox/coin-socials.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classify, twitterHandle, socialsFor, renderSocials, hasSocials,
  twitterTimelineHTML, socialButtonsHTML, CURATED,
} from './coin-socials.mjs';

test('classify maps known hosts to platforms and ignores junk', () => {
  assert.equal(classify('https://twitter.com/Bitcoin').key, 'twitter');
  assert.equal(classify('https://x.com/ethereum').key, 'twitter');
  assert.equal(classify('https://discord.gg/abc').key, 'discord');
  assert.equal(classify('https://t.me/Litecoin').key, 'telegram');
  assert.equal(classify('https://www.reddit.com/r/Bitcoin').key, 'reddit');
  assert.equal(classify('https://github.com/bitcoin/bitcoin').key, 'github');
  assert.equal(classify('https://bitcointalk.org/index.php?topic=1').key, 'bitcointalk');
  assert.equal(classify('not a url'), null);
  assert.equal(classify('ftp://x.com/a'), null);
  assert.equal(classify(''), null);
});

test('twitterHandle extracts the handle and rejects non-profile paths', () => {
  assert.equal(twitterHandle('https://twitter.com/Bitcoin'), 'Bitcoin');
  assert.equal(twitterHandle('https://x.com/@solana'), 'solana');
  assert.equal(twitterHandle('https://twitter.com/intent/tweet'), null);
  assert.equal(twitterHandle('https://discord.gg/x'), null);
});

test('socialsFor pulls links from links.social and official.{reddit,chats,repos}', () => {
  const coin = {
    id: 'somecoin', symbol: 'SOME', name: 'Some Coin',
    links: { website: 'https://some.org', social: ['https://twitter.com/somecoin'] },
    official: { reddit: 'https://reddit.com/r/somecoin', chats: ['https://discord.gg/abc', 'https://t.me/somecoin'], repos: ['https://github.com/some/some'] },
  };
  const s = socialsFor(coin);
  assert.equal(s.twitter, 'https://twitter.com/somecoin');
  assert.equal(s.twitterHandle, 'somecoin');
  assert.equal(s.discord, 'https://discord.gg/abc');
  assert.equal(s.telegram, 'https://t.me/somecoin');
  assert.equal(s.reddit, 'https://reddit.com/r/somecoin');
  assert.equal(s.github, 'https://github.com/some/some');
  assert.equal(s.website, 'https://some.org');
  assert.ok(s.all.length >= 5, 'collects an ordered list');
});

test('curated overrides win over adapter data for headline coins', () => {
  const coin = {
    id: 'bitcoin', symbol: 'BTC', name: 'Bitcoin',
    links: { website: 'https://bitcoin.org', social: ['https://twitter.com/StaleHandle'] },
    official: {},
  };
  const s = socialsFor(coin);
  assert.equal(s.twitter, CURATED.bitcoin.twitter, 'curated twitter replaces stale adapter twitter');
  assert.equal(s.reddit, CURATED.bitcoin.reddit);
  assert.equal(s.twitterHandle, 'Bitcoin');
});

test('socialsFor is soft on garbage input', () => {
  assert.deepEqual(socialsFor(null).all, []);
  assert.deepEqual(socialsFor(undefined).all, []);
  assert.deepEqual(socialsFor({}).all, []);
});

test('twitter timeline embed includes the widget script and the handle', () => {
  const html = twitterTimelineHTML('ethereum', { name: 'Ethereum' });
  assert.match(html, /platform\.twitter\.com\/widgets\.js/);
  assert.match(html, /twitter\.com\/ethereum/);
  assert.match(html, /twitter-timeline/);
  assert.equal(twitterTimelineHTML(null), '', 'no handle → empty');
});

test('social buttons render every non-twitter platform + website, escaping URLs', () => {
  const s = socialsFor({
    id: 'c', symbol: 'C', links: { website: 'https://c.org', social: ['https://twitter.com/c'] },
    official: { reddit: 'https://reddit.com/r/c', chats: ['https://discord.gg/c'] },
  });
  const html = socialButtonsHTML(s);
  assert.match(html, /Website/);
  assert.match(html, /Discord/);
  assert.match(html, /Reddit/);
  assert.ok(!/Twitter \/ X<\/a>/.test(html), 'twitter is a timeline, not a button');
});

test('renderSocials yields a timeline + buttons; hasSocials gates the card', () => {
  const coin = {
    id: 'x', symbol: 'X', name: 'X',
    links: { website: 'https://x.org', social: ['https://twitter.com/xproj'] },
    official: { chats: ['https://discord.gg/x'] },
  };
  const body = renderSocials(coin);
  assert.match(body, /twitter-timeline/);
  assert.match(body, /Discord/);
  assert.equal(hasSocials(coin), true);
  assert.equal(hasSocials({}), false);
});

test('a coin with only a twitter URL but unparseable handle still gets a link', () => {
  const coin = { id: 'y', symbol: 'Y', links: { social: ['https://twitter.com/intent/tweet'] }, official: {} };
  const s = socialsFor(coin);
  assert.equal(s.twitter, 'https://twitter.com/intent/tweet');
  assert.equal(s.twitterHandle, null);
});
