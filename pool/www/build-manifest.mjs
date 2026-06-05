#!/usr/bin/env node
// Generate the static launcher-manifest.json from the single source of truth in
// wizard.mjs (buildManifest() over MINERS + COINS). Run:
//   node pool/www/build-manifest.mjs            # writes pool/www/launcher-manifest.json
//   node pool/www/build-manifest.mjs --check    # exit 1 if the on-disk file is stale
//
// The served manifest is what every SoapBox Miner launcher fetches at startup, so a NEW
// coin appears in everyone's existing download once this file is regenerated + deployed.
import { buildManifest } from './wizard.mjs';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, 'launcher-manifest.json');
const HOST = process.env.POOL_HOST || 'pool.soapbox.community';

const manifest = buildManifest({ host: HOST });
manifest.generatedAt = new Date().toISOString();
const text = JSON.stringify(manifest, null, 2) + '\n';

const check = process.argv.includes('--check');
if (check) {
  if (!existsSync(OUT)) { console.error('launcher-manifest.json missing — run the generator'); process.exit(1); }
  const cur = JSON.parse(readFileSync(OUT, 'utf8'));
  const a = { ...cur }; const b = { ...manifest };
  delete a.generatedAt; delete b.generatedAt; // timestamp is allowed to differ
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    console.error('launcher-manifest.json is STALE — re-run: node pool/www/build-manifest.mjs');
    process.exit(1);
  }
  console.log('launcher-manifest.json is up to date.');
  process.exit(0);
}

writeFileSync(OUT, text);
console.log(`wrote ${OUT} (${manifest.coins.length} coins, host=${HOST})`);
