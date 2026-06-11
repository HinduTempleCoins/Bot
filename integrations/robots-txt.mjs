// robots-txt.mjs — standalone, network-free robots.txt parser + isAllowed / crawl-delay checker.
//
// This module does NOT fetch anything. You hand it already-fetched robots.txt *text* (a string) and it
// tells you whether a crawler is allowed to hit a given path, and how long it should wait between
// requests. It exists so every corpus scraper / crawler in this repo (sacred-texts.mjs and friends) can
// honour the recurring 'Respects robots.txt' / 'Robots.txt Blocked Sites: respect blocks' itinerary
// items without each one re-implementing the (surprisingly fiddly) RFC-9309-ish matching rules.
//
//   import { parseRobots, isAllowed, crawlDelayMs } from './robots-txt.mjs'
//   const txt = await (await fetch('https://example.com/robots.txt')).text();
//   if (isAllowed(txt, '/some/page', 'MELEK-Bot')) { ... }
//   const waitMs = crawlDelayMs(txt, 'MELEK-Bot');   // number | null
//
// Soft-fail contract (house rule): NEVER throws. Malformed / empty / non-string input yields permissive
// defaults — allow everything, no delay. A robots.txt that fails to parse must never block legitimate
// work; it just means "no rules expressed".
//
// Matching rules implemented (matching what real crawlers like Googlebot do):
//   • user-agent groups: lines accumulate under the preceding `User-agent:` line(s). A group can name
//     several UAs. UA matching is case-insensitive substring (the product token), specific UA beats `*`.
//   • Allow / Disallow: path patterns with `*` (match any run of chars) and `$` (anchor end of path).
//   • longest-match-wins: the rule whose pattern matches the most characters decides; on an exact tie,
//     Allow wins over Disallow (the permissive-tie convention).
//   • Crawl-delay: seconds (may be fractional) → exposed as milliseconds.
//   • Sitemap: collected globally (not UA-scoped), as-is.
//   • comments (`#…`), blank lines, a leading UTF-8 BOM, and CRLF are all tolerated.

const DEFAULT_UA = 'MELEK-Bot';

// ── parseRobots: text → structured groups + sitemaps. Pure, never throws. ──
export function parseRobots(text) {
  const out = { groups: [], sitemaps: [] };
  let raw;
  try {
    raw = String(text == null ? '' : text);
  } catch {
    return out;
  }
  if (!raw) return out;

  // strip a leading BOM if present, normalise line endings.
  raw = raw.replace(/^﻿/, '');
  const lines = raw.split(/\r\n|\r|\n/);

  let current = null;        // the group we're appending rules to
  let lastWasUserAgent = false; // consecutive User-agent lines share one group

  for (let line of lines) {
    // drop comments (everything from an unescaped #) and trim.
    const hash = line.indexOf('#');
    if (hash !== -1) line = line.slice(0, hash);
    line = line.trim();
    if (!line) continue;

    const colon = line.indexOf(':');
    if (colon === -1) continue;                    // not a field:value line — skip tolerantly
    const field = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();

    if (field === 'user-agent' || field === 'useragent') {
      if (!current || !lastWasUserAgent) {
        current = { userAgents: [], allow: [], disallow: [], crawlDelay: null };
        out.groups.push(current);
      }
      if (value) current.userAgents.push(value);
      lastWasUserAgent = true;
      continue;
    }

    lastWasUserAgent = false;

    if (field === 'sitemap') {
      if (value) out.sitemaps.push(value);
      continue;
    }

    // rules below belong to the current group. A rule before any User-agent is ignored
    // (no group to attach to) — matches real-crawler behaviour.
    if (!current) continue;

    if (field === 'allow') {
      current.allow.push(value);
    } else if (field === 'disallow') {
      current.disallow.push(value);
    } else if (field === 'crawl-delay' || field === 'crawldelay') {
      const n = Number(value);
      if (Number.isFinite(n) && n >= 0) current.crawlDelay = n;
    }
    // unknown fields (host, clean-param, etc.) are tolerated and ignored.
  }

  return out;
}

// ── selectGroup: pick the best-matching UA group from parsed groups. Specific UA (substring match,
// longest token preferred) beats the `*` wildcard group. Returns null if nothing matches. ──
function selectGroup(groups, ua) {
  if (!Array.isArray(groups) || !groups.length) return null;
  const want = String(ua || DEFAULT_UA).toLowerCase();

  let best = null;       // most specific named match
  let bestLen = -1;
  let star = null;

  for (const g of groups) {
    for (const name of g.userAgents) {
      const token = String(name || '').toLowerCase();
      if (token === '*') {
        if (!star) star = g;
        continue;
      }
      // a UA group matches if its token is a substring of our UA (or vice-versa) — covers
      // 'MELEK-Bot' matching a 'melek' rule and a 'MELEK-Bot/1.0' UA matching 'MELEK-Bot'.
      if (token && (want.includes(token) || token.includes(want))) {
        if (token.length > bestLen) { best = g; bestLen = token.length; }
      }
    }
  }
  return best || star || null;
}

// ── patternToRegex: a robots path pattern (with `*` and `$`) → anchored RegExp. The pattern matches a
// *prefix* of the request path unless it ends with `$` (end-anchor). `*` matches any run of characters. ──
function patternToRegex(pattern) {
  const p = String(pattern == null ? '' : pattern);
  let anchorEnd = false;
  let body = p;
  if (body.endsWith('$')) { anchorEnd = true; body = body.slice(0, -1); }

  let re = '';
  for (const ch of body) {
    if (ch === '*') { re += '.*'; }
    else { re += ch.replace(/[.+?^${}()|[\]\\]/g, '\\$&'); }
  }
  try {
    return new RegExp('^' + re + (anchorEnd ? '$' : ''));
  } catch {
    return null;
  }
}

// matchLength: how many "specificity" chars the pattern has if it matches `path`, else -1. We use the
// pattern's own length (minus wildcards) as the precedence weight — the classic longest-match rule.
function matchLength(pattern, path) {
  const pat = String(pattern == null ? '' : pattern);
  // An empty Disallow/Allow value means "match nothing" / "match everything" respectively per spec;
  // we treat empty as a zero-length match of everything so it never out-ranks a real rule.
  if (pat === '') return 0;
  const re = patternToRegex(pat);
  if (!re) return -1;
  if (!re.test(path)) return -1;
  // weight = pattern length excluding the wildcard/anchor metacharacters.
  return pat.replace(/[*$]/g, '').length;
}

// ── isAllowed: may UA fetch `path`? longest-match-wins, Allow beats Disallow on a tie. Never throws. ──
export function isAllowed(text, path, ua = DEFAULT_UA) {
  let parsed;
  try {
    parsed = parseRobots(text);
  } catch {
    return true;
  }
  let target = String(path == null ? '/' : path);
  if (!target.startsWith('/')) target = '/' + target;

  const group = selectGroup(parsed.groups, ua);
  if (!group) return true;                    // no applicable group → allow everything

  let allowBest = -1, disallowBest = -1;
  for (const a of group.allow) {
    const m = matchLength(a, target);
    if (m > allowBest) allowBest = m;
  }
  for (const d of group.disallow) {
    // an empty Disallow value = "allow all" — it should never block, so skip it as a blocker.
    if (String(d).trim() === '') continue;
    const m = matchLength(d, target);
    if (m > disallowBest) disallowBest = m;
  }

  if (disallowBest === -1) return true;        // nothing disallows it
  if (allowBest === -1) return false;          // disallowed, no allow override
  return allowBest >= disallowBest;            // tie or longer allow → allowed
}

// ── crawlDelayMs: crawl-delay (seconds in the file) for UA, in milliseconds. null if unset. ──
export function crawlDelayMs(text, ua = DEFAULT_UA) {
  let parsed;
  try {
    parsed = parseRobots(text);
  } catch {
    return null;
  }
  const group = selectGroup(parsed.groups, ua);
  if (!group || group.crawlDelay == null) return null;
  const ms = group.crawlDelay * 1000;
  return Number.isFinite(ms) && ms >= 0 ? ms : null;
}

// No CLI / no IO: this is a pure library. Nothing runs on import.
