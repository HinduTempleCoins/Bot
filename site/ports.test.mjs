// ports.test.mjs — every site/ vertical must claim a UNIQUE default port.
//
// WHY. A duplicate `process.env.PORT || NNNN` is invisible until two of the sharing verticals are
// deployed at once; then whichever binds first wins, the second dies on EADDRINUSE, and — because
// Caddy still proxies the hostname to that port — the LOSER'S HOSTNAME SERVES THE WINNER'S SITE.
// Nothing 502s. Nothing alerts. The wrong site just returns 200.
//
// That is not hypothetical. On 2026-09-04 three were live simultaneously:
//   coupons.soapbox.community  served SoapBox Law      (melek-law was given coupons' 8102)
//   farm.soapbox.community     served Herald           (farm/server.mjs and herald/server.mjs BOTH
//                                                       declared `process.env.PORT || 8161`)
//   servers.soapbox.community  served Congress/Beauty  (vhost catch-all pointed at 8158, not 8156)
// melek-coupons had never once bound a port in the month since it was created.
//
// The second assertion is the subtler half: a vertical's documented port must match the port its
// code actually defaults to. Every one of the collisions above began as that drift.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SITE_DIR = path.dirname(fileURLToPath(import.meta.url));

/** [{ vertical, file, port, documented }] for every site/<v>/server.mjs that declares a default. */
export function declaredPorts(siteDir = SITE_DIR) {
  const out = [];
  for (const vertical of fs.readdirSync(siteDir, { withFileTypes: true })
    .filter((d) => d.isDirectory()).map((d) => d.name).sort()) {
    const file = path.join(siteDir, vertical, 'server.mjs');
    let src; try { src = fs.readFileSync(file, 'utf8'); } catch { continue; }
    const m = src.match(/process\.env\.PORT\s*\|\|\s*(\d{2,5})/);
    if (!m) continue;
    // the port advertised in the file's own header usage line, e.g. `//   PORT=8102 BASE_URL=... node ...`
    const doc = src.match(/\bPORT=(\d{2,5})\b/);
    out.push({ vertical, file: `site/${vertical}/server.mjs`, port: +m[1], documented: doc ? +doc[1] : null });
  }
  return out;
}

test('every site/ vertical declares a UNIQUE default port', () => {
  const byPort = new Map();
  for (const e of declaredPorts()) {
    if (!byPort.has(e.port)) byPort.set(e.port, []);
    byPort.get(e.port).push(e.vertical);
  }
  const dups = [...byPort.entries()].filter(([, vs]) => vs.length > 1)
    .map(([p, vs]) => `  ${p}: ${vs.join(', ')}`);
  assert.deepEqual(dups, [],
    'two verticals share a default port — deploy both and one hostname silently serves the other site:\n'
    + dups.join('\n'));
});

test("a vertical's documented PORT= matches the port its code defaults to", () => {
  const drifted = declaredPorts()
    .filter((e) => e.documented != null && e.documented !== e.port)
    .map((e) => `  ${e.file}: header says PORT=${e.documented}, code defaults to ${e.port}`);
  assert.deepEqual(drifted, [], 'documented port drifted from the code default:\n' + drifted.join('\n'));
});

test('the scan actually found the verticals (guards against a silently empty check)', () => {
  const found = declaredPorts();
  assert.ok(found.length > 80, `expected >80 verticals with a PORT default, found ${found.length}`);
  assert.ok(found.every((e) => e.port >= 1024 && e.port <= 65535), 'a port is out of range');
});
