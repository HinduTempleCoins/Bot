// jobs.test.mjs — offline tests for the SoapBox Jobs vertical. Drives `handler` with a mock req/res
// (no port bound, no network). The jobs/courses engine's fetch is injected via its `__setFetch` seam so
// each lane renders from CANNED provider JSON. Verifies routes, honest-ranked render, free-first courses,
// affiliate-wrapped outbound, honest-empty, robots/sitemap, XSS escaping, unknown route → home.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { handler, homePage, providerOut, esc, SITEMAP_PATHS } from './server.mjs';
import * as engine from '../../integrations/soapbox/jobs-courses.mjs';

function mockRes() {
  return {
    code: null, headers: null, body: '',
    writeHead(code, headers) { this.code = code; this.headers = headers || {}; return this; },
    end(s) { this.body = s == null ? '' : String(s); return this; },
  };
}
async function get(path, headers = {}) {
  const res = mockRes();
  await handler({ url: path, headers: { host: 'jobs.test', ...headers } }, res);
  return res;
}
const okJson = (obj) => ({ ok: true, status: 200, json: async () => obj });

// A canned fetch that answers each provider endpoint by URL substring. Adzuna needs env ids set (below),
// Freelancer/ClassCentral are keyless. Anything else soft-fails (ok:false) so the gov slice collapses to [].
function cannedFetch(overrides = {}) {
  const data = {
    adzuna: overrides.adzuna ?? {
      results: [
        { title: 'Registered Nurse', company: { display_name: 'Acme Health' }, location: { display_name: 'Austin, TX' }, created: '2026-08-20T00:00:00Z', redirect_url: 'https://adzuna.example/nurse' },
        { title: 'Remote Night Nurse', company: { display_name: 'CareCo' }, location: { display_name: 'Anywhere' }, created: '2026-08-24T00:00:00Z', redirect_url: 'https://adzuna.example/night' },
      ],
    },
    freelancer: overrides.freelancer ?? {
      result: { projects: [
        { id: 101, title: 'Build a React dashboard', seo_url: 'react-dashboard', time_submitted: 1755000000, budget: { minimum: 500, maximum: 1500 }, currency: { code: 'USD' } },
      ] },
    },
    classcentral: overrides.classcentral ?? {
      courses: [
        { title: 'Paid Bootcamp', provider: 'Udemy', price: '199' },
        { title: 'Free Intro to Python', provider: 'MIT', free: true, url: 'https://cc.example/python' },
      ],
    },
  };
  return async (u) => {
    const s = String(u);
    if (s.includes('adzuna.com')) return okJson(data.adzuna);
    if (s.includes('freelancer.com/api')) return okJson(data.freelancer);
    if (s.includes('classcentral.com/api')) return okJson(data.classcentral);
    return { ok: false, status: 404, json: async () => ({}) };
  };
}

beforeEach(() => {
  process.env.ADZUNA_APP_ID = 'test-id';
  process.env.ADZUNA_APP_KEY = 'test-key';
  engine.__setFetch(cannedFetch());
});
afterEach(() => {
  engine.__setFetch();
  delete process.env.ADZUNA_APP_ID;
  delete process.env.ADZUNA_APP_KEY;
  delete process.env.CJ_PUBLISHER_ID;
});

test('home 200 lists the three search entries (jobs / freelance / courses)', async () => {
  const res = await get('/');
  assert.equal(res.code, 200);
  assert.match(res.headers['content-type'], /text\/html/);
  assert.match(res.body, /Jobs/);
  assert.match(res.body, /Freelance gigs/);
  assert.match(res.body, /Courses/);
  assert.match(res.body, /never sell your data/i);
});

test('/jobs renders ranked job results from the engine', async () => {
  const res = await get('/jobs?q=nurse&loc=Austin');
  assert.equal(res.code, 200);
  assert.match(res.body, /jobs-courses/);            // engine renderPage section
  assert.match(res.body, /Registered Nurse/);
  assert.match(res.body, /Acme Health/);
  // recency ranking: the 08-24 remote posting sorts above the 08-20 one.
  assert.ok(res.body.indexOf('Remote Night Nurse') < res.body.indexOf('Registered Nurse'),
    'more-recent posting should rank first');
});

test('/freelance renders ranked gig results', async () => {
  const res = await get('/freelance?skill=react');
  assert.equal(res.code, 200);
  assert.match(res.body, /Build a React dashboard/);
  assert.match(res.body, /Freelancer\.com/);
});

test('/courses renders results with FREE surfaced first', async () => {
  const res = await get('/courses?topic=python');
  assert.equal(res.code, 200);
  assert.match(res.body, /Free Intro to Python/);
  assert.match(res.body, /Paid Bootcamp/);
  // free-first: the free course row precedes the paid one in the markup.
  assert.ok(res.body.indexOf('Free Intro to Python') < res.body.indexOf('Paid Bootcamp'),
    'free course must be surfaced before paid');
  assert.match(res.body, /course-free/);             // Free badge present
});

test('outbound provider link is affiliate-wrapped when a publisher id is configured', async () => {
  process.env.CJ_PUBLISHER_ID = 'PUB123';            // jobs vertical fits the CJ network
  const html = providerOut('jobs', 'https://www.indeed.com/jobs?q=nurse', 'Browse more jobs');
  assert.match(html, /rel="sponsored nofollow noopener"/);
  assert.match(html, /pid=PUB123/);                  // affiliate id applied by env NAME
});

test('outbound provider link falls back to a plain url when unconfigured (no fabricated id)', async () => {
  const html = providerOut('jobs', 'https://www.indeed.com/jobs?q=nurse', 'Browse more jobs');
  assert.match(html, /indeed\.com/);
  assert.ok(!/pid=/.test(html), 'no affiliate id should be fabricated when env is unset');
});

test('honest empty — a lane with no results renders an honest "none found", not a 500', async () => {
  engine.__setFetch(cannedFetch({ adzuna: { results: [] }, freelancer: { result: { projects: [] } } }));
  const res = await get('/jobs?q=zzznotathing&gov=0');
  assert.equal(res.code, 200);
  assert.match(res.body, /No jobs or gigs found\./);
});

test('robots.txt, sitemap.xml, sitemap-index.xml, llms.txt all serve', async () => {
  const robots = await get('/robots.txt');
  assert.equal(robots.code, 200);
  const sm = await get('/sitemap.xml');
  assert.equal(sm.code, 200);
  assert.match(sm.body, /<urlset|<url>/);
  assert.match(sm.body, /\/jobs/);
  const smi = await get('/sitemap-index.xml');
  assert.equal(smi.code, 200);
  const llms = await get('/llms.txt');
  assert.equal(llms.code, 200);
  assert.match(llms.body, /Freelance gigs/);
});

test('SITEMAP_PATHS covers home + all three lanes', () => {
  for (const p of ['/', '/jobs', '/freelance', '/courses']) assert.ok(SITEMAP_PATHS.includes(p), `missing ${p}`);
});

test('health probe', async () => {
  const res = await get('/health');
  assert.equal(res.code, 200);
  assert.equal(res.body, 'ok');
});

test('XSS — a hostile job title from the provider cannot inject markup', async () => {
  engine.__setFetch(cannedFetch({ adzuna: { results: [
    { title: '<script>alert(1)</script>', company: { display_name: 'Evil<b>Co</b>' }, location: { display_name: 'X' }, created: '2026-08-24T00:00:00Z', redirect_url: 'https://x/y' },
  ] } }));
  const res = await get('/jobs?q=x&gov=0');
  assert.equal(res.code, 200);
  assert.ok(!res.body.includes('<script>alert(1)</script>'), 'raw script tag must not be reflected');
  assert.match(res.body, /&lt;script&gt;/);          // escaped instead
  assert.equal(esc('<b>&"\'</b>'), '&lt;b&gt;&amp;&quot;&#39;&lt;/b&gt;');
});

test('unknown route → redirect home', async () => {
  const res = await get('/nonsense');
  assert.equal(res.code, 302);
  assert.equal(res.headers.location, '/');
});

test('homePage() is a pure string with the three lanes', () => {
  const html = homePage();
  assert.equal(typeof html, 'string');
  assert.match(html, /Freelance gigs/);
  assert.match(html, /Courses/);
});
