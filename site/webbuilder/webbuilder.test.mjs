// webbuilder.test.mjs — OFFLINE tests for the SoapBox Web Builder (drives `handler` with a mock req/res;
// no port bound, no network). Verifies: the builder renders with templates + the editor; the publish flow
// works for a REN name AND a BYO custom domain (attach shows the DNS record + an HONEST pending status and
// NEVER fake-verifies); a published page is SEO-clean (JSON-LD, canonical, analytics beacon hook) and
// escapes hostile content / neutralizes javascript: URLs; the server does zero request-time network;
// BASE_PATH default is unchanged; unknown → 404; never throws.

import { test } from 'node:test';
import assert from 'node:assert';
import {
  handler, builderPage, renderPublished, sanitizeDoc, resolveRen, __setDomainVerify, __reset,
  esc, safeHref, TEMPLATE_KEYS, SITEMAP_PATHS, _published,
} from './server.mjs';

function mockRes() {
  return {
    code: null, headers: null, body: '',
    writeHead(code, headers) { this.code = code; this.headers = headers || {}; return this; },
    end(s) { this.body = s == null ? '' : String(s); return this; },
  };
}
async function req(method, path, body) {
  const res = mockRes();
  await handler({ method, url: path, headers: { host: 'build.test' }, body }, res);
  return res;
}
const get = (p) => req('GET', p);
const post = (p, b) => req('POST', p, b);

test('home 200 renders the builder (templates + editor + publish flow)', async () => {
  const res = await get('/');
  assert.equal(res.code, 200);
  assert.match(res.headers['content-type'], /text\/html/);
  assert.match(res.body, /Build your website/i);
  assert.match(res.body, /data-tpl="business"/);      // a template button
  assert.match(res.body, /id=sections/);              // the block editor
  assert.match(res.body, /id=f-ren/);                 // REN publish input
  assert.match(res.body, /bring your own domain/i);   // BYO domain flow
  assert.match(res.body, /Alpha/);                    // alpha badge convention
});

test('all four templates have picker buttons', async () => {
  const body = (await get('/')).body;
  for (const k of TEMPLATE_KEYS) assert.ok(body.includes(`data-tpl="${k}"`), `missing template ${k}`);
  assert.equal(TEMPLATE_KEYS.length, 4);
  assert.deepEqual(TEMPLATE_KEYS.sort(), ['business', 'linkbio', 'personal', 'portfolio']);
});

test('PUBLISH to a REN name creates a servable, SEO-clean page', async () => {
  __reset();
  const r = await post('/api/publish', { ren: 'mysite', template: 'business', doc: { title: 'My Site', tagline: 'Hello world', category: 'business', sections: [{ type: 'text', heading: 'About', body: 'We do things.' }] }, network: false });
  const out = JSON.parse(r.body);
  assert.equal(out.ok, true);
  assert.equal(out.slug, 'mysite');
  assert.match(out.renUrl, /^https:\/\/mysite\.melek$/);
  assert.equal(out.pageUrl, '/p/mysite');
  // the published page is servable + SEO-clean
  const page = await get('/p/mysite');
  assert.equal(page.code, 200);
  assert.match(page.body, /My Site/);
  assert.match(page.body, /application\/ld\+json/);                 // JSON-LD present
  assert.match(page.body, /<link rel="canonical" href="https:\/\/mysite\.melek"/); // canonical → REN url
});

test('REN name validation: default .melek, accepts .prana/.kula, rejects junk', () => {
  assert.deepEqual(resolveRen('acme'), { ok: true, label: 'acme', tld: 'melek', renUrl: 'https://acme.melek' });
  assert.equal(resolveRen('acme.prana').tld, 'prana');
  assert.equal(resolveRen('acme.kula').tld, 'kula');
  assert.equal(resolveRen('acme.com').ok, false);      // not a REN tld
  assert.equal(resolveRen('ab').ok, false);            // too short
  assert.equal(resolveRen('-bad-').ok, false);         // leading/trailing hyphen
  assert.equal(resolveRen('<script>').ok, false);      // junk
  assert.equal(resolveRen('').ok, false);
});

test('BYO domain attach shows the DNS record + HONEST pending; verify NEVER fakes success', async () => {
  __reset();
  await post('/api/publish', { ren: 'shopco', template: 'business', doc: { title: 'Shop Co', category: 'business', sections: [] } });
  const att = JSON.parse((await post('/api/attach-domain', { slug: 'shopco', domain: 'www.shopco.com' })).body);
  assert.equal(att.ok, true);
  assert.equal(att.status, 'pending');                          // honest pending, not verified
  assert.ok(att.dns && att.dns.txtName && att.dns.txtValue);    // a real DNS record is shown
  assert.match(att.dns.txtValue, /^melek-verify=/);
  assert.equal(att.dns.pointType, 'CNAME');
  // the default DOMAIN_VERIFY seam must NOT claim verification
  const ver = JSON.parse((await post('/api/verify-domain', { slug: 'shopco' })).body);
  assert.equal(ver.ok, true);
  assert.equal(ver.verified, false, 'default seam must never fake-verify');
  assert.equal(ver.status, 'pending');
  // the stored record is honest too
  assert.equal(_published('shopco').domainStatus, 'pending');
});

test('verify only reports verified when the REAL seam says so (seam is injectable)', async () => {
  __reset();
  await post('/api/publish', { ren: 'realco', template: 'business', doc: { title: 'Real Co', category: 'business', sections: [] } });
  await post('/api/attach-domain', { slug: 'realco', domain: 'realco.com' });
  __setDomainVerify(() => ({ verified: true, status: 'verified', method: 'dns-txt' }));
  const ver = JSON.parse((await post('/api/verify-domain', { slug: 'realco' })).body);
  assert.equal(ver.verified, true);
  assert.equal(ver.status, 'verified');
  __setDomainVerify(null); // restore default; guard against a bogus seam that returns non-true
  __setDomainVerify(() => ({ verified: 'yes-please', status: 'verified' })); // hostile truthy-but-not-true
  const ver2 = JSON.parse((await post('/api/verify-domain', { slug: 'realco' })).body);
  assert.equal(ver2.verified, false, 'only a strict true verifies');
  __setDomainVerify(() => ({ verified: false, status: 'pending', method: 'dns-txt' })); // reset honest default
});

test('a published page ESCAPES hostile content and neutralizes javascript: URLs', async () => {
  __reset();
  await post('/api/publish', {
    ren: 'evil', template: 'personal',
    doc: {
      title: '<script>alert(1)</script>', tagline: '"><img src=x onerror=alert(2)>', category: 'personal',
      sections: [
        { type: 'text', heading: '<b>h</b>', body: 'line1\n<script>bad()</script>' },
        { type: 'links', heading: 'ls', items: [{ label: 'click', url: 'javascript:alert(3)' }, { label: 'ok', url: 'https://good.example' }] },
        { type: 'image', url: 'javascript:alert(4)', alt: 'x' },
      ],
    },
    network: false,
  });
  const body = (await get('/p/evil')).body;
  // The rendered HTML *outside* script blocks is what the browser parses as markup; scan that. (Inside a
  // <script type="application/ld+json"> raw <img> is inert — JSON.stringify is the correct escaping there
  // and the closing </script sequence is guarded — so we exclude script blocks from the markup scan.)
  const markup = body.replace(/<script[\s\S]*?<\/script>/gi, '');
  assert.ok(!body.includes('<script>alert(1)</script>'), 'title script must be escaped');
  assert.ok(!body.includes('<script>bad()</script>'), 'body script must be escaped');
  assert.match(body, /&lt;script&gt;/);
  assert.ok(!/href="javascript:/i.test(body), 'javascript: link must be neutralized');
  assert.ok(!/src="javascript:/i.test(body), 'javascript: image must be neutralized');
  assert.match(body, /href="https:\/\/good\.example\/"/);   // a real url survives
  assert.ok(!/<img[^>]*onerror/i.test(markup), 'no live <img onerror> tag survives (the payload is escaped text)');
  assert.ok(!markup.includes('"><img src=x'), 'the tagline breakout is escaped, not a live tag');
});

test('published page carries the analytics beacon hook when ANALYTICS_BEACON_URL is set', async () => {
  __reset();
  const prev = process.env.ANALYTICS_BEACON_URL;
  process.env.ANALYTICS_BEACON_URL = 'https://build.test/px';
  try {
    await post('/api/publish', { ren: 'beacon', template: 'business', doc: { title: 'Beacon', category: 'business', sections: [] } });
    const body = (await get('/p/beacon')).body;
    assert.match(body, /sendBeacon/);                 // the first-party beacon hook (via headTags)
    assert.match(body, /build\.test\/px/);
  } finally { if (prev == null) delete process.env.ANALYTICS_BEACON_URL; else process.env.ANALYTICS_BEACON_URL = prev; }
});

test('opt-in publishes into the network + shows a disclosed related-sites block', async () => {
  __reset();
  // publish two relevant, opted-in sites so each can surface the other
  await post('/api/publish', { ren: 'alpha', template: 'business', doc: { title: 'Alpha', category: 'business', sections: [] }, network: true });
  await post('/api/publish', { ren: 'beta', template: 'business', doc: { title: 'Beta', category: 'business', sections: [] }, network: true });
  const dir = JSON.parse((await get('/api/directory')).body);
  assert.equal(dir.ok, true);
  assert.ok(dir.count >= 2, 'opted-in sites register into the discovery seam');
  const body = (await get('/p/alpha')).body;
  assert.match(body, /Related sites/);
  assert.match(body, /disclosed/i);       // the network is disclosed, not hidden
  assert.match(body, /Beta/);             // the other member surfaces
});

test('a NON-opted-in published page has no related-sites block, no crypto pitch', async () => {
  __reset();
  await post('/api/publish', { ren: 'plain', template: 'personal', doc: { title: 'Plain Jane', tagline: 'hi', category: 'personal', sections: [] }, network: false });
  const body = (await get('/p/plain')).body;
  assert.ok(!/Related sites/.test(body), 'no network block when not opted in');
  // the customer site must not carry a token/crypto pitch up front
  assert.ok(!/\b(token|blockchain|crypto|wallet address|buy \$)/i.test(body), 'no crypto pitch on a customer site');
});

test('publish is soft: bad REN name is a clean error, not a 500', async () => {
  __reset();
  const out = JSON.parse((await post('/api/publish', { ren: 'x', template: 'business', doc: {} })).body);
  assert.equal(out.ok, false);
  assert.match(out.error, /3/);   // mentions the length rule
});

test('sanitizeDoc clamps + whitelists section types', () => {
  const doc = sanitizeDoc({ title: 'T', category: 'nope', sections: [{ type: 'text', body: 'x' }, { type: 'evil', body: 'y' }, { type: 'image', url: 'u' }] }, 'business');
  assert.equal(doc.category, 'business');     // invalid category → fallback
  assert.equal(doc.sections.length, 2);       // 'evil' dropped
  assert.equal(doc.sections[0].type, 'text');
  assert.equal(doc.sections[1].type, 'image');
});

test('the server does ZERO request-time network (routes work with fetch disabled)', async () => {
  __reset();
  const realFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('no network allowed at request time'); };
  try {
    assert.equal((await get('/')).code, 200);
    const pub = JSON.parse((await post('/api/publish', { ren: 'netless', template: 'business', doc: { title: 'N', category: 'business', sections: [] } })).body);
    assert.equal(pub.ok, true);
    assert.equal((await get('/p/netless')).code, 200);
    assert.equal((await get('/health')).code, 200);
    assert.equal((await get('/sitemap.xml')).code, 200);
  } finally { globalThis.fetch = realFetch; }
});

test('sitemap includes the builder home + published pages', async () => {
  __reset();
  await post('/api/publish', { ren: 'mapme', template: 'business', doc: { title: 'Map Me', category: 'business', sections: [] } });
  const sm = await get('/sitemap.xml');
  assert.equal(sm.code, 200);
  assert.match(sm.body, /<urlset|<url>/);
  assert.match(sm.body, /\/p\/mapme/);
  assert.ok(SITEMAP_PATHS.includes('/'));
});

test('health, robots, llms serve', async () => {
  assert.deepEqual(JSON.parse((await get('/health')).body), { ok: true });
  assert.match((await get('/robots.txt')).body, /User-agent/);
  assert.match((await get('/llms.txt')).body, /Web Builder/i);
});

test('BASE_PATH default is unchanged (self-links stay at root)', async () => {
  assert.ok(!process.env.BASE_PATH, 'test env leaves BASE_PATH unset');
  const body = (await get('/')).body;
  assert.match(body, /href="\/"/);          // brand/new-site link at root
  assert.match(body, /BP = ""/);            // the client BASE_PATH constant is empty by default
});

test('unknown path → 404 (never a 500); garbage URL never throws', async () => {
  const res = await get('/nope/nope');
  assert.equal(res.code, 404);
  assert.match(res.body, /Not found/i);
  const bad = mockRes();
  await handler({ method: 'GET', url: '/%%%bad%%', headers: { host: 'build.test' } }, bad);
  assert.ok(bad.code === 404 || bad.code === 500 || bad.code === 200);
});

test('esc + safeHref soundness', () => {
  assert.equal(esc('<script>x</script>'), '&lt;script&gt;x&lt;/script&gt;');
  assert.equal(safeHref('javascript:alert(1)'), '');
  assert.equal(safeHref('data:text/html,x'), '');
  assert.equal(safeHref('https://ok.example/x'), 'https://ok.example/x');
});

test('renderPublished(null) is null, not a throw', () => {
  assert.equal(renderPublished(null), null);
  assert.equal(typeof builderPage(), 'string');
});
