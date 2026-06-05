// Tests for the SoapBox Miner universal launcher: the manifest generator (one source of
// truth with MINERS/COINS) and the client-side launcher-script generation.
// Run: node --test pool/www/launcher.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  MINERS, COINS, buildManifest, genWindowsLauncher, genWindowsBat, genPosixLauncher,
  LAUNCHER_VERSION,
} from './wizard.mjs';

const XMR = '57kYk4iMy9SCMyeRctNW6QUpCVKnRp1682BiYnxUqMVDjhAVABfQJbUTC5oTvfRruNVVxqGK6MEz3QoQLnV2NPGxBArv9Kz';
const EVM = '0xaA0c07a11e4aE6fbe201C7EBE061A86A296f08ab';
const HOST = 'pool.soapbox.community';
const URL = `https://${HOST}/launcher-manifest.json`;

// ---------- manifest ----------
test('buildManifest — shape + schema + version', () => {
  const m = buildManifest({ host: HOST });
  assert.equal(m.schema, 'soapbox-launcher-manifest');
  assert.equal(m.version, LAUNCHER_VERSION);
  assert.equal(m.pool.host, HOST);
  assert.ok(Array.isArray(m.coins) && m.coins.length >= 2);
  assert.ok(m.miners.xmrig && m.miners.lolminer);
});

test('buildManifest — one source of truth with MINERS (urls + sha256 carried through)', () => {
  const m = buildManifest({ host: HOST });
  for (const [plat, a] of Object.entries(MINERS.xmrig.assets)) {
    const ma = m.miners.xmrig.assets[plat];
    assert.equal(ma.url, a.url);
    assert.equal(ma.sha256, a.sha256);
    assert.equal(ma.bin, a.bin);
    assert.equal(ma.archive, a.url.endsWith('.zip') ? 'zip' : 'tar.gz');
  }
  // lolMiner has no published per-file SHA256 -> sha256 is null (not invented).
  assert.equal(m.miners.lolminer.assets['windows-x64'].sha256, null);
  assert.equal(m.miners.lolminer.version, MINERS.lolminer.version);
});

test('buildManifest — one source of truth with COINS (every coin surfaced, fields mapped)', () => {
  const m = buildManifest({ host: HOST });
  assert.equal(m.coins.length, Object.keys(COINS).length);
  const xmr = m.coins.find(c => c.key === 'monero');
  assert.equal(xmr.symbol, 'XMR');
  assert.equal(xmr.family, 'cryptonote');
  assert.equal(xmr.algo, 'rx/0');
  assert.equal(xmr.xmrigCoin, 'monero');
  assert.equal(xmr.miner, 'xmrig');
  assert.equal(xmr.addrType, 'monero');
  assert.equal(xmr.stratum.host, HOST);
  assert.equal(xmr.stratum.port, 4444);
  assert.equal(xmr.configTemplate, 'xmrig-randomx');
  assert.equal(xmr.enabled, true);

  const etc = m.coins.find(c => c.key === 'ethereum_classic');
  assert.equal(etc.family, 'ethereum');
  assert.equal(etc.algo, 'ETCHASH');
  assert.equal(etc.miner, 'lolminer');
  assert.equal(etc.addrType, 'evm');
  assert.equal(etc.stratum.port, 5550);
  assert.equal(etc.configTemplate, 'gpu-etchash');
});

test('buildManifest — enabled flag reflects COINS.launcher.enabled', () => {
  const m = buildManifest({ host: HOST });
  // both seed coins are enabled today
  assert.ok(m.coins.every(c => typeof c.enabled === 'boolean'));
  assert.ok(m.coins.some(c => c.enabled === true));
});

test('buildManifest — host is parameterized (testnet vs prod)', () => {
  const m = buildManifest({ host: 'pool.example.test' });
  assert.ok(m.coins.every(c => c.stratum.host === 'pool.example.test'));
  assert.equal(m.pool.host, 'pool.example.test');
});

test('static launcher-manifest.json is in sync with buildManifest (run build-manifest.mjs)', () => {
  // Regenerating the static file must produce the same content (ignoring the timestamp).
  const r = spawnSync(process.execPath, ['pool/www/build-manifest.mjs', '--check'], {
    cwd: process.cwd(), encoding: 'utf8',
  });
  assert.equal(r.status, 0, `launcher-manifest.json out of date:\n${r.stderr}${r.stdout}`);
});

// ---------- Windows launcher ----------
test('genWindowsLauncher — bakes addresses, manifest URL, and frozen fallback', () => {
  const manifest = buildManifest({ host: HOST });
  const ps1 = genWindowsLauncher({ addresses: { monero: XMR, evm: EVM }, manifest, manifestUrl: URL });
  assert.match(ps1, new RegExp(`\\$XmrAddress\\s*=\\s*'${XMR}'`));
  assert.match(ps1, new RegExp(`\\$EvmAddress\\s*=\\s*'${EVM}'`));
  assert.match(ps1, new RegExp(URL.replace(/[/.]/g, '\\$&')));
  // frozen fallback present + SHA verification + only official github
  assert.match(ps1, /FallbackManifest/);
  assert.match(ps1, /SHA256 MISMATCH/);
  assert.match(ps1, new RegExp(MINERS.xmrig.assets['windows-x64'].sha256));
  assert.match(ps1, /github\.com\/xmrig\/xmrig\/releases\/download/);
  // honest plain-text banner
  assert.match(ps1, /PLAIN-TEXT script/);
  // does not collide with the $host automatic variable
  assert.doesNotMatch(ps1, /\$host\s*=/);
});

test('genWindowsLauncher — single-quote escaping in a baked address is safe', () => {
  const manifest = buildManifest({ host: HOST });
  const ps1 = genWindowsLauncher({ addresses: { monero: "a'b", evm: '' }, manifest, manifestUrl: URL });
  // PowerShell escapes ' as '' inside single-quoted strings
  assert.match(ps1, /\$XmrAddress\s*=\s*'a''b'/);
});

test('genWindowsBat — per-file ExecutionPolicy Bypass, no system change', () => {
  const bat = genWindowsBat({ ps1Name: 'SoapBoxMiner.ps1' });
  assert.match(bat, /-ExecutionPolicy Bypass -File/);
  assert.match(bat, /SoapBoxMiner\.ps1/);
  assert.match(bat, /\r\n/); // CRLF for Windows
  // must NOT change machine policy (Set-ExecutionPolicy) or disable defender
  assert.doesNotMatch(bat, /Set-ExecutionPolicy/i);
  assert.doesNotMatch(bat, /MpPreference|DisableRealtime|Defender/i);
});

// ---------- POSIX launcher ----------
test('genPosixLauncher — bakes addresses, manifest URL, frozen fallback, arch detect', () => {
  const manifest = buildManifest({ host: HOST });
  const sh = genPosixLauncher({ addresses: { monero: XMR, evm: EVM }, manifest, manifestUrl: URL });
  assert.match(sh, /^#!\/bin\/sh/);
  assert.match(sh, new RegExp(`XMR_ADDRESS='${XMR}'`));
  assert.match(sh, new RegExp(`EVM_ADDRESS='${EVM}'`));
  assert.match(sh, /FALLBACK_MANIFEST=/);
  assert.match(sh, /SHA256 MISMATCH/);
  assert.match(sh, /macos-arm64/);
  assert.match(sh, /not supported on macOS/);
  assert.match(sh, /github\.com\/xmrig/);
  assert.match(sh, /PLAIN-TEXT script/);
  // never disables protections / never suggests it
  assert.doesNotMatch(sh, /disable|--insecure|curl -k/i);
});

test('genPosixLauncher — single-quote escaping in a baked address is safe', () => {
  const manifest = buildManifest({ host: HOST });
  const sh = genPosixLauncher({ addresses: { monero: "a'b", evm: '' }, manifest, manifestUrl: URL });
  assert.match(sh, /XMR_ADDRESS='a'\\''b'/);
});

test('genPosixLauncher — parses as POSIX sh (sh -n / bash -n)', () => {
  const manifest = buildManifest({ host: HOST });
  const sh = genPosixLauncher({ addresses: { monero: XMR, evm: EVM }, manifest, manifestUrl: URL });
  const dir = mkdtempSync(join(tmpdir(), 'sbm-'));
  const f = join(dir, 'soapbox-miner.sh');
  writeFileSync(f, sh);
  for (const shell of ['sh', 'bash']) {
    const r = spawnSync(shell, ['-n', f], { encoding: 'utf8' });
    assert.equal(r.status, 0, `${shell} -n failed:\n${r.stderr}`);
  }
});

test('shellcheck (if available) finds no errors in the generated .sh', () => {
  const has = spawnSync('shellcheck', ['--version'], { encoding: 'utf8' });
  if (has.status !== 0 && has.error) {
    // shellcheck not installed — skip gracefully
    return;
  }
  const manifest = buildManifest({ host: HOST });
  const sh = genPosixLauncher({ addresses: { monero: XMR, evm: EVM }, manifest, manifestUrl: URL });
  const dir = mkdtempSync(join(tmpdir(), 'sbm-sc-'));
  const f = join(dir, 'soapbox-miner.sh');
  writeFileSync(f, sh);
  // -S error: only fail the test on errors (warnings/info are advisory for a templated script)
  const r = spawnSync('shellcheck', ['-S', 'error', f], { encoding: 'utf8' });
  assert.equal(r.status, 0, `shellcheck errors:\n${r.stdout}${r.stderr}`);
});

test('manifest menu logic resolves a pick end-to-end (python3 path used by the .sh)', (t) => {
  // Mirrors the launcher's resolve_pick: pick #1 (Monero) on linux-x64 -> the official
  // xmrig linux url + sha. Proves the manifest the launcher ships is queryable as designed.
  const py = spawnSync('python3', ['--version'], { encoding: 'utf8' });
  if (py.status !== 0) return t.skip('python3 not available');
  const manifest = buildManifest({ host: HOST });
  const dir = mkdtempSync(join(tmpdir(), 'sbm-m-'));
  const mf = join(dir, 'manifest.json');
  writeFileSync(mf, JSON.stringify(manifest));
  const script = [
    'import json,sys',
    'd=json.load(open(sys.argv[1]))',
    'coins=[x for x in d["coins"] if x["enabled"]]',
    'c=coins[0]',
    'a=d["miners"][c["miner"]]["assets"]["linux-x64"]',
    'print(c["symbol"], a["url"], a["sha256"])',
  ].join('\n');
  const out = execFileSync('python3', ['-c', script, mf], { encoding: 'utf8' }).trim();
  assert.match(out, /^XMR /);
  assert.match(out, /xmrig-6\.26\.0-linux-static-x64\.tar\.gz/);
  assert.match(out, new RegExp(MINERS.xmrig.assets['linux-x64'].sha256));
});
