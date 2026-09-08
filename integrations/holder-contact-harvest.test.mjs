// holder-contact-harvest.test.mjs — OFFLINE. Every fetch is injected; nothing here touches a network.
import { test } from 'node:test';
import assert from 'node:assert';
import {
  attribution, extractEmails, contactPaths, harvest, auditList, crawlPlan,
  siteHost, sameSite, __setFetch, handler, extractSocials, socialsFromProfile, NOT_A_HANDLE,
  isHub, HUB_DOMAINS, isPlatformApex, confersNothing, crossPageBoilerplate, isUsableHandle,
  platformEmailDomain, MAX_SCAN_BYTES,
} from './holder-contact-harvest.mjs';

test('siteHost normalises what the CSV actually holds', () => {
  assert.equal(siteHost('http://BraaiBoy.co.za'), 'braaiboy.co.za');
  assert.equal(siteHost('https://www.hive.io/'), 'hive.io');
  assert.equal(siteHost('braaiboy.co.za'), 'braaiboy.co.za');
  assert.equal(siteHost(''), '');
  assert.equal(siteHost('not a url at all'), '');
});

test('a subdomain still belongs to the site', () => {
  assert.equal(sameSite('mail.braaiboy.co.za', 'braaiboy.co.za'), true);
  assert.equal(sameSite('braaiboy.co.za', 'braaiboy.co.za'), true);
  assert.equal(sameSite('gmail.com', 'braaiboy.co.za'), false);
});

// ── the bug this module exists for ────────────────────────────────────────────────────────────────
test('an address on the holder\'s own domain is his', () => {
  const a = attribution('bb@braaiboy.co.za', { site: 'http://BraaiBoy.co.za' });
  assert.equal(a.ok, true);
  assert.equal(a.verdict, 'own-domain');
});

test('read.cash/contact is a support desk, not eighteen holders', () => {
  const a = attribution('support@read.cash', { site: 'https://someholder.example', foundOn: 'https://read.cash/contact' });
  assert.equal(a.ok, false);
  assert.equal(a.verdict, 'third-party');
  assert.match(a.why, /support desk/);
});

test('an amazon affiliate address in a post footer is not a contact', () => {
  for (const e of ['x@amazon.com', 'y@amzn.to']) {
    assert.equal(attribution(e, { site: 'https://holder.example' }).ok, false, e);
  }
});

test('a gmail address printed on his own site IS his; the same address found elsewhere is not', () => {
  const own = attribution('someguy@gmail.com', { site: 'holder.example', foundOn: 'https://holder.example/contact' });
  assert.equal(own.ok, true);
  assert.equal(own.verdict, 'published-on-site');
  const stray = attribution('someguy@gmail.com', { site: 'holder.example', foundOn: 'https://read.cash/@someone' });
  assert.equal(stray.ok, false);
});

test('role mailboxes are never contacted', () => {
  for (const u of ['noreply', 'postmaster', 'abuse', 'dmca']) {
    const a = attribution(`${u}@holder.example`, { site: 'holder.example' });
    assert.equal(a.ok, false, u);
    assert.equal(a.verdict, 'never');
  }
});

test('a malformed address is refused before anything else looks at it', () => {
  assert.equal(attribution('not-an-email', { site: 'x.example' }).verdict, 'never');
});

// ── reading a page ────────────────────────────────────────────────────────────────────────────────
test('mailto links come first, then body text, and duplicates collapse', () => {
  const html = '<a href="mailto:me@holder.example">write</a> or me@holder.example or two@holder.example';
  const got = extractEmails(html);
  assert.deepEqual(got.map((g) => g.email), ['me@holder.example', 'two@holder.example']);
  assert.equal(got[0].how, 'mailto');
});

test('trailing punctuation is not part of the address', () => {
  assert.deepEqual(extractEmails('write to me@holder.example.').map((e) => e.email), ['me@holder.example']);
});

test('the common "at/dot" obfuscation is undone, and nothing cleverer is guessed at', () => {
  assert.deepEqual(extractEmails('me [at] holder [dot] example').map((e) => e.email), ['me@holder.example']);
  assert.deepEqual(extractEmails('reverse this: elpmaxe.redloh@em'), []);
});

test('a page with no addresses yields none rather than junk', () => {
  assert.deepEqual(extractEmails('<img src="sprite@2x.png"> v1.2.3'), [], 'a filename is not an address');
  assert.deepEqual(extractEmails('<script src="bundle@1.0.min.js"></script>'), []);
  assert.deepEqual(extractEmails('logo@2x.webp icon@3x.svg style@media.css'), []);
  assert.deepEqual(extractEmails(''), []);
});

test('contactPaths asks the contact page before the homepage', () => {
  const p = contactPaths('http://BraaiBoy.co.za');
  assert.equal(p[0], 'https://braaiboy.co.za/contact');
  assert.ok(p.includes('https://braaiboy.co.za/'));
  assert.deepEqual(contactPaths(''), []);
});

// ── the crawl ─────────────────────────────────────────────────────────────────────────────────────
const ok = (body) => ({ ok: true, status: 200, text: async () => body });

test('harvest finds the address and stops asking once it has one', async () => {
  const seen = [];
  __setFetch(async (url) => { seen.push(url); return ok('<a href="mailto:bb@braaiboy.co.za">mail</a>'); });
  const r = await harvest('http://BraaiBoy.co.za');
  assert.equal(seen.length, 1, 'a contact page that answered is enough');
  assert.deepEqual(r.found.map((f) => f.email), ['bb@braaiboy.co.za']);
  assert.equal(r.found[0].verdict, 'own-domain');
  __setFetch(null);
});

test('harvest separates what it rejected, with the reason', async () => {
  __setFetch(async () => ok('contact us at support@read.cash'));
  const r = await harvest('https://holder.example', { maxPages: 1 });
  assert.equal(r.found.length, 0);
  assert.equal(r.rejected.length, 1);
  assert.match(r.rejected[0].why, /support desk|not this holder/);
  __setFetch(null);
});

test('a dead site is an empty result, never a throw — 4,047 sites means thousands of these', async () => {
  __setFetch(async () => { throw new Error('ECONNREFUSED'); });
  const r = await harvest('https://gone.example');
  assert.deepEqual(r.found, []);
  assert.ok(r.errors.length);
  __setFetch(null);
});

test('a 403 or a 404 is recorded and the next page is still tried', async () => {
  let n = 0;
  __setFetch(async () => { n += 1; return n === 1 ? { ok: false, status: 403 } : ok('mailto:me@holder.example'); });
  const r = await harvest('https://holder.example');
  assert.equal(r.found.length, 1);
  assert.ok(r.errors.some((e) => /403/.test(e)));
  __setFetch(null);
});

test('an unusable hostname does not fetch at all', async () => {
  let called = false;
  __setFetch(async () => { called = true; return ok(''); });
  const r = await harvest('');
  assert.equal(called, false);
  assert.ok(r.errors.length);
  __setFetch(null);
});

test('the throttle is a courtesy, not a gate — a throwing throttle does not stop the crawl', async () => {
  __setFetch(async () => ok('mailto:me@holder.example'));
  const r = await harvest('https://holder.example', { throttle: async () => { throw new Error('nope'); } });
  assert.equal(r.found.length, 1);
  __setFetch(null);
});

// ── grading a list we already have ────────────────────────────────────────────────────────────────
test('auditList keeps what is the holder\'s and drops what is not', () => {
  const a = auditList([
    { hive_account: 'braaiboy', email: 'bb@braaiboy.co.za', website: 'http://BraaiBoy.co.za' },
    { hive_account: 'someone', email: 'support@read.cash', website: 'https://someone.example', email_found_on: 'https://read.cash/contact' },
    { hive_account: 'nobody', email: '', website: 'https://x.example' },
  ]);
  assert.deepEqual(a.keep.map((k) => k.account), ['braaiboy']);
  assert.deepEqual(a.drop.map((k) => k.account), ['someone']);
  assert.equal(a.total, 3);
});

test('one address listed for many holders belongs to a service, whatever its domain', () => {
  const rows = ['a', 'b', 'c'].map((n) => ({ hive_account: n, email: 'hello@sharedhost.example', website: 'https://sharedhost.example' }));
  const a = auditList(rows);
  assert.equal(a.keep.length, 0, 'none of them get mailed');
  assert.equal(a.shared.length, 3);
  assert.match(a.shared[0].why, /3 different holders/);
});

test('the SAME holder listed twice is a duplicate row, not a shared mailbox', () => {
  const a = auditList([
    { hive_account: 'braaiboy', email: 'bb@braaiboy.co.za', website: 'http://BraaiBoy.co.za' },
    { hive_account: 'braaiboy', email: 'bb@braaiboy.co.za', website: 'http://braaiboy.co.za' },
  ]);
  assert.equal(a.shared.length, 0, 'one man twice is not two men');
  assert.deepEqual(a.keep.map((k) => k.account), ['braaiboy'], 'and he is kept exactly once');
});

test('crawlPlan says what a full run costs before anyone starts it', () => {
  const p = crawlPlan(['https://a.example', 'https://www.a.example', 'https://b.example']);
  assert.equal(p.sites, 2, 'www and apex are one site');
  assert.ok(p.estimatedSeconds > 0);
});

test('handler answers without touching a network', () => {
  let body = '';
  handler({}, { setHeader() {}, end(b) { body = b; } });
  const j = JSON.parse(body);
  assert.equal(j.ok, true);
  assert.ok(j.verdicts.includes('own-domain'));
});


// ── social handles ────────────────────────────────────────────────────────────────────────────────
test('handles come off a page footer, deduped per network', () => {
  const html = `
    <a href="https://tiktok.com/@realperson">tt</a>
    <a href="https://www.tiktok.com/@realperson">tt again</a>
    <a href="https://instagram.com/holderig">ig</a>
    <a href="https://linktr.ee/someone">links</a>
    <a href="https://discord.gg/abc123">chat</a>
    <a href="https://t.me/holdertg">tg</a>`;
  const got = extractSocials(html);
  assert.deepEqual(got.tiktok, ['realperson'], 'the same handle twice is one handle');
  assert.deepEqual(got.instagram, ['holderig']);
  assert.deepEqual(got.linktree, ['someone']);
  assert.deepEqual(got.discord, ['abc123']);
  assert.deepEqual(got.telegram, ['holdertg']);
});

test('a share button is not a handle — this is what would fill the column with nonsense', () => {
  const html = `
    <a href="https://www.facebook.com/sharer/sharer.php?u=x">share</a>
    <a href="https://twitter.com/intent/tweet?text=y">tweet</a>
    <a href="https://www.instagram.com/explore/tags/dallas">tag</a>`;
  const got = extractSocials(html);
  assert.ok(!(got.facebook || []).includes('sharer'));
  assert.ok(!(got.x || []).includes('intent'));
  assert.ok(!(got.instagram || []).includes('explore'));
});

test('a page with no socials yields an empty object, not junk', () => {
  assert.deepEqual(extractSocials('<p>nothing here</p>'), {});
  assert.deepEqual(extractSocials(''), {});
});

test('NOT_A_HANDLE covers the plumbing paths that look like usernames', () => {
  for (const p of ['share', 'intent', 'explore', 'hashtag', 'watch', 'profile']) {
    assert.ok(NOT_A_HANDLE.has(p), p);
  }
});

test('a Graphene profile is the least invasive source — they typed it themselves', () => {
  const meta = JSON.stringify({ profile: {
    tiktok: '@holder', twitter: 'holderx', website: 'https://holder.example',
    about: 'also at instagram.com/holderig',
  } });
  const got = socialsFromProfile(meta);
  assert.deepEqual(got.tiktok, ['holder'], 'a leading @ is stripped');
  assert.deepEqual(got.x, ['holderx']);
  assert.deepEqual(got.instagram, ['holderig'], 'links in free text count too');
  assert.deepEqual(got.website, ['https://holder.example']);
});

test('socialsFromProfile takes an object as happily as a string, and never throws on garbage', () => {
  assert.deepEqual(socialsFromProfile({ profile: { tiktok: 'x1' } }).tiktok, ['x1']);
  assert.deepEqual(socialsFromProfile('not json'), {});
  assert.deepEqual(socialsFromProfile(''), {});
  assert.deepEqual(socialsFromProfile(JSON.stringify({})), {});
});

test('harvest collects handles alongside addresses, from the pages it already fetches', async () => {
  __setFetch(async () => ({ ok: true, status: 200, text: async () =>
    '<a href="mailto:me@holder.example">m</a><a href="https://tiktok.com/@holdertt">t</a>' }));
  const r = await harvest('https://holder.example');
  assert.deepEqual(r.found.map((f) => f.email), ['me@holder.example']);
  assert.deepEqual(r.socials.tiktok, ['holdertt']);
  __setFetch(null);
});

test('a page with handles but no address still returns the handles', async () => {
  __setFetch(async () => ({ ok: true, status: 200, text: async () =>
    '<a href="https://linktr.ee/holder">links</a>' }));
  const r = await harvest('https://holder.example', { maxPages: 1 });
  assert.equal(r.found.length, 0);
  assert.deepEqual(r.socials.linktree, ['holder']);
  __setFetch(null);
});


test('the timeout covers the response BODY, not just the headers', async () => {
  // A server that sends headers and then stops. Before the fix this hung forever: the timer was
  // cleared once the headers arrived, so res.text() had no timeout at all.
  __setFetch(async (url, opts) => ({
    ok: true,
    status: 200,
    text: () => new Promise((resolve, reject) => {
      if (opts && opts.signal) {
        opts.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      }
      // never resolves on its own
    }),
  }));
  const started = Date.now();
  const r = await harvest('https://stalls.example', { maxPages: 1, timeoutMs: 60 });
  assert.ok(Date.now() - started < 3000, 'gave up instead of hanging');
  assert.deepEqual(r.found, []);
  assert.ok(r.errors.length, 'the stall is recorded as an error');
  __setFetch(null);
});


// ── a hub page is nobody's own site ───────────────────────────────────────────────────────────────
test('an address on a Linktree is NOT published-on-site just because it is on linktr.ee', () => {
  const a = attribution('only@savagex.com', { site: 'linktr.ee', foundOn: 'https://linktr.ee/someone' });
  assert.equal(a.ok, false, 'this is the bug that produced 111 fake emails from 178 pages');
  assert.equal(a.verdict, 'third-party');
});

test('the three ad addresses that appeared on every Linktree are refused by name', () => {
  for (const e of ['only@savagex.com', 'online@www.aaa.com', 'only@www.gobble.com']) {
    assert.equal(attribution(e, { site: 'holder.example' }).ok, false, e);
  }
});

test('a real address on a hub page is still not promoted — but it is not silently lost either', () => {
  const a = attribution('someone@theirowndomain.example', { site: 'linktr.ee', foundOn: 'https://linktr.ee/someone' });
  assert.equal(a.verdict, 'third-party', 'a hub tells us nothing about ownership; something else must');
});

test('isHub knows the link-in-bio platforms', () => {
  assert.equal(isHub('https://linktr.ee/x'), true);
  assert.equal(isHub('beacons.ai'), true);
  assert.equal(isHub('https://holder.example'), false);
  assert.ok(HUB_DOMAINS.size > 5);
});

test('the hub rule does not touch an ordinary site', () => {
  const a = attribution('bb@braaiboy.co.za', { site: 'http://BraaiBoy.co.za' });
  assert.equal(a.verdict, 'own-domain');
});

// ── the third bug: a platform page is not his site either ─────────────────────────────────────────
// The hub fix (#929) stripped the site claim for linktr.ee and its thirteen siblings. It left the
// larger set untouched: 510 rows of the holder file give a Hive front-end as the holder's website
// (peakd.com 217, hive.blog 122, ecency.com 66, steemit.com 31, read.cash 18). Every one of those
// would have crawled with the claim intact.
test('a holder whose "website" is a platform profile page cannot vouch for anything on it', () => {
  for (const site of ['https://peakd.com/@holder', 'https://hive.blog/@holder', 'https://read.cash/@holder',
    'https://ecency.com/@holder', 'https://steemit.com/@holder', 'https://medium.com/@holder']) {
    const a = attribution('astranger@gmail.com', { site, foundOn: site });
    assert.equal(a.ok, false, site);
    assert.equal(a.verdict, 'third-party', site);
  }
});

test('the platform test runs BEFORE the own-domain test — this is the read.cash bug in its original form', () => {
  const a = attribution('contact@read.cash', { site: 'https://read.cash/@holder', foundOn: 'https://read.cash/@holder' });
  assert.equal(a.ok, false);
  assert.equal(a.verdict, 'third-party');
  assert.match(a.why, /support desk/);
});

test('the same shape at every other platform apex', () => {
  for (const [e, site] of [
    ['support@medium.com', 'https://medium.com/@holder'],
    ['x@wordpress.com', 'https://bar.wordpress.com'],
    ['y@github.com', 'https://github.com/dude'],
    ['a@substack.com', 'https://foo.substack.com'],
    ['b@hive.io', 'https://hive.io'],
  ]) {
    assert.equal(attribution(e, { site, foundOn: site }).ok, false, e);
  }
});

test('a personal subdomain of a host is still his page', () => {
  // wordpress.com is a platform; myblog.wordpress.com is a person's blog. Only the apex is stripped.
  assert.equal(isPlatformApex('https://wordpress.com'), true);
  assert.equal(isPlatformApex('https://myblog.wordpress.com'), false);
  const a = attribution('him@gmail.com', { site: 'https://myblog.wordpress.com', foundOn: 'https://myblog.wordpress.com/about' });
  assert.equal(a.ok, true);
  assert.equal(a.verdict, 'published-on-site');
});

test('confersNothing covers hubs and platform apexes and nothing else', () => {
  assert.equal(confersNothing('https://linktr.ee/x'), true);
  assert.equal(confersNothing('https://peakd.com/@x'), true);
  assert.equal(confersNothing('http://BraaiBoy.co.za'), false);
  assert.equal(confersNothing(''), false);
});

test('a real personal domain is untouched by any of this', () => {
  const a = attribution('bb@braaiboy.co.za', { site: 'http://BraaiBoy.co.za', foundOn: 'http://braaiboy.co.za/contact' });
  assert.equal(a.ok, true);
  assert.equal(a.verdict, 'own-domain');
});

// ── the fingerprint, generalised ──────────────────────────────────────────────────────────────────
test('a value on every page of a crawl is the crawl\'s furniture, not a contact', () => {
  const pages = [];
  for (let i = 0; i < 111; i += 1) {
    pages.push({ page: `https://linktr.ee/h${i}`, values: ['only@savagex.com', 'online@www.aaa.com', `real${i}@gmail.com`] });
  }
  const b = crossPageBoilerplate(pages);
  assert.equal(b.get('only@savagex.com'), 111);
  assert.equal(b.get('online@www.aaa.com'), 111);
  assert.equal(b.has('real0@gmail.com'), false);
  assert.equal(b.size, 2);
});

test('the same value twice on ONE page is not boilerplate', () => {
  const b = crossPageBoilerplate([{ page: 'p1', values: ['a@x.com', 'a@x.com', 'a@x.com'] }]);
  assert.equal(b.size, 0);
});

test('the threshold is distinct pages, and it is adjustable', () => {
  const pages = [{ page: 'p1', values: ['a@x.com'] }, { page: 'p2', values: ['a@x.com'] }, { page: 'p3', values: ['a@x.com'] }];
  assert.equal(crossPageBoilerplate(pages).get('a@x.com'), 3);
  assert.equal(crossPageBoilerplate(pages, { maxPages: 5 }).size, 0);
});

test('crossPageBoilerplate soft-fails on junk', () => {
  assert.equal(crossPageBoilerplate().size, 0);
  assert.equal(crossPageBoilerplate([{ page: 'p', values: null }]).size, 0);
});

// ── handles that are not handles ──────────────────────────────────────────────────────────────────
test('profile.php is not a person — 51 of 283 harvested Facebook handles were exactly this', () => {
  assert.equal(isUsableHandle('profile.php'), false);
  const got = extractSocials('<a href="https://facebook.com/profile.php?id=100001234">me</a>');
  assert.equal(got.facebook, undefined);
});

test('a build artefact is never a handle', () => {
  for (const h of ['script.js', 'style.css', 'consent-scripts', 'sticker', 'fonts', 'og', 'static']) {
    assert.equal(isUsableHandle(h), false, h);
  }
});

test('a segment with no letters in it is a tracking token', () => {
  assert.equal(isUsableHandle('123456789'), false);
  assert.equal(isUsableHandle('UCol8tc03sMzDSv4qCaExANQ'), true);   // a real YouTube channel id
  assert.equal(isUsableHandle('akipponn'), true);
});

// ── hub-published ─────────────────────────────────────────────────────────────────────────────────
test('a hub still confers nothing unless ownership is proven', () => {
  const a = attribution('him@gmail.com', { site: 'https://linktr.ee/akipponn', foundOn: 'https://linktr.ee/akipponn' });
  assert.equal(a.ok, false);
  assert.equal(a.verdict, 'third-party');
});

test('a hub page whose handle is his own vouches for what he put on it', () => {
  const a = attribution('him@gmail.com', { foundOn: 'https://linktr.ee/akipponn', hubOwnedBy: 'akipponn' });
  assert.equal(a.ok, true);
  assert.equal(a.verdict, 'hub-published');
  assert.match(a.why, /@akipponn/);
});

test('a hub page belonging to somebody else vouches for nothing', () => {
  const a = attribution('him@gmail.com', { foundOn: 'https://linktr.ee/coldplay', hubOwnedBy: 'akipponn' });
  assert.equal(a.ok, false);
});

test('ownership does not launder the advertising', () => {
  for (const e of ['only@savagex.com', 'online@www.aaa.com', 'only@www.gobble.com']) {
    const a = attribution(e, { foundOn: 'https://linktr.ee/akipponn', hubOwnedBy: 'akipponn' });
    assert.equal(a.ok, false, e);
    assert.equal(a.verdict, 'third-party', e);
  }
});

test('ownership does not launder a role mailbox or a malformed address', () => {
  assert.equal(attribution('noreply@x.co', { foundOn: 'https://linktr.ee/a', hubOwnedBy: 'a' }).verdict, 'never');
  assert.equal(attribution('not-an-address', { foundOn: 'https://linktr.ee/a', hubOwnedBy: 'a' }).verdict, 'never');
});

test('hubOwnedBy on a non-hub page changes nothing', () => {
  const a = attribution('bb@braaiboy.co.za', { site: 'http://BraaiBoy.co.za', hubOwnedBy: 'braaiboy' });
  assert.equal(a.verdict, 'own-domain');
});

test('a platform domain is a platform domain at any depth', () => {
  assert.equal(platformEmailDomain('www.aaa.com'), 'aaa.com');
  assert.equal(platformEmailDomain('www.gobble.com'), 'gobble.com');
  assert.equal(platformEmailDomain('mail.read.cash'), 'read.cash');
  assert.equal(platformEmailDomain('braaiboy.co.za'), '');
  assert.equal(platformEmailDomain(''), '');
  // and the main path agrees
  assert.equal(attribution('x@www.aaa.com', { site: 'holder.example' }).ok, false);
});

// ── the hang that stopped the crawl three times ───────────────────────────────────────────────────
test('a long whitespace run is linear, not catastrophic — 500 spaces used to take over a minute', () => {
  for (const n of [500, 5000, 50000]) {
    const t0 = Date.now();
    extractEmails(`<p>${' '.repeat(n)}</p>`);
    const ms = Date.now() - t0;
    assert.ok(ms < 500, `${n} spaces took ${ms}ms — the backtracking is back`);
  }
});

test('the whole extraction path stays fast on a whitespace-heavy page', () => {
  const page = `<html>${(' '.repeat(400) + '<div class="x">text</div>\n\t').repeat(400)}</html>`;
  const t0 = Date.now();
  extractEmails(page);
  extractSocials(page);
  assert.ok(Date.now() - t0 < 1000, 'a pretty-printed page must not stall the crawl');
});

test('the bracketed obfuscations are still undone — that is what the pattern is for', () => {
  assert.deepEqual(extractEmails('write to me [at] holder [dot] example').map((e) => e.email),
    ['me@holder.example']);
  assert.deepEqual(extractEmails('me (at) holder (dot) example').map((e) => e.email),
    ['me@holder.example']);
  assert.deepEqual(extractEmails('me {at} holder {dot} example').map((e) => e.email),
    ['me@holder.example']);
});

test('the bare spaced form is NOT undone, because it manufactures addresses out of prose', () => {
  // "look at the dot on the map" used to come back as look@the.on — a bounce that never existed.
  assert.deepEqual(extractEmails('look at the dot on the map'), []);
  assert.deepEqual(extractEmails('we are open at noon and closed at six'), []);
  assert.deepEqual(extractEmails('me at holder dot example'), [],
    'a real obfuscation we now miss — the deliberate cost of not inventing the other kind');
});

test('a page larger than the scan cap is truncated rather than scanned whole', () => {
  const padding = `<!--${'x'.repeat(MAX_SCAN_BYTES + 1000)}-->`;
  assert.deepEqual(extractEmails(`${padding}buried@holder.example`), [],
    'an address past the cap is not read — a megabyte of markup is a bundle, not a contact page');
  assert.deepEqual(extractEmails(`<p>early@holder.example</p>${padding}`).map((e) => e.email),
    ['early@holder.example'], 'and everything before the cap still is');
});
