// SoapBox Mining Pool — "Start Mining" config generator (done-for-them setup).
//
// Pure, dependency-free ESM so it runs identically in the browser (the wizard UI imports
// it) and under `node --test` (the generator tests import it). NO node-only APIs, NO
// network, NO secrets. All address handling is client-side: the user's address never
// leaves their machine — the pool only ever sees it as the stratum username when their
// miner connects.
//
// What it produces, per coin + hardware choice:
//   - genConfig()    -> the xmrig config.json object (RandomX coins)
//   - genStartScripts() -> start.bat / start.sh contents (address baked in)
//   - genOneLiners() -> copy-paste PowerShell + Linux/Mac one-liners that download the
//                       OFFICIAL pinned upstream miner release (never rehosted) + run it
//   - genEthCommand()-> the ready GPU miner invocation for Etchash coins
//   - genQrPayload() -> compact text payload for the phone-mining QR code
//   - validateAddress() -> per-coin address sanity check
//
// Upstream releases are PINNED here (exact version + URL + SHA256 from the upstream
// release page) so the one-liners are reproducible and we never rehost a binary.

// ---------------------------------------------------------------------------
// Pinned upstream miner releases (verify SHA256 against the upstream release page).
// xmrig:   https://github.com/xmrig/xmrig/releases/tag/v6.26.0  (SHA256SUMS asset)
// lolMiner:https://github.com/Lolliedieb/lolMiner-releases/releases/tag/1.98a
// ---------------------------------------------------------------------------
export const MINERS = {
  xmrig: {
    version: '6.26.0',
    repo: 'https://github.com/xmrig/xmrig',
    releasePage: 'https://github.com/xmrig/xmrig/releases/tag/v6.26.0',
    assets: {
      'windows-x64': {
        url: 'https://github.com/xmrig/xmrig/releases/download/v6.26.0/xmrig-6.26.0-windows-x64.zip',
        sha256: 'bba8097cb37d9b458a1cb1137876b27cde6740d17fe4ccbc086ba07d87d9e147',
        bin: 'xmrig.exe',
      },
      'linux-x64': {
        url: 'https://github.com/xmrig/xmrig/releases/download/v6.26.0/xmrig-6.26.0-linux-static-x64.tar.gz',
        sha256: 'fc6f8ae5f64e4f17481f7e3be29a1c56949f216a998414188003eae1db20c9e5',
        bin: 'xmrig',
      },
      'macos-arm64': {
        url: 'https://github.com/xmrig/xmrig/releases/download/v6.26.0/xmrig-6.26.0-macos-arm64.tar.gz',
        sha256: '6ae4eb4216e99a201ae9a3d2c3a7c275207c5165cfc25da1f3d735d6c4829c18',
        bin: 'xmrig',
      },
      'macos-x64': {
        url: 'https://github.com/xmrig/xmrig/releases/download/v6.26.0/xmrig-6.26.0-macos-x64.tar.gz',
        sha256: '1da924b358c0089e361540c4a9e6f8b09538b29efeafa2379590e0f6db358ff4',
        bin: 'xmrig',
      },
    },
    // Termux/Android: xmrig ships no prebuilt Linux-ARM binary, so on-phone we install
    // from the Termux package repo (built for ARM) rather than downloading a release.
    termuxPackage: 'xmrig',
  },
  lolminer: {
    version: '1.98a',
    repo: 'https://github.com/Lolliedieb/lolMiner-releases',
    releasePage: 'https://github.com/Lolliedieb/lolMiner-releases/releases/tag/1.98a',
    assets: {
      'windows-x64': {
        url: 'https://github.com/Lolliedieb/lolMiner-releases/releases/download/1.98a/lolMiner_v1.98a_Win64.zip',
        bin: 'lolMiner.exe',
      },
      'linux-x64': {
        url: 'https://github.com/Lolliedieb/lolMiner-releases/releases/download/1.98a/lolMiner_v1.98a_Lin64.tar.gz',
        bin: '1.98a/lolMiner',
      },
    },
  },
};

// ---------------------------------------------------------------------------
// Coin profiles. `family` mirrors the frontend's familyOf(): cryptonote => RandomX/xmrig,
// ethereum => Etchash/GPU miner. `addr` is the validation profile.
// ---------------------------------------------------------------------------
export const COINS = {
  monero: {
    id: 'xmr-stagenet', symbol: 'XMR', name: 'Monero', family: 'cryptonote',
    algo: 'rx/0', xmrigCoin: 'monero',
    // Monero standard addr = base58, 95 chars starting '4'; stagenet starts '5'/'7';
    // integrated = 106 chars. Accept the common mainnet(4)/stagenet(5,7) prefixes.
    addr: { type: 'monero' },
    walletHelp: 'https://www.getmonero.org/downloads/',
    phoneReady: true,
  },
  ethereum_classic: {
    id: 'etc-mordor', symbol: 'ETC', name: 'Ethereum Classic', family: 'ethereum',
    algo: 'ETCHASH',
    addr: { type: 'evm' },
    walletHelp: 'https://ethereumclassic.org/use/wallets',
    phoneReady: false,
  },
};

// Resolve a coin profile from either a coins-key, an /api/pools id, or a symbol.
export function resolveCoin(key) {
  if (!key) return null;
  const k = String(key).toLowerCase();
  if (COINS[k]) return COINS[k];
  for (const c of Object.values(COINS)) {
    if (c.id.toLowerCase() === k || c.symbol.toLowerCase() === k) return c;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Address validation (best-effort, client-side; the pool re-checks at connect).
// ---------------------------------------------------------------------------
export function validateAddress(coin, address) {
  const c = typeof coin === 'string' ? resolveCoin(coin) : coin;
  const a = (address || '').trim();
  if (!c) return { ok: false, reason: 'unknown coin' };
  if (!a) return { ok: false, reason: 'empty address' };

  if (c.addr.type === 'evm') {
    if (!/^0x[0-9a-fA-F]{40}$/.test(a)) {
      return { ok: false, reason: 'expected a 0x… Ethereum-style address (42 chars)' };
    }
    return { ok: true };
  }

  if (c.addr.type === 'monero') {
    // base58 alphabet (no 0 O I l), standard 95 / integrated 106 chars.
    if (!/^[1-9A-HJ-NP-Za-km-z]+$/.test(a)) {
      return { ok: false, reason: 'contains characters not in the Monero base58 set' };
    }
    if (a.length !== 95 && a.length !== 106) {
      return { ok: false, reason: 'a Monero address is 95 chars (or 106 if integrated)' };
    }
    // mainnet std '4', integrated '4'; stagenet std '5', subaddr '7'.
    if (!/^[457]/.test(a)) {
      return { ok: false, reason: 'a Monero address starts with 4 (mainnet) or 5/7 (stagenet)' };
    }
    return { ok: true };
  }

  return { ok: true };
}

const sanitizeWorker = (w) => (String(w || 'worker1').replace(/[^A-Za-z0-9_-]/g, '') || 'worker1').slice(0, 32);

// ---------------------------------------------------------------------------
// xmrig config.json (RandomX coins). Shape matches xmrig's documented config schema.
// ---------------------------------------------------------------------------
export function genConfig({ coin, address, host, port, worker = 'worker1', tls = false }) {
  const c = typeof coin === 'string' ? resolveCoin(coin) : coin;
  if (!c || c.family !== 'cryptonote') throw new Error('genConfig is for RandomX/cryptonote coins');
  return {
    autosave: true,
    cpu: { enabled: true, 'huge-pages': true, 'max-threads-hint': 75 },
    'donate-level': 0,
    pools: [
      {
        algo: c.algo,
        coin: c.xmrigCoin || null,
        url: `${host}:${port}`,
        user: address,
        pass: sanitizeWorker(worker),
        'rig-id': sanitizeWorker(worker),
        keepalive: true,
        tls: !!tls,
      },
    ],
  };
}

// start.sh / start.bat content (miner binary + generated config in the same folder).
export function genStartScripts({ platform, minerBin = 'xmrig' }) {
  const bin = minerBin;
  if (platform === 'windows') {
    return [
      '@echo off',
      'REM SoapBox Mining Pool — generated launcher. Keep config.json beside this file.',
      `${bin}.exe --config=config.json`,
      'pause',
    ].join('\r\n') + '\r\n';
  }
  return [
    '#!/bin/sh',
    '# SoapBox Mining Pool — generated launcher. Keep config.json beside this file.',
    `exec ./${bin} --config=config.json`,
    '',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Copy-paste one-liners: download the OFFICIAL pinned upstream release, verify the
// SHA256, unpack, drop in the generated config, and run. Never rehosts a binary.
// ---------------------------------------------------------------------------
export function genOneLiners({ coin, address, host, port, worker = 'worker1' }) {
  const c = typeof coin === 'string' ? resolveCoin(coin) : coin;
  if (!c || c.family !== 'cryptonote') return null;
  const w = sanitizeWorker(worker);

  const win = MINERS.xmrig.assets['windows-x64'];
  const lin = MINERS.xmrig.assets['linux-x64'];

  // Windows PowerShell. Verifies SHA256 against the pinned upstream hash before running.
  const powershell =
    `# SoapBox: official xmrig v${MINERS.xmrig.version} (verified by SHA256), then mine ${c.symbol}\n` +
    `$u='${win.url}'; $z="$env:TEMP\\xmrig.zip"; Invoke-WebRequest $u -OutFile $z; ` +
    `if((Get-FileHash $z -Algorithm SHA256).Hash -ne '${win.sha256.toUpperCase()}'){throw 'SHA256 mismatch — do not run'}; ` +
    `Expand-Archive $z "$env:TEMP\\xmrig" -Force; ` +
    `& (Get-ChildItem "$env:TEMP\\xmrig" -Recurse -Filter xmrig.exe)[0].FullName ` +
    `-o ${host}:${port} -u ${address} -p ${w} -a ${c.algo} --coin=${c.xmrigCoin}`;

  // Linux/Mac. Detects arch for the Mac case is left to the download page; the static
  // x64 build covers most Linux. SHA256 verified before extraction/run.
  const sh =
    `# SoapBox: official xmrig v${MINERS.xmrig.version} (verified by SHA256), then mine ${c.symbol}\n` +
    `curl -fsSL -o /tmp/xmrig.tgz ${lin.url} && ` +
    `echo "${lin.sha256}  /tmp/xmrig.tgz" | sha256sum -c - && ` +
    `tar xzf /tmp/xmrig.tgz -C /tmp && ` +
    `"$(find /tmp -name xmrig -type f | head -1)" ` +
    `-o ${host}:${port} -u ${address} -p ${w} -a ${c.algo} --coin=${c.xmrigCoin}`;

  return { powershell, sh, miner: 'xmrig', version: MINERS.xmrig.version };
}

// ---------------------------------------------------------------------------
// Etchash / Ethereum-family: ready GPU miner invocation (lolMiner + ethminer fallback).
// ---------------------------------------------------------------------------
export function genEthCommand({ coin, address, host, port, worker = 'worker1' }) {
  const c = typeof coin === 'string' ? resolveCoin(coin) : coin;
  if (!c || c.family !== 'ethereum') return null;
  const w = sanitizeWorker(worker);
  const algo = c.algo || 'ETCHASH';
  return {
    lolminer: `lolMiner --algo ${algo} --pool stratum+tcp://${host}:${port} --user ${address}.${w}`,
    ethminer: `ethminer -P stratum1+tcp://${address}.${w}@${host}:${port}`,
    note: 'Etchash needs a GPU miner — CPU mining is not practical for this algorithm.',
    download: MINERS.lolminer.releasePage,
  };
}

// ---------------------------------------------------------------------------
// Phone (Android/Termux) — RandomX only. Returns the step list + the QR payload.
// The QR payload is a compact, self-contained Termux command the phone can scan and run:
// install xmrig from the Termux repo (ARM build) and start mining to the pool.
// ---------------------------------------------------------------------------
export function genPhone({ coin, address, host, port, worker = 'worker1' }) {
  const c = typeof coin === 'string' ? resolveCoin(coin) : coin;
  if (!c) throw new Error('unknown coin');
  if (!c.phoneReady) {
    return { supported: false, reason: `${c.name} (${c.algo}) needs a GPU miner — phones can't mine it. Phone mining rides RandomX coins (Monero) only.` };
  }
  const w = sanitizeWorker(worker);
  const qr = genQrPayload({ coin: c, address, host, port, worker: w });
  return {
    supported: true,
    os: 'android',
    steps: [
      'Install Termux from F-Droid (not the outdated Play Store build): https://f-droid.org/packages/com.termux/',
      'Open Termux and run:  pkg update && pkg install xmrig',
      'Scan the QR code below from another device, or copy the command, and paste it into Termux.',
      'Keep the phone PLUGGED IN and cool. Stop any time with Ctrl-C.',
    ],
    command: qr,
    qrPayload: qr,
    warning: PHONE_WARNING,
  };
}

// Compact one-line Termux command, also used as the QR payload (kept short so the QR
// stays low-density and scannable).
export function genQrPayload({ coin, address, host, port, worker = 'worker1' }) {
  const c = typeof coin === 'string' ? resolveCoin(coin) : coin;
  if (!c || c.family !== 'cryptonote') throw new Error('QR phone payload is RandomX-only');
  const w = sanitizeWorker(worker);
  return `xmrig -o ${host}:${port} -u ${address} -p ${w} -a ${c.algo} --coin=${c.xmrigCoin} -t 2`;
}

// Honest battery/heat copy — frame phone mining as participation, not profit.
export const PHONE_WARNING =
  'Phone mining is for participation, not profit. A phone is a weak miner: it earns very ' +
  'little, and sustained mining gets it hot. Mine ONLY while plugged in, and stop if it ' +
  'heats up — thermal throttling will cut the hashrate anyway, and heat shortens battery ' +
  'life. iPhones cannot meaningfully mine (iOS blocks background CPU miners). Use 1–2 ' +
  'threads (-t 2), keep it cool, and treat any earnings as a token of taking part.';

// iOS honest note.
export const IOS_NOTE =
  'iOS is not practically minable: Apple does not allow background CPU-mining apps, and ' +
  'any that briefly appear get pulled. There is no honest iPhone mining path — if you want ' +
  'to mine from a pocket device, use an Android phone with Termux (above).';
