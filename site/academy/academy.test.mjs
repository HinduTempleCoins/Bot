// academy.test.mjs — offline tests for the MELEK Academy credential portal. No network, no keys.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handler, homePage, programView, verifyView, registryView, esc, issuerTokenOk, sealSvg, credentialView, certificateView, __setRegistry } from './server.mjs';
import { createRegistry, issueCredential } from '../../integrations/soapbox/credentials-issuer.mjs';

function mockReq(path, headers = {}) { return { url: path, method: 'GET', headers }; }
function mockRes() {
  return { statusCode: 0, headers: {}, body: '', writeHead(c, h) { this.statusCode = c; Object.assign(this.headers, h || {}); }, end(b) { this.body = b || ''; } };
}
async function route(path, headers) { const res = mockRes(); await handler(mockReq(path, headers), res); return res; }

test('esc escapes metacharacters', () => {
  assert.equal(esc('<b>"&"</b>'), '&lt;b&gt;&quot;&amp;&quot;&lt;/b&gt;');
});

test('home lists the flagship programs + the honest non-accredited framing', () => {
  const h = homePage();
  assert.match(h, /MELEK Academy/);
  assert.match(h, /MELEK Press Pass/);
  assert.match(h, /Ordination/);
  assert.match(h, /Angelic AI/);
  assert.match(h, /non-accredited/i);
  assert.match(h, /First Amendment/);
  assert.match(h, /not college credit|not a CEU|not a license/i);
});

test('home route 200 + nav + sitemap includes programs', async () => {
  assert.equal((await route('/')).statusCode, 200);
  const sm = await route('/sitemap.xml');
  assert.equal(sm.statusCode, 200);
  assert.match(sm.body, /\/program\/melek-press-pass/);
});

test('program page shows issuer basis, criteria, and the gated-issuance notice', () => {
  const h = programView('ordination-minister');
  assert.match(h, /Ordination/);
  assert.match(h, /church|First Amendment/i);
  assert.match(h, /How you earn it/);
  assert.match(h, /gated to the issuing authority|cannot self-mint/i);  // no open self-serve minting
});

test('unknown program soft-renders a not-found', () => {
  assert.match(programView('nope'), /Not found/);
});

test('verify: a pasted valid credential (base64 ?c=) verifies', () => {
  const cred = issueCredential({ programId: 'angelic-ai-foundations', recipientName: 'Sam', now: new Date('2026-08-28') }).credential;
  const c = Buffer.from(JSON.stringify(cred), 'utf8').toString('base64');
  const h = verifyView({ c });
  assert.match(h, /VALID/);
  assert.match(h, /Angelic AI/);
});

test('verify: a tampered pasted credential fails', () => {
  const cred = issueCredential({ programId: 'angelic-ai-foundations', recipientName: 'Sam', now: new Date('2026-08-28') }).credential;
  cred.recipient.name = 'Mallory';
  const c = Buffer.from(JSON.stringify(cred), 'utf8').toString('base64');
  assert.match(verifyView({ c }), /NOT VALID|hash-mismatch/);
});

test('verify: garbage ?c= soft-fails, no throw', () => {
  assert.match(verifyView({ c: 'not-base64-json' }), /Could not parse|NOT VALID/);
});

test('verify by registry id works after injecting a registry', () => {
  const reg = createRegistry();
  const r = reg.issue({ programId: 'melek-press-pass', recipientName: 'Jane', now: new Date('2026-08-28') });
  __setRegistry(reg);
  assert.match(verifyView({ id: r.credential.id }), /VALID/);
  __setRegistry(null); // reset to empty
});

test('registry route 200 + honest empty-state by default', async () => {
  __setRegistry(null);
  const res = await route('/registry');
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /No credentials issued/);
});

test('/issue is gated: 403 without a token (no self-mint)', async () => {
  const res = await route('/issue?program=ordination-minister&name=X');
  assert.equal(res.statusCode, 403);
  assert.match(res.body, /gated to the issuing authority/);
});

test('/issue: a GET carrying the header token is still rejected (POST required, no secret in URL)', async () => {
  const res = await route('/issue?program=ordination-minister&name=X', { 'x-issuer-token': 'whatever' });
  assert.equal(res.statusCode, 403);
});

test('issuerTokenOk: constant-time gate — unconfigured/GET/wrong all fail, only POST+exact passes', () => {
  assert.equal(issuerTokenOk('secret', true, ''), false);        // no token configured
  assert.equal(issuerTokenOk('secret', false, 'secret'), false); // not a POST
  assert.equal(issuerTokenOk('wrong', true, 'secret'), false);   // wrong token
  assert.equal(issuerTokenOk('sec', true, 'secret'), false);     // length mismatch
  assert.equal(issuerTokenOk(123, true, 'secret'), false);       // non-string
  assert.equal(issuerTokenOk('secret', true, 'secret'), true);   // exact match + POST
});

const b64 = (cred) => Buffer.from(JSON.stringify(cred), 'utf8').toString('base64');
const sampleCred = () => issueCredential({ programId: 'melek-press-pass', recipientName: 'Jane Reporter', now: new Date('2026-08-28') }).credential;

test('sealSvg renders an SVG bearing the issuer name (the logo on the paper)', () => {
  const s = sealSvg('MELEK Press');
  assert.match(s, /<svg[\s\S]+<\/svg>/);
  assert.match(s, /MELEK PRESS/);
  assert.match(s, /VERIFIABLE · ON-CHAIN/);
});

test('credentialView: a valid credential reads GENUINE + links to the printable certificate', () => {
  const h = credentialView({ c: b64(sampleCred()) });
  assert.match(h, /GENUINE/);
  assert.match(h, /MELEK Press Pass/);
  assert.match(h, /Jane Reporter/);
  assert.match(h, /\/certificate\?c=/);           // printable certificate link
  assert.match(h, /look(s|)? it up|looks it up|company/i);
});

test('credentialView: a tampered credential reads NOT VALID', () => {
  const cred = sampleCred(); cred.recipient.name = 'Mallory';
  assert.match(credentialView({ c: b64(cred) }), /NOT VALID/);
});

test('credentialView: garbage soft-renders not-found', () => {
  assert.match(credentialView({ c: 'garbage' }), /not found|Not found/i);
});

test('certificateView: printable certificate has the seal, recipient, verify URL, print button + print CSS', () => {
  const cred = sampleCred();
  const h = certificateView({ c: b64(cred) });
  assert.match(h, /<svg/);                          // the seal/logo
  assert.match(h, /Jane Reporter/);                 // recipient
  assert.match(h, /MELEK Academy/);
  assert.match(h, /window\.print\(\)/);             // print affordance
  assert.match(h, /@media print/);                  // print CSS
  assert.match(h, new RegExp('/credential/' + cred.id)); // verify URL by id on the paper
  assert.match(h, /Verify authenticity/);
  assert.match(h, /non-accredited/i);
});

test('routes: /credential and /certificate render 200 via ?c=', async () => {
  const c = b64(sampleCred());
  assert.equal((await route('/credential?c=' + encodeURIComponent(c))).statusCode, 200);
  assert.equal((await route('/certificate?c=' + encodeURIComponent(c))).statusCode, 200);
});

test('route: /credential/:id resolves via the registry', async () => {
  const reg = createRegistry();
  const r = reg.issue({ programId: 'ordination-minister', recipientName: 'Rev. A', now: new Date('2026-08-28') });
  __setRegistry(reg);
  const res = await route('/credential/' + r.credential.id);
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /GENUINE/);
  __setRegistry(null);
});

test('health + robots + llms respond', async () => {
  assert.equal((await route('/health')).body, 'ok');
  assert.match((await route('/robots.txt')).body, /User-agent|Sitemap/i);
  assert.match((await route('/llms.txt')).body, /MELEK Academy/);
});

test('unknown path redirects home', async () => {
  const res = await route('/nope');
  assert.equal(res.statusCode, 302);
});
