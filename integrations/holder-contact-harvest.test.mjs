// holder-contact-harvest.test.mjs — OFFLINE. Every fetch is injected; nothing here touches a network.
import { test } from 'node:test';
import assert from 'node:assert';
import {
  attribution, extractEmails, contactPaths, harvest, auditList, crawlPlan,
  siteHost, sameSite, __setFetch, handler, extractSocials, socialsFromProfile, NOT_A_HANDLE,
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
