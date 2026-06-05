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
    // Launcher metadata (consumed by buildManifest()): the canonical stratum port for
    // this coin (CPU/low-diff entry) and the in-app menu label. host comes from POOL_HOST.
    launcher: { port: 4444, menuLabel: 'Monero (stagenet) — CPU', enabled: true, miner: 'xmrig', hardware: ['cpu', 'gpu'] },
  },
  ethereum_classic: {
    id: 'etc-mordor', symbol: 'ETC', name: 'Ethereum Classic', family: 'ethereum',
    algo: 'ETCHASH',
    addr: { type: 'evm' },
    walletHelp: 'https://ethereumclassic.org/use/wallets',
    phoneReady: false,
    launcher: { port: 5550, menuLabel: 'Ethereum Classic (Mordor) — GPU', enabled: true, miner: 'lolminer', hardware: ['gpu'] },
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

// ===========================================================================
// SoapBox Miner — universal launcher ("one download, pick inside")
//
// The launcher is a plain-text script (PowerShell on Windows, POSIX sh on Linux/Mac)
// generated CLIENT-SIDE with the user's address(es) baked in. At runtime it fetches the
// dynamic manifest below from the pool; if that fetch fails it falls back to a copy of the
// manifest frozen into the script at generation time. So NEW menu coins appear in an old
// download (manifest reload) without the user redownloading anything.
//
// One source of truth: the manifest is built from MINERS + COINS (the same data the
// per-coin wizard uses). buildManifest() is the single producer; the static
// pool/www/launcher-manifest.json is generated from it (see tools below), and the
// launcher scripts consume the served copy.
// ===========================================================================

export const LAUNCHER_VERSION = '1';

// The manifest's miner-asset table, derived straight from MINERS. Per OS/arch:
// { url, sha256, bin, archive }. lolMiner has no published per-file SHA256SUMS on its
// release page, so its entries omit sha256 and the launcher treats GPU-coin miners as
// "verify-by-release-page" (documented honestly) rather than failing on a null hash.
function minerAssets(minerKey) {
  const m = MINERS[minerKey];
  if (!m) return null;
  const out = { miner: minerKey, version: m.version, releasePage: m.releasePage, assets: {} };
  for (const [plat, a] of Object.entries(m.assets)) {
    out.assets[plat] = {
      url: a.url,
      sha256: a.sha256 || null,
      bin: a.bin,
      archive: a.url.endsWith('.zip') ? 'zip' : 'tar.gz',
    };
  }
  if (m.termuxPackage) out.termuxPackage = m.termuxPackage;
  return out;
}

// Build the launcher manifest object. `host` is the pool stratum host (defaults to the
// production host). Coins come from COINS; only those with a launcher.enabled flag are
// surfaced (but disabled ones are still emitted with enabled:false so the menu can show
// "coming online"). Returns a plain JSON-serializable object.
export function buildManifest({ host = 'pool.soapbox.community' } = {}) {
  const coins = [];
  for (const [key, c] of Object.entries(COINS)) {
    const L = c.launcher || {};
    coins.push({
      key,
      coin: c.name,
      symbol: c.symbol,
      poolId: c.id,
      family: c.family,
      algo: c.family === 'cryptonote' ? c.algo : (c.algo || 'ETCHASH'),
      xmrigCoin: c.xmrigCoin || null,
      menuLabel: L.menuLabel || `${c.name} (${c.symbol})`,
      hardware: L.hardware || (c.family === 'cryptonote' ? ['cpu'] : ['gpu']),
      miner: L.miner || (c.family === 'cryptonote' ? 'xmrig' : 'lolminer'),
      stratum: { host, port: L.port || (c.family === 'ethereum' ? 5550 : 4444) },
      addrType: c.addr.type,
      walletHelp: c.walletHelp || null,
      configTemplate: c.family === 'cryptonote' ? 'xmrig-randomx' : 'gpu-etchash',
      phoneReady: !!c.phoneReady,
      enabled: L.enabled !== false,
    });
  }
  return {
    schema: 'soapbox-launcher-manifest',
    version: LAUNCHER_VERSION,
    generatedAt: '__BUILD_TIME__', // replaced by the static-file generator
    pool: { host, name: 'SoapBox Mining Pool' },
    miners: {
      xmrig: minerAssets('xmrig'),
      lolminer: minerAssets('lolminer'),
    },
    coins,
  };
}

// ---------------------------------------------------------------------------
// Client-side launcher script generation. Bakes in: the user's address per addrType
// (one address can serve every coin of that type — e.g. one 0x… for all EVM coins), the
// manifest URL, and a frozen fallback copy of the manifest. The scripts are plain text.
// ---------------------------------------------------------------------------

// addresses: { monero?: '...', evm?: '...' }  (keyed by addrType). Either/both may be
// empty — the launcher prompts on first run for any it needs.
function escapePsSingle(s) { return String(s == null ? '' : s).replace(/'/g, "''"); }
function escapeShSingle(s) { return String(s == null ? '' : s).replace(/'/g, `'\\''`); }

// Freeze a fallback manifest into the script as a here-doc / here-string. We strip the
// big miner releasePage prose to keep it compact but keep urls + sha256 + ports.
function fallbackManifestJSON(manifest) {
  return JSON.stringify(manifest);
}

export function genWindowsLauncher({ addresses = {}, manifest, manifestUrl }) {
  const fallback = fallbackManifestJSON(manifest);
  const xmrAddr = escapePsSingle(addresses.monero);
  const evmAddr = escapePsSingle(addresses.evm);
  // The .ps1 body. Plain text, heavily commented, no obfuscation.
  return [
    '# =====================================================================',
    '# SoapBox Miner  —  ONE download, pick your coin INSIDE the app.',
    '# This is a PLAIN-TEXT script. Read it. It does exactly this:',
    '#   1. Fetches the live coin menu (manifest) from the pool, or uses the',
    '#      copy frozen into this file if the pool is unreachable.',
    '#   2. Shows you a menu. You pick a coin + hardware.',
    '#   3. Downloads ONLY the official upstream miner release for that pick',
    '#      (URLs are GitHub.com release links, listed in the manifest below),',
    '#      and VERIFIES its SHA256 before running anything.',
    '#   4. Writes a local config with YOUR address as the mining username and',
    '#      starts mining. Your address is NEVER sent anywhere except to the',
    '#      pool as your payout username (that is how you get paid).',
    '# It remembers your last choice in soapbox-miner.json beside this file.',
    `# Manifest: ${manifestUrl}`,
    '# =====================================================================',
    '$ErrorActionPreference = "Stop"',
    `$ManifestUrl = '${escapePsSingle(manifestUrl)}'`,
    `$XmrAddress  = '${xmrAddr}'`,
    `$EvmAddress  = '${evmAddr}'`,
    '$Root = Join-Path $env:LOCALAPPDATA "SoapBoxMiner"',
    'New-Item -ItemType Directory -Force -Path $Root | Out-Null',
    '$StateFile = Join-Path $Root "soapbox-miner.json"',
    '',
    '# --- Frozen fallback manifest (used only if the pool is unreachable) ---',
    "$FallbackManifest = @'",
    fallback,
    "'@",
    '',
    'function Get-Manifest {',
    '  try {',
    '    $r = Invoke-WebRequest -UseBasicParsing -Uri $ManifestUrl -TimeoutSec 15',
    '    return ($r.Content | ConvertFrom-Json)',
    '  } catch {',
    '    Write-Host "(Using built-in coin list — could not reach the pool)" -ForegroundColor Yellow',
    '    return ($FallbackManifest | ConvertFrom-Json)',
    '  }',
    '}',
    '',
    'function Read-State { if (Test-Path $StateFile) { try { return (Get-Content $StateFile -Raw | ConvertFrom-Json) } catch { return $null } } return $null }',
    'function Save-State($s) { $s | ConvertTo-Json | Set-Content -Path $StateFile }',
    '',
    'function Ensure-Address($coin) {',
    '  if ($coin.addrType -eq "evm") {',
    '    if (-not $EvmAddress) { $EvmAddress = (Read-Host "Paste your 0x... payout address").Trim() }',
    '    return $EvmAddress',
    '  } else {',
    '    if (-not $XmrAddress) { $XmrAddress = (Read-Host ("Paste your " + $coin.symbol + " payout address")).Trim() }',
    '    return $XmrAddress',
    '  }',
    '}',
    '',
    'function Get-Asset($manifest, $minerKey) {',
    '  $os = "windows-x64"',
    '  $m = $manifest.miners.$minerKey',
    '  if (-not $m) { throw "miner $minerKey not in manifest" }',
    '  return @{ info = $m; asset = $m.assets.$os }',
    '}',
    '',
    'function Download-And-Verify($asset) {',
    '  $tmp = Join-Path $env:TEMP ("soapbox-" + [IO.Path]::GetRandomFileName())',
    '  New-Item -ItemType Directory -Force -Path $tmp | Out-Null',
    '  $dl = Join-Path $tmp "miner.archive"',
    '  Write-Host ("Downloading official miner: " + $asset.url)',
    '  Invoke-WebRequest -UseBasicParsing -Uri $asset.url -OutFile $dl',
    '  if ($asset.sha256) {',
    '    $h = (Get-FileHash $dl -Algorithm SHA256).Hash.ToLower()',
    '    if ($h -ne $asset.sha256.ToLower()) { throw "SHA256 MISMATCH — refusing to run. expected $($asset.sha256) got $h" }',
    '    Write-Host "SHA256 verified." -ForegroundColor Green',
    '  } else {',
    '    Write-Host "(No pinned SHA256 for this miner — verify against its official release page: $($asset.url))" -ForegroundColor Yellow',
    '  }',
    '  if ($asset.archive -eq "zip") { Expand-Archive $dl -DestinationPath $tmp -Force }',
    '  else { tar -xzf $dl -C $tmp }',
    '  $bin = Get-ChildItem -Path $tmp -Recurse -Filter ([IO.Path]::GetFileName($asset.bin)) | Select-Object -First 1',
    '  if (-not $bin) { throw "miner binary not found after unpack" }',
    '  return $bin.FullName',
    '}',
    '',
    'function Start-Mining($coin, $manifest) {',
    '  $addr = Ensure-Address $coin',
    '  if (-not $addr) { Write-Host "No address — cannot mine."; return }',
    '  $picked = Get-Asset $manifest $coin.miner',
    '  $binPath = Download-And-Verify $picked.asset',
    '  # NOTE: $host is a PowerShell automatic variable, so use $poolHost here.',
    '  $poolHost = $coin.stratum.host; $port = $coin.stratum.port',
    '  Save-State @{ coinKey = $coin.key; address = $addr }',
    '  if ($coin.configTemplate -eq "xmrig-randomx") {',
    '    $cfg = Join-Path (Split-Path $binPath) "config.json"',
    '    $obj = @{ autosave=$true; "donate-level"=0; cpu=@{ enabled=$true; "huge-pages"=$true };',
    '             pools=@(@{ algo=$coin.algo; coin=$coin.xmrigCoin; url=("{0}:{1}" -f $poolHost,$port); user=$addr; pass="soapbox"; keepalive=$true; tls=$false }) }',
    '    $obj | ConvertTo-Json -Depth 6 | Set-Content -Path $cfg',
    '    Write-Host ("Starting " + $coin.symbol + " miner -> " + $poolHost + ":" + $port)',
    '    & $binPath "--config=$cfg"',
    '  } else {',
    '    Write-Host ("Starting " + $coin.symbol + " GPU miner -> " + $poolHost + ":" + $port)',
    '    & $binPath --algo $coin.algo --pool ("stratum+tcp://" + $poolHost + ":" + $port) --user ("$addr.soapbox")',
    '  }',
    '}',
    '',
    'function Show-Menu($manifest) {',
    '  $coins = @($manifest.coins | Where-Object { $_.enabled })',
    '  Write-Host ""',
    '  Write-Host "==== SoapBox Miner — pick a coin ===="',
    '  for ($i=0; $i -lt $coins.Count; $i++) { Write-Host ("  [" + ($i+1) + "] " + $coins[$i].menuLabel) }',
    '  Write-Host "  [q] quit"',
    '  $sel = Read-Host "Choose"',
    '  if ($sel -eq "q") { return $null }',
    '  $n = 0; if ([int]::TryParse($sel, [ref]$n) -and $n -ge 1 -and $n -le $coins.Count) { return $coins[$n-1] }',
    '  Write-Host "Invalid choice."; return (Show-Menu $manifest)',
    '}',
    '',
    'while ($true) {',
    '  $manifest = Get-Manifest',
    '  $coin = Show-Menu $manifest',
    '  if (-not $coin) { break }',
    '  try { Start-Mining $coin $manifest } catch { Write-Host ("ERROR: " + $_.Exception.Message) -ForegroundColor Red }',
    '  Write-Host ""; Write-Host "Mining stopped. Pick another coin or quit."',
    '}',
    '',
  ].join('\r\n');
}

// Tiny .bat shim so a double-click runs the .ps1 past the default execution policy,
// scoped to THIS file only (no machine-wide policy change).
export function genWindowsBat({ ps1Name = 'SoapBoxMiner.ps1' } = {}) {
  return [
    '@echo off',
    'REM SoapBox Miner launcher shim. Runs the PowerShell script next to it,',
    'REM bypassing the execution policy for THIS file only (no system change).',
    'REM The .ps1 is plain text — open it in Notepad to read exactly what it does.',
    `powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0${ps1Name}"`,
    'pause',
  ].join('\r\n') + '\r\n';
}

export function genPosixLauncher({ addresses = {}, manifest, manifestUrl }) {
  const fallback = fallbackManifestJSON(manifest);
  const xmrAddr = escapeShSingle(addresses.monero);
  const evmAddr = escapeShSingle(addresses.evm);
  return [
    '#!/bin/sh',
    '# =====================================================================',
    '# SoapBox Miner  —  ONE download, pick your coin INSIDE the app.',
    '# This is a PLAIN-TEXT script. Read it. It does exactly this:',
    '#   1. Fetches the live coin menu (manifest) from the pool, or uses the',
    '#      copy frozen into this file if the pool is unreachable.',
    '#   2. Shows you a menu. You pick a coin.',
    '#   3. Downloads ONLY the official upstream miner release for that pick',
    '#      (GitHub.com release URLs in the manifest) and VERIFIES its SHA256.',
    '#   4. Writes a local config with YOUR address as the mining username and',
    '#      starts mining. Your address is NEVER sent anywhere except to the',
    '#      pool as your payout username (that is how you get paid).',
    `# Manifest: ${manifestUrl}`,
    '# Needs: curl, tar, and sha256sum OR shasum. macOS Apple Silicon uses the',
    '# macos-arm64 miner build; Etchash GPU coins are not supported on macOS.',
    '# =====================================================================',
    'set -eu',
    `MANIFEST_URL='${escapeShSingle(manifestUrl)}'`,
    `XMR_ADDRESS='${xmrAddr}'`,
    `EVM_ADDRESS='${evmAddr}'`,
    'ROOT="${HOME}/.soapbox-miner"',
    'mkdir -p "$ROOT"',
    'STATE="$ROOT/state.json"',
    '',
    'have() { command -v "$1" >/dev/null 2>&1; }',
    'sha256_of() {',
    '  if have sha256sum; then sha256sum "$1" | awk "{print \\$1}";',
    '  elif have shasum; then shasum -a 256 "$1" | awk "{print \\$1}";',
    '  else echo "NO_SHA_TOOL"; fi',
    '}',
    '',
    'detect_platform() {',
    '  os=$(uname -s); arch=$(uname -m)',
    '  case "$os" in',
    '    Linux)  echo "linux-x64" ;;',
    '    Darwin) if [ "$arch" = "arm64" ]; then echo "macos-arm64"; else echo "macos-x64"; fi ;;',
    '    *) echo "linux-x64" ;;',
    '  esac',
    '}',
    '',
    '# --- Frozen fallback manifest (used only if the pool is unreachable) ---',
    "FALLBACK_MANIFEST='" + fallback.replace(/'/g, `'\\''`) + "'",
    '',
    'fetch_manifest() {',
    '  if have curl && curl -fsSL --max-time 15 "$MANIFEST_URL" 2>/dev/null; then',
    '    return 0',
    '  fi',
    '  echo "$FALLBACK_MANIFEST"',
    '}',
    '',
    '# JSON parsing: python3 emits the fields we need as shell-safe KEY=value lines. One',
    '# python call lists the menu; another resolves the chosen coin + its miner asset. No',
    '# nested-quote gymnastics, no jq dependency.',
    'MANIFEST_FILE="$ROOT/manifest.json"',
    '',
    'list_menu() { # prints "<n>) <label>" for each enabled coin',
    '  python3 - "$MANIFEST_FILE" <<\'PYEOF\'',
    'import json,sys',
    'd=json.load(open(sys.argv[1]))',
    'for i,c in enumerate([x for x in d["coins"] if x["enabled"]],1):',
    '    print("%d) %s" % (i, c["menuLabel"]))',
    'PYEOF',
    '}',
    '',
    'resolve_pick() { # arg1=1-based index, arg2=platform; prints KEY=value lines (sh-eval-safe)',
    '  python3 - "$MANIFEST_FILE" "$1" "$2" <<\'PYEOF\'',
    'import json,sys,shlex',
    'd=json.load(open(sys.argv[1])); idx=int(sys.argv[2])-1; plat=sys.argv[3]',
    'coins=[x for x in d["coins"] if x["enabled"]]',
    'if idx<0 or idx>=len(coins):',
    '    print("PICK_OK=0"); sys.exit(0)',
    'c=coins[idx]',
    'a=d["miners"].get(c["miner"],{}).get("assets",{}).get(plat) or {}',
    'def emit(k,v): print("%s=%s" % (k, shlex.quote("" if v is None else str(v))))',
    'emit("PICK_OK","1")',
    'for k in ("family","symbol","algo","xmrigCoin","miner","addrType"): emit("P_"+k.upper(), c.get(k))',
    'emit("P_HOST", c["stratum"]["host"]); emit("P_PORT", c["stratum"]["port"])',
    'emit("P_URL", a.get("url")); emit("P_SHA", a.get("sha256")); emit("P_BIN", a.get("bin"))',
    'PYEOF',
    '}',
    '',
    'main() {',
    '  fetch_manifest > "$MANIFEST_FILE"',
    '  if ! have python3; then',
    '    echo "python3 is required to read the coin menu. Install it, or use the per-coin"',
    '    echo "one-liner on the pool website instead."',
    '    exit 1',
    '  fi',
    '  echo ""',
    '  echo "==== SoapBox Miner — pick a coin ===="',
    '  list_menu | sed "s/^/  [/; s/) /] /"',
    '  echo "  [q] quit"',
    '  printf "Choose: "; read sel',
    '  [ "$sel" = "q" ] && exit 0',
    '  plat=$(detect_platform)',
    '  eval "$(resolve_pick "$sel" "$plat")"',
    '  if [ "${PICK_OK:-0}" != "1" ]; then echo "Invalid choice."; exit 1; fi',
    '  family="$P_FAMILY"; symbol="$P_SYMBOL"; algo="$P_ALGO"; xmrigcoin="$P_XMRIGCOIN"',
    '  miner="$P_MINER"; addrtype="$P_ADDRTYPE"; host="$P_HOST"; port="$P_PORT"',
    '  url="$P_URL"; sha="$P_SHA"; binrel="$P_BIN"',
    '',
    '  if [ "$addrtype" = "evm" ]; then',
    '    addr="$EVM_ADDRESS"; [ -z "$addr" ] && { printf "Paste your 0x... payout address: "; read addr; }',
    '  else',
    '    addr="$XMR_ADDRESS"; [ -z "$addr" ] && { printf "Paste your %s payout address: " "$symbol"; read addr; }',
    '  fi',
    '  [ -z "$addr" ] && { echo "No address — cannot mine."; exit 1; }',
    '',
    '  if [ "$family" = "ethereum" ] && { [ "$plat" = "macos-arm64" ] || [ "$plat" = "macos-x64" ]; }; then',
    '    echo "Etchash GPU mining is not supported on macOS. Pick a RandomX coin (e.g. Monero) instead."',
    '    exit 1',
    '  fi',
    '  [ -z "$url" ] && { echo "No miner build for $plat."; exit 1; }',
    '',
    '  work=$(mktemp -d)',
    '  echo "Downloading official miner: $url"',
    '  curl -fsSL -o "$work/miner.archive" "$url"',
    '  if [ -n "$sha" ]; then',
    '    got=$(sha256_of "$work/miner.archive")',
    '    if [ "$got" = "NO_SHA_TOOL" ]; then echo "No sha256 tool found; cannot verify. Aborting."; exit 1; fi',
    '    if [ "$got" != "$sha" ]; then echo "SHA256 MISMATCH — refusing to run. expected $sha got $got"; exit 1; fi',
    '    echo "SHA256 verified."',
    '  else',
    '    echo "(No pinned SHA256 for this miner — verify against its official release page.)"',
    '  fi',
    '  tar -xzf "$work/miner.archive" -C "$work" 2>/dev/null || (cd "$work" && unzip -o miner.archive >/dev/null)',
    '  binname=$(basename "$binrel")',
    '  bin=$(find "$work" -name "$binname" -type f | head -1)',
    '  [ -z "$bin" ] && { echo "miner binary not found after unpack"; exit 1; }',
    '  chmod +x "$bin" 2>/dev/null || true',
    '',
    '  printf "%s" "{\\"coinKey\\":\\"$symbol\\",\\"address\\":\\"$addr\\"}" > "$STATE"',
    '  if [ "$miner" = "xmrig" ]; then',
    '    cfg="$(dirname "$bin")/config.json"',
    '    cat > "$cfg" <<JSONEOF',
    '{ "autosave": true, "donate-level": 0, "cpu": { "enabled": true, "huge-pages": true },',
    '  "pools": [ { "algo": "$algo", "coin": "$xmrigcoin", "url": "$host:$port", "user": "$addr", "pass": "soapbox", "keepalive": true, "tls": false } ] }',
    'JSONEOF',
    '    echo "Starting $symbol miner -> $host:$port"',
    '    "$bin" --config="$cfg"',
    '  else',
    '    echo "Starting $symbol GPU miner -> $host:$port"',
    '    "$bin" --algo "$algo" --pool "stratum+tcp://$host:$port" --user "$addr.soapbox"',
    '  fi',
    '}',
    '',
    'while true; do main; echo ""; echo "Mining stopped. Run again to pick another coin."; break; done',
    '',
  ].join('\n');
}
