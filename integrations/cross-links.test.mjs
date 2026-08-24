// cross-links.test.mjs — pure URL-construction tests for the inter-site link helper (task #276).
// No network: every function is pure. We assert the production defaults, env overrides, safe encoding
// (spaces, &, <, ", unicode), the crypto coin-page branch, and the case id-vs-name routing.
// Run: node --test integrations/cross-links.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';

// Helper to import a FRESH module instance with a given env (so module-level defaults are exercised too).
async function freshWithEnv(env = {}) {
  const saved = {};
  for (const k of ['LAW_SITE', 'POLITICS_SITE', 'STOCKS_SITE', 'DATA_SITE']) { saved[k] = process.env[k]; delete process.env[k]; }
  Object.assign(process.env, env);
  // cache-bust the ESM import
  const mod = await import('./cross-links.mjs?ts=' + Date.now() + Math.random());
  // restore
  for (const k of Object.keys(saved)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  for (const k of Object.keys(env)) if (!(k in saved)) delete process.env[k];
  return mod;
}

test('judgeLinks → law /judges + politics /accountability with production defaults', async () => {
  const { judgeLinks } = await freshWithEnv();
  const l = judgeLinks('Thurgood Marshall');
  assert.equal(l.law, 'https://law.soapbox.community/judges?q=Thurgood%20Marshall');
  assert.equal(l.politics, 'https://politics.soapbox.community/accountability?q=Thurgood%20Marshall');
});

test('politicianLinks → politics map + law case search', async () => {
  const { politicianLinks } = await freshWithEnv();
  const l = politicianLinks('Jane Doe');
  assert.equal(l.politics, 'https://politics.soapbox.community/accountability?q=Jane%20Doe');
  assert.equal(l.law, 'https://law.soapbox.community/cases?q=Jane%20Doe');
});

test('companyLinks → stocks/?q + law /cases + politics /accountability (no data without crypto)', async () => {
  const { companyLinks } = await freshWithEnv();
  const l = companyLinks('Apple');
  assert.equal(l.stocks, 'https://stocks.soapbox.community/?q=Apple');
  assert.equal(l.law, 'https://law.soapbox.community/cases?q=Apple');
  assert.equal(l.politics, 'https://politics.soapbox.community/accountability?q=Apple');
  assert.equal(l.scamAlert, 'https://scam-alert.soapbox.community/company?q=Apple');
  assert.equal(l.scams, 'https://soapbox.community/scams?q=Apple');
  assert.ok(!('data' in l), 'no data coin-page link unless crypto:true');
});

test('companyLinks scam-alert/scams honor env overrides', async () => {
  const { companyLinks } = await freshWithEnv({ SCAM_ALERT_SITE: 'https://scam.stage.test', SOAPBOX_HUB: 'https://hub.stage.test' });
  const l = companyLinks('Acme');
  assert.equal(l.scamAlert, 'https://scam.stage.test/company?q=Acme');
  assert.equal(l.scams, 'https://hub.stage.test/scams?q=Acme');
});

test('companyLinks with crypto:true adds a Data coin-page link (lower-cased slug)', async () => {
  const { companyLinks } = await freshWithEnv();
  const l = companyLinks('BTC', { crypto: true });
  assert.equal(l.data, 'https://data.soapbox.community/coin/btc');
  assert.equal(l.stocks, 'https://stocks.soapbox.community/?q=BTC');
});

test('caseLinks by id routes to the on-site detail (?id=), by name to case search', async () => {
  const { caseLinks } = await freshWithEnv();
  const byId = caseLinks('118144', { name: 'Brown v. Board' });
  assert.equal(byId.law, 'https://law.soapbox.community/cases?id=118144');
  assert.equal(byId.politics, 'https://politics.soapbox.community/accountability?q=Brown%20v.%20Board');
  const byCap = caseLinks('12345', { cap: true });
  assert.equal(byCap.law, 'https://law.soapbox.community/cases?cap=12345');
  const byName = caseLinks('', { name: 'Roe v. Wade' });
  assert.equal(byName.law, 'https://law.soapbox.community/cases?q=Roe%20v.%20Wade');
});

test('citationLinks resolves a reporter citation on the Law cases tab', async () => {
  const { citationLinks } = await freshWithEnv();
  const l = citationLinks('347 U.S. 483');
  assert.equal(l.law, 'https://law.soapbox.community/cases?q=347%20U.S.%20483');
});

test('categoryLinks strips the cat: id prefix and underscores to a readable search term', async () => {
  const { categoryLinks } = await freshWithEnv();
  assert.equal(categoryLinks('cat:coercion').law, 'https://law.soapbox.community/cases?q=coercion');
  assert.equal(categoryLinks('Equal Protection').law, 'https://law.soapbox.community/cases?q=Equal%20Protection');
});

test('env overrides (LAW_SITE/POLITICS_SITE/STOCKS_SITE/DATA_SITE) replace the production defaults', async () => {
  const { judgeLinks, companyLinks } = await freshWithEnv({
    LAW_SITE: 'http://localhost:8099',
    POLITICS_SITE: 'http://localhost:8097/',  // trailing slash must be trimmed
    STOCKS_SITE: 'http://localhost:8095',
    DATA_SITE: 'http://localhost:8088',
  });
  const j = judgeLinks('Smith');
  assert.equal(j.law, 'http://localhost:8099/judges?q=Smith');
  assert.equal(j.politics, 'http://localhost:8097/accountability?q=Smith', 'trailing slash trimmed');
  const c = companyLinks('Acme', { crypto: true });
  assert.equal(c.stocks, 'http://localhost:8095/?q=Acme');
  assert.equal(c.data, 'http://localhost:8088/coin/acme');
});

test('dangerous characters are percent-encoded (no query-string / HTML break-out)', async () => {
  const { companyLinks } = await freshWithEnv();
  const l = companyLinks('A & B <Inc> "Co"');
  // & < > " space all encoded; the value cannot break the query string or the surrounding attribute.
  assert.ok(/q=A%20%26%20B%20%3CInc%3E%20%22Co%22$/.test(l.stocks), `encoded: ${l.stocks}`);
  assert.ok(!l.stocks.includes('<'), 'no raw <');
  assert.ok(!l.stocks.includes('&', l.stocks.indexOf('?q=') + 3) || l.stocks.includes('%26'), 'literal ampersand encoded');
});

test('unicode entity names are encoded safely', async () => {
  const { judgeLinks } = await freshWithEnv();
  const l = judgeLinks('Sōtomayor café');
  assert.ok(l.law.startsWith('https://law.soapbox.community/judges?q='));
  assert.ok(!/[^\x00-\x7F]/.test(l.law), 'no raw non-ascii in the URL');
});

test('siteBases exposes the canonical bases for callers building bespoke links', async () => {
  const { siteBases } = await freshWithEnv();
  const b = siteBases();
  assert.equal(b.law, 'https://law.soapbox.community');
  assert.equal(b.stocks, 'https://stocks.soapbox.community');
  assert.equal(b.politics, 'https://politics.soapbox.community');
  assert.equal(b.data, 'https://data.soapbox.community');
});
