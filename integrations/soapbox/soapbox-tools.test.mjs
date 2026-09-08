import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOOLS, STATUS, tool, byStatus, live, blockers, statusLine, handler } from './soapbox-tools.mjs';

test('every tool declares a status from the enum', () => {
  const valid = Object.values(STATUS);
  for (const t of TOOLS) {
    assert.ok(valid.includes(t.status), `${t.id} has status ${t.status}`);
    assert.ok(t.name && t.blurb && t.why, `${t.id} is described`);
  }
});

test('a LIVE tool must carry the URL that proves it', () => {
  for (const t of byStatus(STATUS.LIVE)) {
    assert.match(t.url || '', /^https:\/\//, `${t.id} claims live without a URL`);
  }
  assert.ok(live().length >= 2);
});

test('anything not live must say what is stopping it', () => {
  for (const t of TOOLS) {
    if (t.status === STATUS.LIVE) continue;
    assert.ok(str(t.blockedOn).length > 20, `${t.id} is not live and does not say why`);
  }
  function str(v) { return String(v == null ? '' : v); }
});

test('statusLine never dresses a built tool up as a live one', () => {
  const fax = tool('soapbox-fax');
  assert.equal(fax.status, STATUS.BLOCKED);
  assert.match(statusLine(fax), /^SoapBox Fax: BLOCKED/);
  assert.ok(!statusLine(fax).includes('LIVE'));
  assert.match(statusLine(tool('soapbox-credentials')), /LIVE — https:/);
  assert.equal(statusLine(null), '');
});

test('SoapBox Fax is named, and points at the modules that implement it', () => {
  const t = tool('soapbox-fax');
  assert.equal(t.name, 'SoapBox Fax');
  assert.ok(t.modules.includes('soapbox/fax-system.mjs'));
  assert.ok(t.modules.includes('soapbox/fax-receipts.mjs'));
  assert.match(t.why, /552\.301\(a-1\)/, 'the statutory reason to fax is recorded');
});

test('hosting is flagged as the shared dependency it is', () => {
  const host = tool('soapbox-host');
  assert.match(host.blockedOn, /unblocks SoapBox Fax/);
  assert.match(tool('soapbox-fax').blockedOn, /hosted URL/);
});

test('the mail blocker records WHY the operator mailbox must not be the sender', () => {
  assert.match(tool('soapbox-mail').blockedOn, /legal correspondence/);
  assert.match(tool('soapbox-mail').blockedOn, /suspended/);
});

test('blockers groups and ranks by how many tools share one', () => {
  const b = blockers();
  assert.ok(b.length > 0);
  assert.ok(b.every((x) => x.tools.length >= 1));
  for (let i = 1; i < b.length; i += 1) {
    assert.ok(b[i - 1].tools.length >= b[i].tools.length, 'sorted most-shared first');
  }
});

test('unknown ids return null, not a guess', () => {
  assert.equal(tool('nope'), null);
  assert.equal(tool(''), null);
  assert.equal(byStatus('imaginary').length, 0);
});

test('handler lists the suite, one tool, and the blockers', () => {
  const call = (url) => {
    const res = { statusCode: 0, headers: {}, body: '',
      setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = b; } };
    handler({ url }, res);
    return { code: res.statusCode, json: JSON.parse(res.body) };
  };
  const all = call('/tools');
  assert.equal(all.json.suite, 'SoapBox Tools');
  assert.equal(all.json.tools.length, TOOLS.length);
  assert.ok(all.json.counts.live >= 2);

  assert.equal(call('/tools?id=soapbox-fax').json.tool.name, 'SoapBox Fax');
  assert.equal(call('/tools?id=nope').code, 404);
  assert.ok(call('/tools/blockers').json.blockers.length > 0);
});
