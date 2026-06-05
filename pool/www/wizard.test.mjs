// Tests for the pool "Start Mining" config generator (pool/www/wizard.mjs).
// Run: node --test pool/www/wizard.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  COINS, MINERS, resolveCoin, validateAddress, genConfig, genStartScripts,
  genOneLiners, genEthCommand, genPhone, genQrPayload, PHONE_WARNING, IOS_NOTE,
} from './wizard.mjs';

// A real (zero-value) Monero stagenet-style address shape: 95 base58 chars starting 5/7.
const XMR_STAGENET = '57kYk4iMy9SCMyeRctNW6QUpCVKnRp1682BiYnxUqMVDjhAVABfQJbUTC5oTvfRruNVVxqGK6MEz3QoQLnV2NPGxBArv9Kz';
const EVM = '0xaA0c07a11e4aE6fbe201C7EBE061A86A296f08ab';
const HOST = 'pool.soapbox.community';

test('resolveCoin matches by key, pool id, and symbol', () => {
  assert.equal(resolveCoin('monero').symbol, 'XMR');
  assert.equal(resolveCoin('xmr-stagenet').symbol, 'XMR');
  assert.equal(resolveCoin('XMR').symbol, 'XMR');
  assert.equal(resolveCoin('etc-mordor').symbol, 'ETC');
  assert.equal(resolveCoin('nope'), null);
});

test('validateAddress — Monero accepts valid, rejects junk', () => {
  assert.equal(validateAddress('monero', XMR_STAGENET).ok, true);
  assert.equal(validateAddress('monero', '').ok, false);
  assert.equal(validateAddress('monero', 'too-short').ok, false);
  // wrong leading char
  assert.equal(validateAddress('monero', '1' + XMR_STAGENET.slice(1)).ok, false);
  // illegal base58 char (0)
  assert.equal(validateAddress('monero', '50' + XMR_STAGENET.slice(2)).ok, false);
  // wrong length
  assert.equal(validateAddress('monero', XMR_STAGENET.slice(0, 90)).ok, false);
});

test('validateAddress — EVM (ETC) accepts 0x40hex, rejects others', () => {
  assert.equal(validateAddress('ethereum_classic', EVM).ok, true);
  assert.equal(validateAddress('ethereum_classic', '0x123').ok, false);
  assert.equal(validateAddress('ethereum_classic', XMR_STAGENET).ok, false);
  assert.equal(validateAddress('ethereum_classic', EVM.replace('0x', '')).ok, false);
});

test('genConfig produces a valid xmrig config shape with address + pool baked in', () => {
  const cfg = genConfig({ coin: 'monero', address: XMR_STAGENET, host: HOST, port: 4444, worker: 'phone1' });
  assert.equal(cfg.pools.length, 1);
  const p = cfg.pools[0];
  assert.equal(p.url, `${HOST}:4444`);
  assert.equal(p.user, XMR_STAGENET);
  assert.equal(p.pass, 'phone1');
  assert.equal(p.algo, 'rx/0');
  assert.equal(p.coin, 'monero');
  assert.equal(cfg['donate-level'], 0); // no forced donation
  assert.equal(typeof cfg.cpu, 'object');
  // round-trips as JSON (it's what we hand the user as config.json)
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(cfg)));
});

test('genConfig sanitizes a malicious worker name', () => {
  const cfg = genConfig({ coin: 'monero', address: XMR_STAGENET, host: HOST, port: 4444, worker: 'a;rm -rf /' });
  assert.match(cfg.pools[0].pass, /^[A-Za-z0-9_-]+$/);
});

test('genConfig rejects non-RandomX coins', () => {
  assert.throws(() => genConfig({ coin: 'ethereum_classic', address: EVM, host: HOST, port: 5550 }));
});

test('genStartScripts — windows .bat and posix .sh', () => {
  const bat = genStartScripts({ platform: 'windows' });
  assert.match(bat, /xmrig\.exe --config=config\.json/);
  assert.match(bat, /\r\n/); // CRLF for windows
  const sh = genStartScripts({ platform: 'linux' });
  assert.match(sh, /^#!\/bin\/sh/);
  assert.match(sh, /\.\/xmrig --config=config\.json/);
});

test('genOneLiners — pins official upstream URL + SHA256, verifies before run', () => {
  const o = genOneLiners({ coin: 'monero', address: XMR_STAGENET, host: HOST, port: 4444, worker: 'w' });
  assert.equal(o.miner, 'xmrig');
  // upstream github, not rehosted
  assert.match(o.powershell, /github\.com\/xmrig\/xmrig\/releases\/download/);
  assert.match(o.sh, /github\.com\/xmrig\/xmrig\/releases\/download/);
  // SHA256 present and checked
  assert.match(o.powershell, new RegExp(MINERS.xmrig.assets['windows-x64'].sha256.toUpperCase()));
  assert.match(o.powershell, /SHA256 mismatch/);
  assert.match(o.sh, new RegExp(MINERS.xmrig.assets['linux-x64'].sha256));
  assert.match(o.sh, /sha256sum -c/);
  // address baked in
  assert.match(o.sh, new RegExp(XMR_STAGENET));
});

test('genEthCommand — ready GPU invocation for Etchash, null for RandomX', () => {
  const e = genEthCommand({ coin: 'ethereum_classic', address: EVM, host: HOST, port: 5550, worker: 'g1' });
  assert.match(e.lolminer, /--algo ETCHASH/);
  assert.match(e.lolminer, new RegExp(`${EVM}\\.g1`));
  assert.match(e.ethminer, /stratum1\+tcp/);
  assert.equal(genEthCommand({ coin: 'monero', address: XMR_STAGENET, host: HOST, port: 4444 }), null);
});

test('genPhone — Monero is phone-ready, ETC is not', () => {
  const p = genPhone({ coin: 'monero', address: XMR_STAGENET, host: HOST, port: 4444, worker: 'pho' });
  assert.equal(p.supported, true);
  assert.equal(p.os, 'android');
  assert.ok(p.steps.length >= 3);
  assert.ok(p.warning.includes('plugged'));
  // QR payload equals the command and is a self-contained xmrig line
  assert.equal(p.qrPayload, p.command);
  assert.match(p.qrPayload, /^xmrig -o/);

  const etc = genPhone({ coin: 'ethereum_classic', address: EVM, host: HOST, port: 5550 });
  assert.equal(etc.supported, false);
  assert.match(etc.reason, /GPU/);
});

test('genQrPayload — compact, self-contained, address + pool baked in, RandomX only', () => {
  const qr = genQrPayload({ coin: 'monero', address: XMR_STAGENET, host: HOST, port: 4444, worker: 'q' });
  assert.match(qr, new RegExp(`-o ${HOST}:4444`));
  assert.match(qr, new RegExp(`-u ${XMR_STAGENET}`));
  assert.match(qr, /-a rx\/0/);
  assert.match(qr, /--coin=monero/);
  assert.match(qr, /-t 2/); // low thread count for a phone
  // stays reasonably short for QR density
  assert.ok(qr.length < 220, `QR payload too long: ${qr.length}`);
  // not allowed for GPU coins
  assert.throws(() => genQrPayload({ coin: 'ethereum_classic', address: EVM, host: HOST, port: 5550 }));
});

test('honesty copy exists and is non-trivial', () => {
  assert.ok(PHONE_WARNING.length > 120);
  assert.match(PHONE_WARNING, /participation, not profit/);
  assert.match(IOS_NOTE, /not practically minable/i);
});

test('pinned miner metadata is internally consistent', () => {
  assert.equal(MINERS.xmrig.version, '6.26.0');
  for (const a of Object.values(MINERS.xmrig.assets)) {
    assert.match(a.url, /^https:\/\/github\.com\/xmrig\/xmrig\/releases\/download\//);
    assert.match(a.sha256, /^[0-9a-f]{64}$/);
  }
  assert.match(MINERS.lolminer.assets['windows-x64'].url, /Lolliedieb\/lolMiner-releases/);
});
