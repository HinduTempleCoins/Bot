// jobs-courses.test.mjs — offline tests for the jobs/freelance/courses aggregator. All network I/O is
// through an injected fetch returning canned JSON; no real key, no real request is ever made.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  searchJobs, searchFreelance, searchCourses, rankResults, applyOut,
  renderPage, dataNote, esc, API_KEY_ENV,
} from './jobs-courses.mjs';

// Minimal Response-like objects.
const okJson = (obj) => ({ ok: true, status: 200, json: async () => obj });
const notOk = () => ({ ok: false, status: 500, json: async () => ({}) });

test('searchJobs normalizes a canned Adzuna response', async () => {
  // Set Adzuna env so the private slice fires; gov slice soft-fails (no USAJOBS key) and is additive.
  const oldId = process.env[API_KEY_ENV.jobsAppId];
  const oldKey = process.env[API_KEY_ENV.jobsAppKey];
  process.env[API_KEY_ENV.jobsAppId] = 'test-id';
  process.env[API_KEY_ENV.jobsAppKey] = 'test-key';
  const fetch = async (url) => {
    if (String(url).includes('adzuna')) {
      return okJson({
        results: [
          {
            title: 'Registered Nurse',
            company: { display_name: 'Austin Health' },
            location: { display_name: 'Austin, TX' },
            created: '2026-06-01T12:00:00Z',
            redirect_url: 'https://adzuna.example/job/1',
          },
          {
            title: 'Remote Data Analyst',
            company: { display_name: 'Acme' },
            location: { display_name: 'Anywhere' },
            created: '2026-06-03T12:00:00Z',
            redirect_url: 'https://adzuna.example/job/2',
          },
        ],
      });
    }
    return notOk();
  };
  const rows = await searchJobs({ query: 'nurse', location: 'Austin, TX' }, { fetch });
  if (oldId == null) delete process.env[API_KEY_ENV.jobsAppId]; else process.env[API_KEY_ENV.jobsAppId] = oldId;
  if (oldKey == null) delete process.env[API_KEY_ENV.jobsAppKey]; else process.env[API_KEY_ENV.jobsAppKey] = oldKey;

  assert.equal(rows.length, 2);
  const r = rows[0];
  assert.equal(r.title, 'Registered Nurse');
  assert.equal(r.company, 'Austin Health');
  assert.equal(r.location, 'Austin, TX');
  assert.equal(r.source, 'Adzuna');
  assert.equal(r.url, 'https://adzuna.example/job/1');
  assert.equal(r.remote, false);
  // normalized shape keys present
  for (const k of ['title', 'company', 'location', 'remote', 'postedAt', 'url', 'source']) {
    assert.ok(k in r, `row should have key ${k}`);
  }
  // "Anywhere" location is detected as remote
  assert.equal(rows[1].remote, true);
});

test('searchJobs soft-fails to [] when the fetch throws', async () => {
  const oldId = process.env[API_KEY_ENV.jobsAppId];
  const oldKey = process.env[API_KEY_ENV.jobsAppKey];
  process.env[API_KEY_ENV.jobsAppId] = 'test-id';
  process.env[API_KEY_ENV.jobsAppKey] = 'test-key';
  const fetch = async () => { throw new Error('network down'); };
  const rows = await searchJobs({ query: 'x' }, { fetch });
  if (oldId == null) delete process.env[API_KEY_ENV.jobsAppId]; else process.env[API_KEY_ENV.jobsAppId] = oldId;
  if (oldKey == null) delete process.env[API_KEY_ENV.jobsAppKey]; else process.env[API_KEY_ENV.jobsAppKey] = oldKey;
  assert.ok(Array.isArray(rows));
  assert.equal(rows.length, 0);
});

test('searchJobs makes no private call (and returns []) when keys are absent', async () => {
  const oldId = process.env[API_KEY_ENV.jobsAppId];
  const oldKey = process.env[API_KEY_ENV.jobsAppKey];
  delete process.env[API_KEY_ENV.jobsAppId];
  delete process.env[API_KEY_ENV.jobsAppKey];
  let called = false;
  const fetch = async () => { called = true; return okJson({ results: [] }); };
  // includeGov:false so the only possible call would be the private board (which must be skipped).
  const rows = await searchJobs({ query: 'x', includeGov: false }, { fetch });
  if (oldId != null) process.env[API_KEY_ENV.jobsAppId] = oldId;
  if (oldKey != null) process.env[API_KEY_ENV.jobsAppKey] = oldKey;
  assert.deepEqual(rows, []);
  assert.equal(called, false, 'no network call without keys');
});

test('searchFreelance normalizes gigs as remote rows; soft-fails to []', async () => {
  const fetch = async () => okJson({
    result: {
      projects: [
        {
          id: 42,
          title: 'Build a logo',
          seo_url: 'build-a-logo-42',
          budget: { minimum: 50, maximum: 200 },
          currency: { code: 'USD' },
          time_submitted: 1717000000,
        },
      ],
    },
  });
  const rows = await searchFreelance({ skill: 'design' }, { fetch });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].title, 'Build a logo');
  assert.equal(rows[0].remote, true);
  assert.equal(rows[0].source, 'Freelancer');
  assert.ok(rows[0].url.includes('build-a-logo-42'));

  // soft-fail on not-ok
  const bad = await searchFreelance({ skill: 'x' }, { fetch: async () => notOk() });
  assert.deepEqual(bad, []);
});

test('searchCourses puts FREE/open courses first', async () => {
  const fetch = async () => okJson({
    courses: [
      { title: 'Paid Python Bootcamp', provider: 'Udemy', price: 49.99, url: 'https://u.example/1' },
      { title: 'Free Intro to CS', provider: 'MIT OCW', free: true, url: 'https://mit.example/2' },
      { title: 'Audit-only Stats', provider: 'Coursera', price: 'Free (audit)', url: 'https://c.example/3' },
      { title: 'Another Paid Course', provider: 'edX', paid: true, price: 99, url: 'https://e.example/4' },
    ],
  });
  const rows = await searchCourses({ topic: 'programming' }, { fetch });
  assert.equal(rows.length, 4);
  // first two must be the free ones (free-first ordering, stable within group)
  assert.equal(rows[0].free, true);
  assert.equal(rows[1].free, true);
  assert.equal(rows[2].free, false);
  assert.equal(rows[3].free, false);
  // the explicitly-free one keeps its order before the audit-free one
  assert.equal(rows[0].title, 'Free Intro to CS');
  assert.equal(rows[1].title, 'Audit-only Stats');
  // normalized course shape
  for (const k of ['title', 'provider', 'free', 'url']) assert.ok(k in rows[0], `course should have key ${k}`);
  // soft-fail
  assert.deepEqual(await searchCourses({ topic: 'x' }, { fetch: async () => notOk() }), []);
});

test('rankResults orders by relevance then recency, NOT commission', () => {
  const items = [
    { title: 'low relevance, old, big commission', relevance: 1, postedAt: '2020-01-01', commission: 1000 },
    { title: 'high relevance, old, no commission', relevance: 9, postedAt: '2019-01-01', commission: 0 },
    { title: 'high relevance, recent, no commission', relevance: 9, postedAt: '2026-06-01', commission: 0 },
  ];
  const ranked = rankResults(items);
  // highest relevance + most recent first; commission is ignored entirely.
  assert.equal(ranked[0].title, 'high relevance, recent, no commission');
  assert.equal(ranked[1].title, 'high relevance, old, no commission');
  assert.equal(ranked[2].title, 'low relevance, old, big commission');
  // the big-commission row is LAST despite the largest commission → ranking is not bought.
  assert.equal(ranked[ranked.length - 1].commission, 1000);
  // input not mutated
  assert.equal(items[0].title, 'low relevance, old, big commission');
});

test('applyOut soft-fails to a plain url when not configured', () => {
  // unknown/absent network and no engine id ⇒ plain url, configured:false, disclosure present.
  const out = applyOut({ url: 'https://jobs.example/apply/1' });
  assert.equal(out.url, 'https://jobs.example/apply/1');
  assert.equal(out.configured, false);
  assert.ok(out.disclosure && out.disclosure.length > 0);
  // no url ⇒ empty + reason
  const none = applyOut({});
  assert.equal(none.url, '');
  assert.equal(none.configured, false);
});

test('renderPage escapes a malicious job title and shows the disclosure', () => {
  const evil = '<script>alert(1)</script>';
  const html = renderPage({
    jobs: [{ title: evil, company: 'Acme', location: 'TX', remote: false, postedAt: '2026-06-01', url: 'https://x.example', source: 'Adzuna' }],
    courses: [{ title: 'Free Course', provider: 'MIT', free: true, url: 'https://mit.example' }],
  });
  // the raw script tag must NOT appear; the escaped form must.
  assert.ok(!html.includes('<script>alert(1)</script>'), 'unescaped script must not be present');
  assert.ok(html.includes('&lt;script&gt;'), 'escaped title must be present');
  // disclosure present
  assert.ok(/disclosure/i.test(html), 'FTC disclosure must be present');
  // free badge present for the free course
  assert.ok(html.includes('course-free'), 'free course badge present');
});

test('dataNote is present and mentions relevance/recency, not commission bias', () => {
  const note = dataNote();
  assert.ok(typeof note === 'string' && note.length > 0);
  assert.ok(/as of \d{4}-\d{2}-\d{2}/.test(note), 'as-of date present');
  assert.ok(/relevance and recency/i.test(note));
  assert.ok(/never by\s+commission/i.test(note));
});

test('esc escapes the five HTML-significant characters', () => {
  assert.equal(esc(`<>&"'`), '&lt;&gt;&amp;&quot;&#39;');
});
