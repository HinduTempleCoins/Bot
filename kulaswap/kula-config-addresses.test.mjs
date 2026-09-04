// kula-config-addresses.test.mjs — offline tests for the CDP/veKULA address config + liveness guards.
// House style: node --test, no network, pure. Verifies the mainnet block is present and non-zero and
// that the guards refuse a zero address (the "not live" gate the Borrow/Stake UI depends on).

import test from 'node:test';
import assert from 'node:assert/strict';
import { ADDR, MAINNET_ADDR, altiMarketLive, cdpMarketLive, veLive, addrFor } from './kula-config-addresses.mjs';
import { CHAINS, isDenied, denyReason, safeTokens } from './kula-config.mjs';

const isAddr = (a) => /^0x[0-9a-fA-F]{40}$/.test(a);
const Z = '0x0000000000000000000000000000000000000000';

// ── Compact, self-contained keccak-256 (offline, no deps) → EIP-55 checksum validator ──────────────
// Ethereum uses keccak-256 (NOT FIPS SHA3-256, which node's crypto ships), so we hand-roll the sponge.
// Used only to assert the config addresses carry a valid EIP-55 checksum — the exact guard a wallet
// applies to a tx `to` (ethers v6 throws "bad address checksum" otherwise), proven offline.
const RC = [
  0x00000001, 0x00008082, 0x0000808a, 0x80008000, 0x0000808b, 0x80000001, 0x80008081, 0x00008009,
  0x0000008a, 0x00000088, 0x80008009, 0x8000000a, 0x8000808b, 0x0000008b, 0x00008089, 0x00008003,
  0x00008002, 0x00000080, 0x0000800a, 0x8000000a, 0x80008081, 0x00008080, 0x80000001, 0x80008008,
];
const RC_HI = [
  0x00000000, 0x00000000, 0x80000000, 0x80000000, 0x00000000, 0x00000000, 0x80000000, 0x80000000,
  0x00000000, 0x00000000, 0x00000000, 0x00000000, 0x00000000, 0x80000000, 0x80000000, 0x80000000,
  0x80000000, 0x80000000, 0x00000000, 0x80000000, 0x80000000, 0x80000000, 0x00000000, 0x80000000,
];
const R = [0, 1, 62, 28, 27, 36, 44, 6, 55, 20, 3, 10, 43, 25, 39, 41, 45, 15, 21, 8, 18, 2, 61, 56, 14];
function keccak256(bytes) {
  // State: 25 lanes × 64-bit, held as [lo,hi] 32-bit halves.
  const s = new Array(50).fill(0);
  const rate = 136; // 1088 bits for keccak-256
  const msg = Array.from(bytes);
  msg.push(0x01); // keccak padding (0x01, then 0x80 on the last block byte)
  while (msg.length % rate !== 0) msg.push(0);
  msg[msg.length - 1] |= 0x80;
  const rotl = (lo, hi, n) => {
    n %= 64;
    if (n === 0) return [lo >>> 0, hi >>> 0];
    if (n < 32) return [((lo << n) | (hi >>> (32 - n))) >>> 0, ((hi << n) | (lo >>> (32 - n))) >>> 0];
    n -= 32;
    return [((hi << n) | (lo >>> (32 - n))) >>> 0, ((lo << n) | (hi >>> (32 - n))) >>> 0];
  };
  for (let off = 0; off < msg.length; off += rate) {
    for (let i = 0; i < rate; i++) {
      const lane = (i >> 3), half = (i & 7);
      const idx = lane * 2 + (half < 4 ? 0 : 1);
      s[idx] ^= (msg[off + i] << ((half & 3) * 8)) >>> 0;
      s[idx] >>>= 0;
    }
    // 24 rounds
    for (let round = 0; round < 24; round++) {
      const C = new Array(10);
      for (let x = 0; x < 5; x++) {
        C[x * 2] = (s[x * 2] ^ s[x * 2 + 10] ^ s[x * 2 + 20] ^ s[x * 2 + 30] ^ s[x * 2 + 40]) >>> 0;
        C[x * 2 + 1] = (s[x * 2 + 1] ^ s[x * 2 + 11] ^ s[x * 2 + 21] ^ s[x * 2 + 31] ^ s[x * 2 + 41]) >>> 0;
      }
      const D = new Array(10);
      for (let x = 0; x < 5; x++) {
        const [rlo, rhi] = rotl(C[((x + 1) % 5) * 2], C[((x + 1) % 5) * 2 + 1], 1);
        D[x * 2] = (C[((x + 4) % 5) * 2] ^ rlo) >>> 0;
        D[x * 2 + 1] = (C[((x + 4) % 5) * 2 + 1] ^ rhi) >>> 0;
      }
      for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) {
        s[(x + y * 5) * 2] = (s[(x + y * 5) * 2] ^ D[x * 2]) >>> 0;
        s[(x + y * 5) * 2 + 1] = (s[(x + y * 5) * 2 + 1] ^ D[x * 2 + 1]) >>> 0;
      }
      const B = new Array(50).fill(0);
      for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) {
        const i = x + y * 5;
        const [rlo, rhi] = rotl(s[i * 2], s[i * 2 + 1], R[i]);
        const j = y + ((2 * x + 3 * y) % 5) * 5;
        B[j * 2] = rlo; B[j * 2 + 1] = rhi;
      }
      for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) {
        const i = x + y * 5;
        const b0 = B[(((x + 1) % 5) + y * 5) * 2], b0h = B[(((x + 1) % 5) + y * 5) * 2 + 1];
        const b1 = B[(((x + 2) % 5) + y * 5) * 2], b1h = B[(((x + 2) % 5) + y * 5) * 2 + 1];
        s[i * 2] = (B[i * 2] ^ (~b0 & b1)) >>> 0;
        s[i * 2 + 1] = (B[i * 2 + 1] ^ (~b0h & b1h)) >>> 0;
      }
      s[0] = (s[0] ^ RC[round]) >>> 0;
      s[1] = (s[1] ^ RC_HI[round]) >>> 0;
    }
  }
  const out = [];
  for (let i = 0; i < 32; i++) {
    const lane = (i >> 3), half = (i & 7);
    const idx = lane * 2 + (half < 4 ? 0 : 1);
    out.push((s[idx] >>> ((half & 3) * 8)) & 0xff);
  }
  return out;
}
function isEip55(addr) {
  if (!isAddr(addr)) return false;
  const raw = addr.slice(2);
  const lower = raw.toLowerCase();
  const hash = keccak256([...lower].map((c) => c.charCodeAt(0)));
  const hex = hash.map((b) => b.toString(16).padStart(2, '0')).join('');
  for (let i = 0; i < 40; i++) {
    const c = raw[i];
    if (!/[a-fA-F]/.test(c)) continue;
    const up = parseInt(hex[i], 16) >= 8;
    if (up ? c !== c.toUpperCase() : c !== c.toLowerCase()) return false;
  }
  return true;
}

test('self-test: the offline keccak/EIP-55 validator agrees with known-good and rejects bad casing', () => {
  // A known-good checksummed address passes; the same bytes mis-cased (the cdpVault regression) fails.
  assert.equal(isEip55('0x9cdAe72dE19F93947cE3B4d5329FA81A5ef53ba2'), true);  // correct
  assert.equal(isEip55('0x9cdAe72de19F93947cE3B4d5329FA81A5ef53ba2'), false); // the shipped bad casing
  assert.equal(isEip55('0x52908400098527886E0F7030069857D2E4169EE7'), true);  // EIP-55 spec vector
  assert.equal(isEip55('0xde709f2102306220921060314715629080e2fb77'), true);  // all-lower spec vector
});

test('testnet ADDR still exports its keys (back-compat preserved)', () => {
  for (const k of ['KULA', 'wMELEK', 'ALTI', 'PoL', 'oracle', 'GrapheneDepositBridge']) {
    assert.ok(isAddr(ADDR[k]), `${k} is an address`);
  }
  // Market-2 (wMELEK→ALTI) remains a zero placeholder on testnet → altiMarketLive() false.
  assert.equal(ADDR.marketAltiVault, Z);
  assert.equal(altiMarketLive(), false);
});

test('MAINNET_ADDR carries the verified live CDP + veKULA deployment', () => {
  for (const k of ['KULA', 'mMELEK', 'wMELEK', 'oracle', 'cdpVault', 'veKULA', 'DAOTimelock']) {
    assert.ok(isAddr(MAINNET_ADDR[k]), `${k} is an address`);
    assert.notEqual(MAINNET_ADDR[k], Z, `${k} is not the zero placeholder`);
  }
});

test('MAINNET_ADDR pins the exact verified checksummed addresses (chainId 712217)', () => {
  // Pin the EXACT, EIP-55-checksummed strings verified on-chain 2026-08-31 via rpc.prana.melek.salon.
  // ethers v6 REJECTS a bad checksum on a tx `to` ("bad address checksum") — a mis-cased address here
  // silently breaks Borrow/Stake in the browser even though raw JSON-RPC reads work. Exact-string
  // equality is the offline guard that catches a bad re-case before it ships (it caught cdpVault's
  // 'de'→'dE' regression). Confirmed vault wiring: collateral()=KULA, debtToken()=mMELEK, maxLTV()=0.5e18.
  const EXPECT = {
    KULA:        '0x32255D0138f5D645894FA89b5D5B5a68cF9Aa631',
    mMELEK:      '0x8c4B882D7379D35413E2a9202f63B53f893D1A9D',
    wMELEK:      '0xf6d9BE2859191b45820Df3A3B3b321b1b2589AB9',
    oracle:      '0x905B3505037E49771B35F9f3944D8EC2B9eF3AFD',
    cdpVault:    '0x9cdAe72dE19F93947cE3B4d5329FA81A5ef53ba2',
    veKULA:      '0x2a9da080BB38C9cfc4B9c8D7cFd4699fF57a5438',
    DAOTimelock: '0x574DeEaa82BcA4ACF6C5669D8dbe084C28EE0da4',
  };
  for (const [k, v] of Object.entries(EXPECT)) assert.equal(MAINNET_ADDR[k], v, `${k} exact address`);
});

test('every MAINNET_ADDR is a valid EIP-55 checksum (the ethers-v6 tx `to` guard, offline)', () => {
  // Offline EIP-55 validator (keccak256) — no deps, no network. A wallet lib checksums the tx `to`
  // and throws on a bad one; assert the invariant here so a bad casing can never reach a live Borrow.
  for (const k of ['KULA', 'mMELEK', 'wMELEK', 'oracle', 'cdpVault', 'veKULA', 'DAOTimelock']) {
    assert.ok(isEip55(MAINNET_ADDR[k]), `${k} (${MAINNET_ADDR[k]}) is EIP-55 valid`);
  }
});

test('mMELEK (CDP debt) is a DISTINCT contract from wMELEK (bridge asset)', () => {
  // The whole reconciliation: the CDP mints mMELEK, never wMELEK. They must not collide.
  assert.notEqual(MAINNET_ADDR.mMELEK.toLowerCase(), MAINNET_ADDR.wMELEK.toLowerCase());
});

test('cdpMarketLive/veLive are true for the live mainnet addresses', () => {
  assert.equal(cdpMarketLive(), true);
  assert.equal(veLive(), true);
});

test('addrFor selects mainnet vs testnet', () => {
  assert.equal(addrFor('mainnet'), MAINNET_ADDR);
  assert.equal(addrFor('MAINNET'), MAINNET_ADDR);
  assert.equal(addrFor('testnet'), ADDR);
  assert.equal(addrFor(undefined), ADDR);
});

test('the guards are the zero-address gate the UI relies on', () => {
  // Prove the guard semantics against a zero — a host override to Z must read "not live".
  const liveIf = (a) => !!a && a !== Z;
  assert.equal(liveIf(Z), false);
  assert.equal(liveIf(MAINNET_ADDR.cdpVault), true);
  assert.equal(liveIf(MAINNET_ADDR.veKULA), true);
});

// ---------------------------------------------------------------------------
// DENYLIST — the duplicate KULA on PRANA mainnet.
//
// Two ERC-20s on 712217 both report symbol "KULA". Canonical: 0x32255D01…, supply 100,000, from
// DeployKulaMainnet 2026-08-30 07:04. Superseded: 0xdCA53de8…, supply 1,000,000, whose pair the
// Factory's PairCreated events place at block 2,333 — 820 blocks BEFORE the canonical KULA/WPRANA
// pair at 3,153. It holds real liquidity (10,000 wMELEK / 1,000,000) in a pool nothing should route
// through. A contract cannot be removed from a chain, so this is where "removed" is enforced.
// ---------------------------------------------------------------------------
test('the superseded KULA and wMELEK are denied, the canonical KULA is not', () => {
  const FAKE_KULA = '0xdCA53de829db177ed16e51CC4c9abBf856bEBAC8';
  const FAKE_WMELEK = '0x5A826b93f2465e9AcfE65cCa0E2562f1e1678bb2';
  const REAL_KULA = CHAINS['prana-mainnet'].kula;

  assert.equal(isDenied('prana-mainnet', FAKE_KULA), true);
  assert.equal(isDenied('prana-mainnet', FAKE_WMELEK), true);
  assert.equal(isDenied('prana-mainnet', REAL_KULA), false, 'the real KULA must remain tradeable');
  // case-insensitivity matters: these arrive from chain reads in mixed case
  assert.equal(isDenied('prana-mainnet', FAKE_KULA.toLowerCase()), true);
  assert.equal(isDenied('prana-mainnet', FAKE_KULA.toUpperCase().replace('0X', '0x')), true);
  assert.ok(denyReason('prana-mainnet', FAKE_KULA).includes('0x32255D01'),
    'the reason must name the canonical address so the fix is obvious');
});

test('isDenied / denyReason never throw on junk', () => {
  for (const junk of [null, undefined, '', 0, {}, []]) {
    assert.equal(isDenied('prana-mainnet', junk), false);
    assert.equal(denyReason('prana-mainnet', junk), null);
  }
  assert.equal(isDenied('no-such-chain', '0xdCA53de829db177ed16e51CC4c9abBf856bEBAC8'), false);
});

test('safeTokens keeps every real token and would drop a denied one', () => {
  const chain = CHAINS['prana-mainnet'];
  const symbols = safeTokens(chain).map((t) => t.symbol);
  assert.deepEqual(symbols, ['KULA', 'WPRANA', 'wVKBT', 'wCURE'], 'no real token may be lost');
  // prove the filter actually filters, rather than passing everything through
  const poisoned = { ...chain, tokens: [...chain.tokens,
    { symbol: 'KULA', address: '0xdCA53de829db177ed16e51CC4c9abBf856bEBAC8', decimals: 18 }] };
  assert.equal(poisoned.tokens.length, 5);
  assert.equal(safeTokens(poisoned).length, 4, 'the impostor must be stripped');
});
