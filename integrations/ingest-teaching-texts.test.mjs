// ingest-teaching-texts.test.mjs — OFFLINE. Scrapes PRIMARY sources only (no opinions), writes clean text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fsp } from 'node:fs';
import { join } from 'node:path';
import { ingestOne, ingestAll, SOURCES } from './ingest-teaching-texts.mjs';

const TMP = join(process.env.TMPDIR || '/tmp', `teach-test-${process.pid}`);

test('ingestOne picks a PRIMARY-source result (skips blogs/opinions) and writes the text', async () => {
  const search = async () => ({ results: [
    { url: 'https://somebody-blog.com/my-opinion-on-ptahhotep' },   // opinion → must be skipped
    { url: 'https://www.sacred-texts.com/egy/ptah.htm' },            // primary → chosen
  ] });
  const fetchUrl = async (u) => ({ ok: true, title: 'Ptahhotep', markdown: '## The Maxims\n' + 'x'.repeat(600) + `\n(from ${u})` });
  const r = await ingestOne(SOURCES[0], { search, fetchUrl, outDir: TMP });
  assert.equal(r.ok, true);
  assert.equal(r.host, 'sacred-texts.com');                          // the primary source, not the blog
  const txt = await fsp.readFile(r.file, 'utf8');
  assert.match(txt, /Primary text ingested/);
  assert.match(txt, /Source: https:\/\/www\.sacred-texts\.com/);
  assert.match(txt, /The Maxims/);
});

test('skips when no primary source is found, and when the scrape is empty', async () => {
  const onlyBlogs = async () => ({ results: [{ url: 'https://reddit.com/r/x' }, { url: 'https://medium.com/@a/post' }] });
  const r1 = await ingestOne(SOURCES[1], { search: onlyBlogs, fetchUrl: async () => ({ ok: true, markdown: 'x'.repeat(800) }), outDir: TMP });
  assert.equal(r1.ok, false);
  assert.equal(r1.reason, 'no-primary-source-found');
  const primaryButEmpty = async () => ({ results: [{ url: 'https://en.wikisource.org/wiki/Emerald_Tablet' }] });
  const r2 = await ingestOne(SOURCES[1], { search: primaryButEmpty, fetchUrl: async () => ({ ok: true, markdown: 'tiny' }), outDir: TMP });
  assert.equal(r2.ok, false);
  assert.equal(r2.reason, 'scrape-empty');
});

test('ingestAll returns one result per source; SOURCES are all primary-text titles', async () => {
  const out = await ingestAll({ search: async () => ({ results: [] }), fetchUrl: async () => null, outDir: TMP, sources: SOURCES.slice(0, 2) });
  assert.equal(out.length, 2);
  assert.ok(SOURCES.some((s) => /Ptahhotep/.test(s.title)) && SOURCES.some((s) => /Emerald/.test(s.title)) && SOURCES.some((s) => /Hercules/.test(s.title)));
});

test.after(async () => { try { await fsp.rm(TMP, { recursive: true, force: true }); } catch { /* ignore */ } });
