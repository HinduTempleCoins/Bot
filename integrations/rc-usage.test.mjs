// rc-usage.test.mjs — offline (injected sources). Run: node --test integrations/rc-usage.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rcUsage, summary, __setSources } from './rc-usage.mjs';

// ── a fake repo: a few reader modules + a fake resource-center / live server that import some ──────
function fakeSources() {
  const dirent = (name, dir = false) => ({ name, isDirectory: () => dir });
  // integrations/  +  integrations/soapbox/
  const tree = {
    'integrations': [
      dirent('resource-center.mjs'),
      dirent('held-asset-scan.mjs'),
      dirent('rc-usage.mjs'),                 // must be filtered out of its own report
      dirent('soapbox', true),
    ],
    'integrations/soapbox': [
      dirent('fred.mjs'), dirent('fred.test.mjs'),            // reader WITH a test, USED by RC
      dirent('fbi-crime.mjs'), dirent('fbi-crime.test.mjs'),  // reader WITH a test, UNUSED
      dirent('treasury-fiscal.mjs'),                          // reader, no test, SURFACED by live site
      dirent('macro.mjs'),                                    // reader-ish, USED by RC
      dirent('cache.mjs'),                                    // NOT a reader → excluded from catalog
    ],
  };

  const govApis = [
    { agency: 'Federal Reserve (St. Louis)', name: 'FRED API', domain: 'Economy & Finance', keyless: false, keyViaDataGov: false, pageIdea: 'econ dashboard' },
    { agency: 'FBI', name: 'FBI Crime Data API', domain: 'Safety & Recalls', keyless: false, keyViaDataGov: true, pageIdea: 'crime map' },
    { agency: 'NASA', name: 'NASA Open APIs', domain: 'Science & Space', keyless: true, keyViaDataGov: true, pageIdea: 'space page' }, // no built reader
  ];

  return {
    govApis,
    govSummary: { total: 3, keyless: 1, ownKey: 1 },
    async readdir(dir) {
      const key = Object.keys(tree).find((k) => dir.endsWith(k));
      return tree[key] || [];
    },
    async readFile(path) {
      if (path.endsWith('integrations/resource-center.mjs')) {
        // RC imports macro + fred (dynamic), held-asset-scan (static)
        return `import { macro } from './soapbox/macro.mjs';
                import { scanAccounts } from './held-asset-scan.mjs';
                const m = await import('./soapbox/fred.mjs');`;
      }
      if (path.endsWith('site/soapbox/server.mjs')) {
        // live site surfaces treasury-fiscal (but RC does not)
        return `import { treasuryFiscal } from '../../integrations/soapbox/treasury-fiscal.mjs';`;
      }
      if (path.endsWith('site/soapbox/verticals.mjs')) return '// none';
      if (path.endsWith('site/admin/server.mjs')) return '// none';
      throw new Error('ENOENT ' + path);
    },
  };
}

test('classifies built readers USED / SURFACED / UNUSED', async () => {
  __setSources(fakeSources());
  const { modules } = await rcUsage();
  const byId = Object.fromEntries(modules.map((m) => [m.id, m]));

  assert.equal(byId['fred'].status, 'USED');          // RC dynamically imports it
  assert.equal(byId['macro'].status, 'USED');         // RC statically imports it
  assert.equal(byId['treasury-fiscal'].status, 'SURFACED'); // not RC, but the live site imports it
  assert.equal(byId['fbi-crime'].status, 'UNUSED');   // built (+test) but nobody imports it
});

test('non-reader utility modules are excluded; rc-usage excludes itself', async () => {
  __setSources(fakeSources());
  const { modules } = await rcUsage();
  const ids = modules.map((m) => m.id);
  assert.ok(!ids.includes('cache'), 'cache.mjs is not a data reader');
  assert.ok(!ids.includes('rc-usage'), 'the report must not list itself');
});

test('an RC dependency is included even when its name lacks a reader hint', async () => {
  __setSources(fakeSources());
  const { modules } = await rcUsage();
  const byId = Object.fromEntries(modules.map((m) => [m.id, m]));
  // held-asset-scan has no reader-hint token, but RC statically imports it → USED + listed
  assert.equal(byId['held-asset-scan']?.status, 'USED');
});

test('hasTest reflects sibling .test files', async () => {
  __setSources(fakeSources());
  const { modules } = await rcUsage();
  const byId = Object.fromEntries(modules.map((m) => [m.id, m]));
  assert.equal(byId['fred'].hasTest, true);
  assert.equal(byId['fbi-crime'].hasTest, true);
  assert.equal(byId['treasury-fiscal'].hasTest, false);
});

test('domain labels group readers sensibly', async () => {
  __setSources(fakeSources());
  const { modules } = await rcUsage();
  const byId = Object.fromEntries(modules.map((m) => [m.id, m]));
  assert.equal(byId['fbi-crime'].domain, 'Safety & accountability');
  assert.equal(byId['fred'].domain, 'Economy & markets');
  assert.equal(byId['treasury-fiscal'].domain, 'Government & civic data');
});

test('catalog matches gov entries to built readers + flags no-reader', async () => {
  __setSources(fakeSources());
  const { catalog } = await rcUsage();
  const byName = Object.fromEntries(catalog.map((c) => [c.name, c]));

  assert.equal(byName['FRED API'].reader, 'fred');
  assert.equal(byName['FRED API'].readerStatus, 'USED');
  assert.equal(byName['FBI Crime Data API'].reader, 'fbi-crime');
  assert.equal(byName['FBI Crime Data API'].readerStatus, 'UNUSED');
  assert.equal(byName['NASA Open APIs'].reader, null);
  assert.equal(byName['NASA Open APIs'].readerStatus, 'NO READER');
});

test('summary rolls up the headline numbers', async () => {
  __setSources(fakeSources());
  const s = await summary();
  // 5 listed: fred(USED), macro(USED), held-asset-scan(USED), treasury-fiscal(SURFACED), fbi-crime(UNUSED)
  assert.equal(s.modules.total, 5);
  assert.equal(s.modules.USED, 3);
  assert.equal(s.modules.SURFACED, 1);
  assert.equal(s.modules.UNUSED, 1);
  assert.equal(s.inUseByRC, 3);
  assert.equal(s.onTheShelf, 2);                       // surfaced + unused
  assert.equal(s.catalog.total, 3);
  assert.equal(s.catalog.byReaderStatus['NO READER'], 1);
});

test('soft-fails: missing files / empty repo yield empty report, never throws', async () => {
  __setSources({
    govApis: [],
    govSummary: null,
    async readdir() { return []; },
    async readFile() { throw new Error('ENOENT'); },
  });
  const rep = await rcUsage();
  assert.deepEqual(rep.modules, []);
  assert.deepEqual(rep.catalog, []);
  assert.equal(rep.summary.modules.total, 0);
});
