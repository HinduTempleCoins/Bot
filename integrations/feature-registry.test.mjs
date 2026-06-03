// feature-registry.test.mjs — offline (fake fs). Run: node --test integrations/feature-registry.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  categoryFor, labelFor, repoFeatures, summary, __setFs, __resetFlagCache,
} from './feature-registry.mjs';

// a fake fs that serves a tiny repo: a few integration modules + one live server that imports two of them
function fakeFs() {
  const dirent = (name, dir = false) => ({ name, isDirectory: () => dir });
  const tree = {
    'integrations': [dirent('coin-socials.mjs'), dirent('feature-registry.mjs'), dirent('lonely-module.mjs'),
                     dirent('scaffold-only.mjs'), dirent('soapbox', true), dirent('games', true)],
    'integrations/soapbox': [dirent('coin-socials.mjs'), dirent('coin-socials.test.mjs'), dirent('news.mjs')],
    'integrations/games': [dirent('economy.mjs'), dirent('economy.test.mjs')],
  };
  // sibling tests so hasTest works: lonely-module has a test, scaffold-only does not
  tree['integrations'].push(dirent('lonely-module.test.mjs'));
  return {
    async readdir(dir, _opts) {
      // dir is an absolute path ending with one of our keys
      const key = Object.keys(tree).find((k) => dir.endsWith(k));
      return tree[key] || [];
    },
    async readFile(path, _enc) {
      if (path.endsWith('site/soapbox/server.mjs')) {
        return `import { newsFeed } from '../../integrations/soapbox/news.mjs';
                import { renderSocials } from '../../integrations/soapbox/coin-socials.mjs';`;
      }
      if (path.endsWith('site/soapbox/verticals.mjs')) return `// no imports`;
      if (path.endsWith('site/admin/server.mjs')) return `// none`;
      if (path.endsWith('integrations/resource-center.mjs')) return `// none`;
      if (path.endsWith('feature-flags.json')) throw new Error('ENOENT');
      throw new Error('ENOENT ' + path);
    },
  };
}

test('categoryFor buckets by path/name', () => {
  assert.equal(categoryFor('games/economy.mjs'), 'Games');
  assert.equal(categoryFor('chains/caip.mjs'), 'Blockchain / multichain');
  assert.equal(categoryFor('soapbox/adapters/coingecko.mjs'), 'Market data adapters');
  assert.equal(categoryFor('soapbox/weather.mjs'), 'SoapBox Data verticals');
  assert.equal(categoryFor('credential-store.mjs'), 'Auth / vault / grants');
  assert.equal(categoryFor('something-random.mjs'), 'Other integrations');
});

test('labelFor humanizes the filename', () => {
  assert.equal(labelFor('soapbox/coin-socials.mjs'), 'Coin Socials');
  assert.equal(labelFor('access-bond-dao.mjs'), 'Access Bond Dao');
});

test('repoFeatures classifies LIVE vs BUILT vs SCAFFOLD', async () => {
  __setFs(fakeFs());
  __resetFlagCache();
  const feats = await repoFeatures({ root: '/repo' });

  const byId = Object.fromEntries(feats.map((f) => [f.id, f]));
  // imported by the live soapbox server → LIVE
  assert.equal(byId['soapbox/coin-socials'].status, 'LIVE');
  assert.equal(byId['soapbox/coin-socials'].surface, 'data.soapbox.community');
  assert.equal(byId['soapbox/news'].status, 'LIVE');
  // has a sibling test but nothing imports it → BUILT (hidden)
  assert.equal(byId['lonely-module'].status, 'BUILT');
  assert.equal(byId['lonely-module'].surface, null);
  // no test, not imported → SCAFFOLD
  assert.equal(byId['scaffold-only'].status, 'SCAFFOLD');
  // games/economy has a test, not imported → BUILT
  assert.equal(byId['games/economy'].status, 'BUILT');
  assert.equal(byId['games/economy'].category, 'Games');

  __setFs(null);
});

test('summary counts hidden (built-but-not-live) features', async () => {
  __setFs(fakeFs());
  __resetFlagCache();
  const s = await summary({ root: '/repo' });
  assert.ok(s.total >= 5);
  assert.ok(s.byStatus.LIVE >= 2, 'two modules are imported by the live server');
  assert.ok(s.hidden >= 1, 'at least one built-but-not-surfaced feature');
  assert.equal(s.hidden, s.byStatus.BUILT + s.byStatus.SCAFFOLD);
  assert.ok(s.byCategory['Games'], 'category rollup present');
  __setFs(null);
});

// ── v2 cockpit: tiers, descriptions, decision states ──────────────────────────

test('tierFor: front-facing-first patterns beat category fallbacks', async () => {
  const { tierFor, tierOrder, gateReasonFor } = await import('./feature-registry.mjs');
  assert.equal(tierFor({ id: 'soapbox/lawyer-directory', category: 'SoapBox Data verticals' }), 'FRONT-FACING FIRST');
  assert.equal(tierFor({ id: 'soapbox/fec', category: 'SoapBox Data verticals' }), 'FRONT-FACING FIRST');
  assert.equal(tierFor({ id: 'soapbox/benefits-navigator', category: 'SoapBox Data verticals' }), 'FRONT-FACING FIRST');
  // category fallbacks
  assert.equal(tierFor({ id: 'angelicalist/execute', category: 'Trading' }), 'GATED');
  assert.equal(tierFor({ id: 'watcher-thing', category: 'Infra / monitoring' }), 'INTERNAL TOOL');
  assert.equal(tierFor({ id: 'bm25', category: 'Other integrations' }), 'BUILDING BLOCK');
  assert.equal(tierFor({ id: 'soapbox/coin-socials', category: 'SoapBox Data verticals' }), 'PUBLIC CANDIDATE');
  // gate reasons are plain English
  assert.match(gateReasonFor({ category: 'Trading' }), /your explicit approval/);
  assert.match(gateReasonFor({ category: 'Blockchain / multichain' }), /MELEK chain/);
  // order is the decision order, front-facing first
  assert.equal(tierOrder()[0], 'FRONT-FACING FIRST');
});

test('descriptionFor extracts the module header as plain English', async () => {
  const { descriptionFor, __setFs } = await import('./feature-registry.mjs');
  __setFs({
    readdir: async () => [],
    readFile: async () => [
      '// fancy-reader.mjs — reads the fancy federal API and serves honest summaries.',
      '// Soft-fail, keyless, provenance-tagged.',
      '',
      'export const x = 1;',
    ].join('\n'),
  });
  const d = await descriptionFor('/repo', 'integrations/fancy-reader.mjs');
  assert.match(d, /^reads the fancy federal API/);
  assert.match(d, /provenance-tagged/);
  __setFs(null);
});

test('setFlag decision states: queue/later/never persist, clear removes, legacy true=queue', async () => {
  const { setFlag, getFlags, normalizeFlag, __resetFlagCache, __setFs } = await import('./feature-registry.mjs');
  __setFs(null); __resetFlagCache();
  const r1 = await setFlag('test-cockpit-x', 'later', 'park until law portal ships');
  assert.equal(r1.ok, true); assert.equal(r1.state, 'later');
  let flags = await getFlags();
  assert.equal(flags['test-cockpit-x'].state, 'later');
  assert.match(flags['test-cockpit-x'].note, /law portal/);
  const r2 = await setFlag('test-cockpit-x', 'never');
  assert.equal(r2.state, 'never');
  const r3 = await setFlag('test-cockpit-x', 'clear');
  assert.equal(r3.ok, true); assert.equal(r3.state, null);
  flags = await getFlags();
  assert.equal(flags['test-cockpit-x'], undefined);
  // legacy shapes normalize
  assert.equal(normalizeFlag(true).state, 'queue');
  assert.equal(normalizeFlag(false), null);
  assert.equal(normalizeFlag({ state: 'bogus' }), null);
  // unknown state rejected
  const bad = await setFlag('test-cockpit-x', 'maybe');
  assert.equal(bad.ok, false);
  await setFlag('test-cockpit-x', 'clear'); __resetFlagCache();
});
