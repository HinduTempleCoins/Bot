// holder-contact-harvest — turn a holder's own website into a contact route, and refuse the ones
// that are not his.
//
// WHY THIS EXISTS. The holder file has 17,784 VKBT/CURE rows. 325 carry an email. All 325 came from a
// website crawl, and 4,047 rows have a website nobody has crawled yet — so the email channel is not
// small because these people are unreachable, it is small because the crawl stopped.
//
// THE PART THAT MATTERS MORE THAN THE YIELD. Look at where the existing 325 came from and the bug is
// visible: `read.cash/contact` appears 18 times, `amazon.com` 3, `amzn.to` 4, `hive.io` once. Those
// are not those holders' addresses. `read.cash/contact` is the platform's own support desk; `amzn.to`
// is an affiliate link in a post footer. A campaign that mails them is not doing outreach — it is
// mailing a support desk 18 times with a stranger's name on it, which is exactly the behaviour that
// got the operator's Hive accounts onto Spaminator in the first place.
//
// So the yield is not the point. `attribution()` is: an address is only this holder's if it lives on
// a domain he controls, or if it was published on a page of his own site. Everything else is a
// third-party address that happened to be nearby, and it is dropped with a reason.
//
// Nothing here sends. It reads public pages, at a throttle, and produces rows for Herald's gate
// (pentecaust/herald/compliance.mjs) to decide about later.

import { isValidEmail } from './email-verify.mjs';
import { makeThrottle } from './scrape-throttle.mjs';

const str = (v) => String(v == null ? '' : v).trim();
const low = (v) => str(v).toLowerCase();

let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

// ── who owns an address ───────────────────────────────────────────────────────────────────────────

/** Free mailbox providers. An address here says nothing about who owns it — the PAGE it was on does. */
export const FREEMAIL = Object.freeze(new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'ymail.com', 'hotmail.com', 'outlook.com', 'live.com',
  'msn.com', 'aol.com', 'proton.me', 'protonmail.com', 'pm.me', 'icloud.com', 'me.com', 'mail.com',
  'gmx.com', 'gmx.de', 'yandex.ru', 'zoho.com', 'tutanota.com', 'fastmail.com', 'hey.com',
]));

/**
 * Addresses belonging to a PLATFORM rather than to any of its users. These are the ones already in
 * the file, and each one is a support desk that would have received the same pitch once per holder
 * who happened to link there.
 */
export const PLATFORM_DOMAINS = Object.freeze(new Set([
  'read.cash', 'noise.cash', 'hive.io', 'hive.blog', 'peakd.com', 'ecency.com', 'steemit.com',
  'blurt.blog', 'publish0x.com', 'medium.com', 'substack.com', 'patreon.com', 'linktr.ee',
  'allmylinks.com', 'amazon.com', 'amzn.to', 'ebay.com', 'etsy.com', 'shopify.com', 'wordpress.com',
  'blogspot.com', 'wixpress.com', 'squarespace.com', 'github.com', 'discord.com', 'telegram.org',
  'sentry.io', 'sentry-next.wixpress.com', 'example.com', 'domain.com', 'email.com',
  // Advertising boilerplate that renders into every page of a hub. Found the hard way: each of these
  // appeared once per Linktree across 111 pages, which is a fingerprint no real contact ever has.
  'savagex.com', 'aaa.com', 'gobble.com',
]));

/** Mailbox names that are never a person and never want a pitch. */
export const ROLE_NEVER = Object.freeze(new Set([
  'noreply', 'no-reply', 'donotreply', 'do-not-reply', 'postmaster', 'abuse', 'mailer-daemon',
  'bounce', 'bounces', 'unsubscribe', 'privacy', 'dmca', 'legal', 'security', 'spam', 'root',
  'webmaster', 'hostmaster', 'devnull',
]));

export const emailDomain = (e) => low(e).split('@')[1] || '';
export const emailUser = (e) => low(e).split('@')[0] || '';

/** The registrable-ish host of a URL, minus `www.`. Not a PSL — enough to compare two of our own rows. */
export function siteHost(url) {
  const s = str(url);
  if (!s) return '';
  try {
    const u = new URL(/^https?:\/\//i.test(s) ? s : `http://${s}`);
    return low(u.hostname).replace(/^www\./, '');
  } catch { return ''; }
}

/** Same site, or a subdomain of it. `mail.braaiboy.co.za` belongs to `braaiboy.co.za`. */
export function sameSite(a, b) {
  const x = siteHost(a); const y = siteHost(b);
  if (!x || !y) return false;
  return x === y || x.endsWith(`.${y}`) || y.endsWith(`.${x}`);
}

/**
 * Pages whose whole job is listing somebody's links — and which therefore carry a lot of content that
 * is NOT theirs. This distinction cost us a real number: reading 178 Linktrees produced "111 emails",
 * of which 333 of 358 rows were three addresses repeated once per page (`only@savagex.com`,
 * `online@www.aaa.com`, `only@www.gobble.com` — Linktree's own advertising boilerplate). The real
 * yield was 21.
 *
 * The bug was mine and it was in the caller: it told attribution() that the site WAS `linktr.ee`, so
 * every address on the page matched `sameSite` and came back `published-on-site`. On a hub page the
 * page's own domain is the platform's, never the person's, so that promotion must not happen.
 */
export const HUB_DOMAINS = Object.freeze(new Set([
  'linktr.ee', 'allmylinks.com', 'beacons.ai', 'bio.link', 'carrd.co', 'campsite.bio', 'linkin.bio',
  'lnk.bio', 'solo.to', 'taplink.cc', 'flowcode.com', 'about.me', 'koji.to', 'many.link',
]));

export const isHub = (url) => HUB_DOMAINS.has(siteHost(url));

/**
 * A page ON a platform, at the platform's own front door — `peakd.com/@x`, `read.cash/@x`,
 * `medium.com/@x`, `hive.blog/@x`. The hub fix in #929 covered `linktr.ee` and thirteen siblings; it
 * did not cover these, and they are the larger set: 510 rows of the holder file list a Hive front-end
 * as the holder's "website" (peakd.com 217, hive.blog 122, ecency.com 66, steemit.com 31,
 * read.cash 18). Crawling those with the site claim intact reproduces the exact bug this module was
 * written against — every address on a peakd profile page reads as `published-on-site`, and
 * `contact@read.cash` reads as `own-domain`, because the own-domain test ran before the platform test.
 *
 * A personal subdomain of a host is still the person's: `myblog.wordpress.com` is his page even
 * though `wordpress.com` is not. So the strip is on the APEX only, and the email-domain check below
 * is what stops `x@wordpress.com`.
 */
export const isPlatformApex = (url) => {
  const h = siteHost(url);
  return !!h && (PLATFORM_DOMAINS.has(h) || HUB_DOMAINS.has(h));
};

/** A page that cannot vouch for anybody: a hub, or a platform's own apex. */
export const confersNothing = (url) => isHub(url) || isPlatformApex(url);

/**
 * Is this address plausibly THIS holder's?
 *
 * Four verdicts, and only the first two are contactable:
 *   own-domain          the address is at the holder's own site. The strongest signal there is.
 *   published-on-site   a freemail address printed on a page of his own site. He put it there to be
 *                       written to — that is consent-adjacent, and it is the ordinary case for a
 *                       personal blog.
 *   third-party         the domain is somebody else's. This is the read.cash/amzn.to bug, and it is
 *                       the one that mails a support desk eighteen times.
 *   never               role account, or malformed.
 */
export function attribution(email, { site = '', foundOn = '' } = {}) {
  // A hub page, or a platform's own apex, is not anybody's own site. Strip the claim before the
  // checks below can honour it.
  if (confersNothing(site)) site = '';
  if (confersNothing(foundOn)) foundOn = '';
  const e = low(email);
  if (!isValidEmail(e)) return { ok: false, verdict: 'never', why: 'not a valid address' };
  const dom = emailDomain(e);
  if (ROLE_NEVER.has(emailUser(e))) {
    return { ok: false, verdict: 'never', why: `${emailUser(e)}@ is a role mailbox, not a person` };
  }
  // BEFORE own-domain, not after. A holder whose declared site is `read.cash/@x` used to promote
  // `contact@read.cash` to own-domain, because sameSite() saw a match and answered first. No address
  // at a platform's own domain is ever a holder's, so nothing downstream may overrule this.
  if (PLATFORM_DOMAINS.has(dom)) {
    return {
      ok: false, verdict: 'third-party',
      why: `${dom} is a platform's own address, not this holder's — mailing it pitches a support desk `
         + 'once per holder who linked there',
    };
  }
  if (site && sameSite(dom, site)) {
    return { ok: true, verdict: 'own-domain', why: `${dom} is the holder's own domain` };
  }
  if (FREEMAIL.has(dom)) {
    if (foundOn && site && sameSite(foundOn, site)) {
      return { ok: true, verdict: 'published-on-site', why: `published on ${siteHost(foundOn)}, his own site` };
    }
    return {
      ok: false, verdict: 'third-party',
      why: 'a freemail address found somewhere other than his own site belongs to nobody we can name',
    };
  }
  if (foundOn && site && sameSite(foundOn, site)) {
    return { ok: true, verdict: 'published-on-site', why: `published on ${siteHost(foundOn)}, his own site` };
  }
  return {
    ok: false, verdict: 'third-party',
    why: `${dom} is neither his domain nor published on his site — it was just nearby`,
  };
}

// ── reading a page ────────────────────────────────────────────────────────────────────────────────

// Deliberately conservative. A greedy pattern picks up filenames, version strings and image sprites,
// and every false address is a bounce, and bounces are what burn a sending domain.
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,24}/g;

// `sprite@2x.png` matches the pattern above and is a filename. So does `bundle@1.0.0.min.js`. A page
// of asset URLs would otherwise produce a page of addresses, every one of them a bounce.
const FILE_TLDS = Object.freeze(new Set([
  'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'avif', 'ico', 'bmp', 'css', 'js', 'mjs', 'json', 'html',
  'htm', 'php', 'asp', 'aspx', 'xml', 'txt', 'pdf', 'zip', 'gz', 'mp3', 'mp4', 'webm', 'mov', 'woff',
  'woff2', 'ttf', 'otf', 'eot', 'map', 'min', 'webmanifest', 'yml', 'yaml', 'md', 'csv',
]));
const looksLikeFile = (e) => FILE_TLDS.has(String(e).split('.').pop().toLowerCase());

/** Addresses in a page: mailto: links first, then body text. Order is the confidence order. */
export function extractEmails(html = '') {
  const s = String(html || '');
  const out = [];
  const seen = new Set();
  const push = (raw, how) => {
    const e = low(raw).replace(/[.,;:)\]}>'"]+$/, '');
    if (!isValidEmail(e) || looksLikeFile(e) || seen.has(e)) return;
    seen.add(e); out.push({ email: e, how });
  };
  for (const m of s.matchAll(/mailto:([^"'?>\s]+)/gi)) push(decodeURIComponent(m[1]), 'mailto');
  // A very common obfuscation, and cheap to undo. Anything cleverer than this is left alone rather
  // than guessed at — a wrong guess is a bounce.
  const deob = s.replace(/\s*\(?\s*(?:@|\[at\]|\(at\)|\s+at\s+)\s*\)?\s*/gi, (m) => (/@/.test(m) ? '@' : '@'))
    .replace(/\s*\(?\s*(?:\[dot\]|\(dot\)|\s+dot\s+)\s*\)?\s*/gi, '.');
  for (const m of deob.match(EMAIL_RE) || []) push(m, 'text');
  return out;
}

// ── social handles ────────────────────────────────────────────────────────────────────────────────
// The holder file has 10,755 rows with columns for tiktok, discord and linktree, and ZERO of them
// filled. Not because these people have no TikTok — because nothing ever looked. The pages the email
// crawl is already fetching carry these links in their footers, so this is the same request, read
// twice.
//
// Handles are cheaper than emails and often better: a Linktree or an open Discord is a route the
// person PUBLISHED to be found through, which is a stronger consent signal than an address scraped
// off a contact page.

const HANDLE_RE = '[A-Za-z0-9._-]{2,30}';
export const SOCIAL_PATTERNS = Object.freeze([
  { net: 'tiktok', re: new RegExp(`tiktok\\.com/@(${HANDLE_RE})`, 'gi') },
  { net: 'instagram', re: new RegExp(`instagram\\.com/(${HANDLE_RE})`, 'gi') },
  { net: 'x', re: new RegExp(`(?:twitter|x)\\.com/(${HANDLE_RE})`, 'gi') },
  { net: 'youtube', re: new RegExp(`youtube\\.com/(?:@|c/|channel/|user/)(${HANDLE_RE})`, 'gi') },
  { net: 'telegram', re: new RegExp(`(?:t\\.me|telegram\\.me)/(${HANDLE_RE})`, 'gi') },
  { net: 'discord', re: new RegExp(`discord\\.(?:gg|com/invite)/(${HANDLE_RE})`, 'gi') },
  { net: 'linktree', re: new RegExp(`linktr\\.ee/(${HANDLE_RE})`, 'gi') },
  { net: 'mastodon', re: new RegExp(`([a-z0-9.-]+)/@(${HANDLE_RE})@`, 'gi') },
  { net: 'facebook', re: new RegExp(`facebook\\.com/(${HANDLE_RE})`, 'gi') },
]);

// A share button is not a handle. Every one of these appears as a path segment on links that point at
// the platform's own plumbing rather than at a person, and picking them up would fill the column with
// nonsense that looks like data.
export const NOT_A_HANDLE = Object.freeze(new Set([
  'share', 'sharer', 'intent', 'home', 'login', 'signup', 'about', 'privacy', 'terms', 'help',
  'explore', 'search', 'hashtag', 'tags', 'embed', 'widgets', 'plugins', 'tr', 'p', 'watch', 'reel',
  'story', 'stories', 'posts', 'profile', 'pages', 'groups', 'events', 'legal', 'download', 'business',
  'creators', 'developers', 'press', 'jobs', 'careers', 'contact', 'blog', 'www', 'com', 'net',
]));

/** Social handles in a page, deduped per network, junk paths dropped. */
export function extractSocials(html = '') {
  const s = String(html || '');
  const out = {};
  for (const { net, re } of SOCIAL_PATTERNS) {
    re.lastIndex = 0;
    for (const m of s.matchAll(re)) {
      const h = str(m[net === 'mastodon' ? 2 : 1]);
      if (!h || NOT_A_HANDLE.has(low(h))) continue;
      if (!out[net]) out[net] = [];
      if (!out[net].includes(h)) out[net].push(h);
    }
  }
  return out;
}

/**
 * Handles a Graphene account published about itself. `json_metadata.profile` is where a Hive/Steem/
 * Blurt user writes their own website and socials — self-declared, public, and the least invasive
 * source there is: they typed it into their own profile.
 */
export function socialsFromProfile(jsonMetadata = '') {
  let meta = jsonMetadata;
  if (typeof meta === 'string') { try { meta = JSON.parse(meta || '{}'); } catch { return {}; } }
  const prof = (meta && meta.profile) || {};
  const out = {};
  const put = (net, v) => { const h = str(v).replace(/^@/, ''); if (h && !NOT_A_HANDLE.has(low(h))) out[net] = [h]; };
  put('tiktok', prof.tiktok);
  put('instagram', prof.instagram || prof.ig);
  put('x', prof.twitter || prof.x);
  put('youtube', prof.youtube);
  put('telegram', prof.telegram);
  put('discord', prof.discord);
  // A website in the profile is also where the rest of the handles usually live — hand it to harvest().
  const site = str(prof.website);
  // Free-text fields carry links too, and an "about" is written to be read.
  const blob = [prof.about, prof.location, prof.website].map(str).join(' ');
  const found = extractSocials(blob);
  for (const [net, hs] of Object.entries(found)) {
    if (!out[net]) out[net] = hs;
  }
  return site ? { ...out, website: [site] } : out;
}

/** The pages worth asking for. Ordered: a contact page beats a homepage beats an about page. */
export function contactPaths(site) {
  const host = siteHost(site);
  if (!host) return [];
  const base = `https://${host}`;
  return ['/contact', '/contact-us', '/', '/about', '/about-us', '/impressum'].map((p) => base + p);
}

const DEFAULT_TIMEOUT_MS = 8000;

/**
 * Crawl one holder's site for an address that is actually his.
 *
 * Soft-fails on everything — a dead site, a timeout, a 403, bad HTML. 4,047 sites means thousands of
 * these will fail and a crawl that throws on the first one crawls nothing.
 */
export async function harvest(site, { maxPages = 3, timeoutMs = DEFAULT_TIMEOUT_MS, throttle = null, fetch = null } = {}) {
  const host = siteHost(site);
  const result = { site: host, pages: 0, found: [], rejected: [], socials: {}, errors: [] };
  if (!host) { result.errors.push('no usable hostname'); return result; }
  const f = fetch || _fetch;
  const urls = contactPaths(site).slice(0, Math.max(1, maxPages));
  for (const url of urls) {
    if (throttle) { try { await throttle(host); } catch { /* a throttle is a courtesy, not a gate */ } }
    let html = '';
    try {
      const ctl = typeof AbortController === 'function' ? new AbortController() : null;
      const timer = ctl ? setTimeout(() => ctl.abort(), timeoutMs) : null;
      try {
        const res = await f(url, { redirect: 'follow', signal: ctl ? ctl.signal : undefined });
        if (!res || !res.ok) { result.errors.push(`${url}: ${res ? res.status : 'no response'}`); continue; }
        // The timeout has to cover the BODY too. Clearing it after the headers arrive and before
        // res.text() leaves a stalled body read with no timeout at all, and a crawl of 1,204 sites
        // finds a server that sends headers and then stops. That is exactly how the first run hung:
        // 300 hosts in, alive, and silent for half an hour.
        html = await res.text();
        result.pages += 1;
      } finally {
        if (timer) clearTimeout(timer);
      }
    } catch (e) { result.errors.push(`${url}: ${str(e && e.message) || 'fetch failed'}`); continue; }
    const socials = extractSocials(html);
    for (const [net, hs] of Object.entries(socials)) {
      result.socials[net] = [...new Set([...(result.socials[net] || []), ...hs])];
    }
    for (const { email, how } of extractEmails(html)) {
      const a = attribution(email, { site: host, foundOn: url });
      const row = { email, foundOn: url, how, verdict: a.verdict, why: a.why };
      if (a.ok) {
        if (!result.found.some((r) => r.email === email)) result.found.push(row);
      } else if (!result.rejected.some((r) => r.email === email)) result.rejected.push(row);
    }
    if (result.found.length) break;   // a contact page that answered is enough; stop asking
  }
  return result;
}

/**
 * Grade a list we already have. This is the first thing to run, before any crawl expands it: the 325
 * addresses in hand were collected without `attribution()` and some of them are support desks.
 */
export function auditList(rows = []) {
  const keep = []; const drop = [];
  for (const r of rows) {
    const email = str(r.email || r.address);
    if (!email) continue;
    const a = attribution(email, { site: str(r.website || r.site), foundOn: str(r.email_found_on || r.foundOn) });
    const out = { account: str(r.hive_account || r.account || r.hive), email, verdict: a.verdict, why: a.why };
    (a.ok ? keep : drop).push(out);
  }
  // The same address under many DIFFERENT accounts is the platform-desk shape, whatever its domain:
  // one inbox that would receive the same pitch once per holder who linked to it.
  //
  // Counting rows instead of accounts was wrong and the real file proved it — a holder listed twice
  // is a duplicate row, not a shared mailbox, and discarding him loses a good contact to a bookkeeping
  // artefact. So the count is of distinct accounts, and a repeated row collapses to one.
  const accounts = new Map();
  for (const k of keep) {
    if (!accounts.has(k.email)) accounts.set(k.email, new Set());
    accounts.get(k.email).add(k.account);
  }
  const nAccounts = (e) => accounts.get(e).size;
  const seenEmail = new Set();
  const unique = keep.filter((k) => {
    if (nAccounts(k.email) > 1 || seenEmail.has(k.email)) return false;
    seenEmail.add(k.email); return true;
  });
  const shared = keep.filter((k) => nAccounts(k.email) > 1);
  return {
    total: rows.length,
    keep: unique,
    drop,
    shared: shared.map((s) => ({ ...s, why: `this address is listed for ${nAccounts(s.email)} different holders — it belongs to a service, not to any of them` })),
  };
}

/** What a full run would cost, at the throttle. Reported so nobody starts it blind. */
export function crawlPlan(sites = [], { minIntervalMs = 1500, concurrency = 4, maxPages = 3 } = {}) {
  const hosts = [...new Set(sites.map(siteHost).filter(Boolean))];
  const requests = hosts.length * maxPages;
  const seconds = Math.round((hosts.length * minIntervalMs) / 1000 / Math.max(1, concurrency));
  return { sites: hosts.length, worstCaseRequests: requests, estimatedSeconds: seconds, concurrency, minIntervalMs };
}

export function handler(req, res) {
  res.statusCode = 200;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify({
    ok: true, service: 'holder-contact-harvest',
    verdicts: ['own-domain', 'published-on-site', 'third-party', 'never'],
    platformDomains: PLATFORM_DOMAINS.size, freemail: FREEMAIL.size, roleNever: ROLE_NEVER.size,
    note: 'reads public pages and grades addresses. Sending stays behind the Herald gate.',
  }, null, 2));
}

export default {
  attribution, extractEmails, extractSocials, socialsFromProfile, contactPaths, harvest, auditList,
  crawlPlan, siteHost, sameSite, isHub, isPlatformApex, confersNothing,
};

if (process.argv[1] && process.argv[1].endsWith('holder-contact-harvest.mjs')) {
  const site = process.argv[2];
  if (!site) { console.log('usage: node integrations/holder-contact-harvest.mjs <site>'); process.exit(0); }
  const t = makeThrottle({ minIntervalMs: 1500 });
  harvest(site, { throttle: (h) => t.wait(h) }).then((r) => console.log(JSON.stringify(r, null, 1)));
}
