import test from 'node:test';
import assert from 'node:assert/strict';
import { handler, SITEMAP_PATHS, tiersPage, faxPage, faxCostPage } from './server.mjs';

const call = (path) => new Promise((resolve) => {
  const c = [];
  const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    end(b) { c.push(b ?? ''); resolve({ status: this.statusCode, body: c.join('') }); } };
  handler({ url: path, method: 'GET' }, res);
});

test('every sitemap path renders 200 and the sitemap is the real route list', async () => {
  for (const p of SITEMAP_PATHS) assert.equal((await call(p)).status, 200, p);
  const sm = await call('/sitemap.xml');
  assert.equal((sm.body.match(/<loc>/g) || []).length, SITEMAP_PATHS.length);
});

test('unknown routes 404', async () => {
  for (const p of ['/stacks/nope', '/nothing']) assert.equal((await call(p)).status, 404, p);
});

test('the regulatory cliff is stated on the phone page, not buried', async () => {
  const html = (await call('/')).body;
  assert.match(html, /interconnected VoIP/i);
  assert.match(html, /E911/);
  assert.match(html, /App-to-app calling triggers none of it/i);
});

test('app-to-app answers "no obligations"; a PSTN architecture answers "resell"', () => {
  const app = tiersPage('members call each other in the app');
  assert.match(app, /No carrier obligations attach/i);
  const pstn = tiersPage('real phone numbers, dial out to landlines');
  assert.match(pstn, /resell/i);
  assert.match(pstn, /CALEA/);
});

test('fax page says the transmission report is the product and excludes the ad-supported one', async () => {
  const html = (await call('/fax')).body;
  assert.match(html, /report IS the product/i);
  assert.match(html, /advertisement on the cover page/i);
  assert.match(html, /Twilio/);          // dead provider recorded, not omitted
});

test('an evidentiary fax excludes FaxZero WITH the reason; an errand does not', () => {
  const filing = faxCostPage({ pages: 3, evidentiary: '1' });
  assert.match(filing, /Excluded because this is a filing/i);
  assert.match(filing, /faxzero/i);
  assert.match(filing, /transmission report belongs to the service/i);
  const errand = faxCostPage({ pages: 3, evidentiary: '0' });
  assert.doesNotMatch(errand, /Excluded because this is a filing/i);
});

test('the fax book carries the gotcha that makes each entry necessary', async () => {
  const html = (await call('/fax/book')).body;
  assert.match(html, /NEVER EMAIL/);                 // tx-bar-cdc
  assert.match(html, /is the CITY of Dallas/);       // the county/city portal trap
});

test('hostile query is escaped', async () => {
  const r = await call('/tiers?arch=%3Cscript%3Ealert(1)%3C%2Fscript%3E');
  assert.ok(!r.body.includes('<script>alert(1)'));
});
