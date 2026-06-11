// robots-txt.test.mjs — offline, node:test. Covers parse structure, UA-group selection,
// longest-match precedence, wildcard/anchor matching, crawl-delay, and soft-fail defaults.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRobots, isAllowed, crawlDelayMs } from './robots-txt.mjs';

const SAMPLE = `# example robots
User-agent: *
Disallow: /private/
Allow: /private/public.html
Crawl-delay: 2

User-agent: MELEK-Bot
Disallow: /no-bots/
Crawl-delay: 0.5

Sitemap: https://example.com/sitemap.xml
Sitemap: https://example.com/sitemap-2.xml
`;

test('parseRobots: groups, rules, crawl-delay, sitemaps', () => {
  const r = parseRobots(SAMPLE);
  assert.equal(r.groups.length, 2);

  const star = r.groups.find(g => g.userAgents.includes('*'));
  assert.ok(star);
  assert.deepEqual(star.disallow, ['/private/']);
  assert.deepEqual(star.allow, ['/private/public.html']);
  assert.equal(star.crawlDelay, 2);

  const melek = r.groups.find(g => g.userAgents.includes('MELEK-Bot'));
  assert.ok(melek);
  assert.deepEqual(melek.disallow, ['/no-bots/']);
  assert.equal(melek.crawlDelay, 0.5);

  assert.deepEqual(r.sitemaps, [
    'https://example.com/sitemap.xml',
    'https://example.com/sitemap-2.xml',
  ]);
});

test('parseRobots: multiple consecutive User-agent lines share one group', () => {
  const r = parseRobots(`User-agent: A\nUser-agent: B\nDisallow: /x`);
  assert.equal(r.groups.length, 1);
  assert.deepEqual(r.groups[0].userAgents, ['A', 'B']);
  assert.deepEqual(r.groups[0].disallow, ['/x']);
});

test('parseRobots: tolerates BOM, comments, blanks, CRLF, junk lines', () => {
  const txt = '﻿# hello\r\nUser-agent: *  # inline comment\r\n\r\nDisallow: /a # tail\r\ngarbage-no-colon\r\nDisallow:\r\n';
  const r = parseRobots(txt);
  assert.equal(r.groups.length, 1);
  assert.deepEqual(r.groups[0].userAgents, ['*']);
  // '/a' plus the empty Disallow value.
  assert.deepEqual(r.groups[0].disallow, ['/a', '']);
});

test('isAllowed: UA-specific group selected over *', () => {
  // MELEK-Bot group blocks /no-bots/ but NOT /private/ (that's only in the * group).
  assert.equal(isAllowed(SAMPLE, '/no-bots/x', 'MELEK-Bot'), false);
  assert.equal(isAllowed(SAMPLE, '/private/secret', 'MELEK-Bot'), true);
  // A different UA falls back to the * group, which blocks /private/.
  assert.equal(isAllowed(SAMPLE, '/private/secret', 'SomeOtherBot'), false);
});

test('isAllowed: longest-match wins, Allow overrides Disallow', () => {
  const txt = `User-agent: *\nDisallow: /private/\nAllow: /private/public.html`;
  assert.equal(isAllowed(txt, '/private/public.html', 'X'), true);  // allow longer
  assert.equal(isAllowed(txt, '/private/other', 'X'), false);       // only disallow matches
});

test('isAllowed: tie between Allow and Disallow → allowed', () => {
  const txt = `User-agent: *\nDisallow: /a\nAllow: /a`;
  assert.equal(isAllowed(txt, '/a', 'X'), true);
});

test('isAllowed: wildcard * and end-anchor $', () => {
  const txt = `User-agent: *\nDisallow: /*.pdf$\nDisallow: /tmp/*/cache`;
  assert.equal(isAllowed(txt, '/files/report.pdf', 'X'), false);
  assert.equal(isAllowed(txt, '/files/report.pdf?v=1', 'X'), true); // $ anchors, query breaks match
  assert.equal(isAllowed(txt, '/tmp/abc/cache', 'X'), false);
  assert.equal(isAllowed(txt, '/tmp/cache', 'X'), true);            // needs a segment between
});

test('isAllowed: empty Disallow means allow-all', () => {
  const txt = `User-agent: *\nDisallow:`;
  assert.equal(isAllowed(txt, '/anything', 'X'), true);
});

test('isAllowed: path normalised to leading slash', () => {
  const txt = `User-agent: *\nDisallow: /x`;
  assert.equal(isAllowed(txt, 'x', 'X'), false);
});

test('crawlDelayMs: seconds → ms, UA-scoped', () => {
  assert.equal(crawlDelayMs(SAMPLE, 'MELEK-Bot'), 500);
  assert.equal(crawlDelayMs(SAMPLE, 'OtherBot'), 2000); // * group
});

test('crawlDelayMs: null when unset', () => {
  const txt = `User-agent: *\nDisallow: /x`;
  assert.equal(crawlDelayMs(txt, 'X'), null);
});

test('soft-fail: malformed / empty / non-string input is permissive', () => {
  assert.deepEqual(parseRobots(null), { groups: [], sitemaps: [] });
  assert.deepEqual(parseRobots(undefined), { groups: [], sitemaps: [] });
  assert.deepEqual(parseRobots(12345), { groups: [], sitemaps: [] });
  assert.deepEqual(parseRobots({}), { groups: [], sitemaps: [] });

  assert.equal(isAllowed('', '/whatever'), true);
  assert.equal(isAllowed(null, '/whatever'), true);
  assert.equal(isAllowed('not a robots file at all', '/x'), true);
  assert.equal(crawlDelayMs('', 'X'), null);
  assert.equal(crawlDelayMs(null), null);
});

test('default UA used when not provided', () => {
  const txt = `User-agent: MELEK-Bot\nDisallow: /secret`;
  assert.equal(isAllowed(txt, '/secret'), false); // defaults to MELEK-Bot
  assert.equal(crawlDelayMs(`User-agent: MELEK-Bot\nCrawl-delay: 1`), 1000);
});
