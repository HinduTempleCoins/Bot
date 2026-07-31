// pentecaust/herald/pr-pipeline.test.mjs — offline tests for the Herald press-release pipeline.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FORMATS, renderRelease, renderAll, boilerplate, checklist } from './pr-pipeline.mjs';

const RELEASE = {
  headline: 'MELEK Mainnet Launches With No Premine',
  subhead: 'A community Graphene chain from VKFRI',
  dateline: 'IRVING, TX — July 12, 2026',
  body: 'Para one, the lede paragraph with the key facts.\n\nPara two, more detail.\n\nPara three, even more detail that only the long formats should keep.',
  quotes: [{ who: 'Rev. Van Kush', text: 'This is built for real utility.' }, { who: 'Kali', text: 'For the community.' }],
  contact: 'press@melek.salon',
};

test('renderRelease for every format → non-empty, includes headline + boilerplate org', () => {
  for (const f of FORMATS) {
    const r = renderRelease(f, RELEASE);
    assert.equal(r.ok, true);
    assert.ok(r.text.includes(RELEASE.headline), `${f} has headline`);
    assert.ok(r.text.includes('Van Kush Family Research Institute'), `${f} has boilerplate`);
  }
});

test('openpr is shorter than 1888pressrelease for the same release', () => {
  const short = renderRelease('openpr', RELEASE).text;
  const long = renderRelease('1888pressrelease', RELEASE).text;
  assert.ok(short.length < long.length, 'openpr < 1888');
  assert.ok(long.includes('###'), '1888 has end marker');
});

test('quotes appear in prlog output; boilerplate env override is reflected', () => {
  const prev = process.env.HERALD_ORG_NAME;
  process.env.HERALD_ORG_NAME = 'Test Org XYZ';
  try {
    const r = renderRelease('prlog', RELEASE);
    assert.ok(r.text.includes('This is built for real utility.'), 'quote present');
    assert.ok(boilerplate().includes('Test Org XYZ'), 'env override reflected');
    assert.ok(r.text.includes('Test Org XYZ'), 'override in rendered text');
  } finally {
    if (prev == null) delete process.env.HERALD_ORG_NAME; else process.env.HERALD_ORG_NAME = prev;
  }
});

test('unknown format → soft-fail, never throws', () => {
  assert.equal(renderRelease('newswire', RELEASE).ok, false);
});

test('renderAll covers all formats; checklist is a non-empty string array', () => {
  const all = renderAll(RELEASE);
  for (const f of FORMATS) assert.ok(all[f].length > 0, `renderAll ${f}`);
  const cl = checklist(RELEASE);
  assert.ok(Array.isArray(cl) && cl.length > 0 && cl.every((s) => typeof s === 'string'));
});
