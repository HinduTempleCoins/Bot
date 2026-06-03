// minecraft.test.mjs — offline tests for the Minecraft info feeds. All network is stubbed via
// __setFetch with canned payloads matching the real API shapes; no live calls, no keys.
// Run: node --test integrations/minecraft.test.mjs
//
// INFO-FEED ONLY — these guard the read/format lane. No game automation is tested or implemented;
// game-playing agents target our own servers elsewhere in the repo.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  serverStatus, parseMcsrvstat, parseMcStatusIo, stripMotd,
  profile, uuid, parseNameToUuid, parseProfile, dashUuid,
  versionManifest, latestVersions, parseVersionManifest,
  discordFormat, __setFetch,
} from './minecraft.mjs';

// ── fixtures (real API shapes) ───────────────────────────────────────────────────────────────────
const MCSRVSTAT_ONLINE = {
  online: true, ip: '172.65.236.36', port: 25565, hostname: 'mc.hypixel.net',
  version: '1.8-1.21', protocol: { version: 47, name: '1.8-1.21' },
  players: { online: 41234, max: 200000 },
  motd: { raw: ['§aHypixel Network §c1.8-1.21', '§eSummer event!'], clean: ['Hypixel Network 1.8-1.21', 'Summer event!'], html: [] },
};
const MCSRVSTAT_OFFLINE = { online: false, ip: null, port: null, hostname: 'down.example.com' };
const MCSTATUSIO_ONLINE = {
  online: true, host: 'play.example.com', port: 25565,
  version: { name_raw: '§e1.20.4', name_clean: '1.20.4', name_html: '...' },
  players: { online: 12, max: 100 },
  motd: { raw: '§bWelcome', clean: 'Welcome', html: '...' },
};
const NAME_TO_UUID = { id: '069a79f444e94726a5befca90e38aaf5', name: 'Notch' };
const SESSION_PROFILE = {
  id: '069a79f444e94726a5befca90e38aaf5', name: 'Notch',
  properties: [{ name: 'textures', value: 'eyJ0aW1lc3RhbXAiOj...' }],
};
const VERSION_MANIFEST_JSON = {
  latest: { release: '1.21.4', snapshot: '25w02a' },
  versions: [
    { id: '25w02a', type: 'snapshot', url: 'https://...', releaseTime: '2026-01-08T13:00:00+00:00' },
    { id: '1.21.4', type: 'release', url: 'https://...', releaseTime: '2025-12-03T10:00:00+00:00' },
    { id: '1.21.3', type: 'release', url: 'https://...', releaseTime: '2025-10-23T10:00:00+00:00' },
  ],
};

function jsonFetch(obj, { ok = true } = {}) { return async () => ({ ok, json: async () => obj }); }
function throwingFetch() { return async () => { throw new Error('network down'); }; }
function notOkFetch() { return async () => ({ ok: false, status: 404, json: async () => ({}) }); }

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// (1) SERVER STATUS — ≥6 across the section + helpers
// ══════════════════════════════════════════════════════════════════════════════════════════════════
test('status: parseMcsrvstat normalizes an online server', () => {
  const s = parseMcsrvstat(MCSRVSTAT_ONLINE, 'mc.hypixel.net');
  assert.equal(s.online, true);
  assert.equal(s.players.online, 41234);
  assert.equal(s.players.max, 200000);
  assert.equal(s.port, 25565);
  assert.equal(s.source, 'mcsrvstat');
  assert.equal(s.motd, 'Hypixel Network 1.8-1.21\nSummer event!'); // § codes stripped, clean joined
});

test('status: parseMcsrvstat handles an offline server', () => {
  const s = parseMcsrvstat(MCSRVSTAT_OFFLINE, 'down.example.com');
  assert.equal(s.online, false);
  assert.equal(s.players.online, null);
});

test('status: parseMcStatusIo gives the SAME shape (backend-swappable)', () => {
  const s = parseMcStatusIo(MCSTATUSIO_ONLINE, 'play.example.com');
  assert.equal(s.online, true);
  assert.equal(s.players.online, 12);
  assert.equal(s.players.max, 100);
  assert.equal(s.version, '1.20.4');
  assert.equal(s.motd, 'Welcome');
  assert.equal(s.source, 'mcstatus.io');
});

test('status: stripMotd handles string, array, object-with-clean, and null', () => {
  assert.equal(stripMotd('§aHello §lWorld'), 'Hello World');
  assert.equal(stripMotd(['§aA', 'B']), 'A\nB');
  assert.equal(stripMotd({ clean: ['X', 'Y'] }), 'X\nY');
  assert.equal(stripMotd(null), '');
});

test('status: serverStatus fetches + normalizes (stubbed)', async () => {
  __setFetch(jsonFetch(MCSRVSTAT_ONLINE));
  const s = await serverStatus('mc.hypixel.net');
  assert.equal(s.online, true);
  assert.equal(s.players.online, 41234);
  __setFetch(null);
});

test('status: serverStatus soft-fails to an offline shape on network error', async () => {
  __setFetch(throwingFetch());
  const s = await serverStatus('mc.hypixel.net');
  assert.equal(s.online, false);
  assert.equal(s.host, 'mc.hypixel.net');
  assert.deepEqual(s.players, { online: null, max: null });
  __setFetch(null);
});

test('status: serverStatus rejects bad input without throwing', async () => {
  const s = await serverStatus('');
  assert.equal(s.online, false);
  assert.equal(s.host, null);
});

test('status: discordFormat.status renders online + offline', () => {
  const on = discordFormat.status(parseMcsrvstat(MCSRVSTAT_ONLINE, 'mc.hypixel.net'));
  assert.match(on, /online/);
  assert.match(on, /41234/);
  const off = discordFormat.status({ online: false, host: 'x' });
  assert.match(off, /offline/);
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// (2) MOJANG PROFILE / UUID — ≥6
// ══════════════════════════════════════════════════════════════════════════════════════════════════
test('profile: dashUuid inserts dashes into a 32-hex id', () => {
  assert.equal(dashUuid('069a79f444e94726a5befca90e38aaf5'), '069a79f4-44e9-4726-a5be-fca90e38aaf5');
});

test('profile: dashUuid passes through already-dashed / non-uuid strings', () => {
  assert.equal(dashUuid('069a79f4-44e9-4726-a5be-fca90e38aaf5'), '069a79f4-44e9-4726-a5be-fca90e38aaf5');
  assert.equal(dashUuid('Notch'), 'Notch');
  assert.equal(dashUuid(null), null);
});

test('profile: parseNameToUuid normalizes name→uuid', () => {
  const u = parseNameToUuid(NAME_TO_UUID);
  assert.equal(u.name, 'Notch');
  assert.equal(u.uuid, '069a79f4-44e9-4726-a5be-fca90e38aaf5');
  assert.equal(u.id, '069a79f444e94726a5befca90e38aaf5');
  assert.equal(parseNameToUuid({}), null);
});

test('profile: parseProfile keeps properties array', () => {
  const p = parseProfile(SESSION_PROFILE);
  assert.equal(p.name, 'Notch');
  assert.equal(p.uuid, '069a79f4-44e9-4726-a5be-fca90e38aaf5');
  assert.equal(p.properties.length, 1);
});

test('profile: uuid() fetches name→uuid (stubbed)', async () => {
  __setFetch(jsonFetch(NAME_TO_UUID));
  const u = await uuid('Notch');
  assert.equal(u.uuid, '069a79f4-44e9-4726-a5be-fca90e38aaf5');
  __setFetch(null);
});

test('profile: profile() resolves a name then fetches the session profile', async () => {
  // first call returns name→uuid, second returns the session profile
  let n = 0;
  __setFetch(() => {
    n += 1;
    return Promise.resolve({ ok: true, json: async () => (n === 1 ? NAME_TO_UUID : SESSION_PROFILE) });
  });
  const p = await profile('Notch');
  assert.equal(p.name, 'Notch');
  assert.equal(p.properties.length, 1);
  __setFetch(null);
});

test('profile: profile() accepts a raw UUID directly (skips name resolve)', async () => {
  __setFetch(jsonFetch(SESSION_PROFILE));
  const p = await profile('069a79f444e94726a5befca90e38aaf5');
  assert.equal(p.name, 'Notch');
  __setFetch(null);
});

test('profile: soft-fails to null on 404 / bad input', async () => {
  __setFetch(notOkFetch());
  assert.equal(await uuid('NoSuchPlayer'), null);
  assert.equal(await profile(''), null);
  __setFetch(null);
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// (3) VERSION MANIFEST — ≥6 across section
// ══════════════════════════════════════════════════════════════════════════════════════════════════
test('version: parseVersionManifest extracts latest + cleaned versions', () => {
  const m = parseVersionManifest(VERSION_MANIFEST_JSON);
  assert.equal(m.latest.release, '1.21.4');
  assert.equal(m.latest.snapshot, '25w02a');
  assert.equal(m.versions.length, 3);
  assert.equal(m.versions[0].id, '25w02a');
  assert.equal(m.versions[0].type, 'snapshot');
});

test('version: parseVersionManifest soft-handles garbage', () => {
  assert.deepEqual(parseVersionManifest(null).latest, { release: null, snapshot: null });
  assert.deepEqual(parseVersionManifest({}).versions, []);
});

test('version: versionManifest() fetches + parses (stubbed)', async () => {
  __setFetch(jsonFetch(VERSION_MANIFEST_JSON));
  const m = await versionManifest();
  assert.equal(m.latest.release, '1.21.4');
  __setFetch(null);
});

test('version: latestVersions() returns just the latest pair', async () => {
  __setFetch(jsonFetch(VERSION_MANIFEST_JSON));
  const l = await latestVersions();
  assert.deepEqual(l, { release: '1.21.4', snapshot: '25w02a' });
  __setFetch(null);
});

test('version: versionManifest() soft-fails to empty shape on network error', async () => {
  __setFetch(throwingFetch());
  const m = await versionManifest();
  assert.deepEqual(m.latest, { release: null, snapshot: null });
  assert.deepEqual(m.versions, []);
  __setFetch(null);
});

test('version: discordFormat.version accepts both manifest and latest shapes', () => {
  const a = discordFormat.version({ latest: { release: '1.21.4', snapshot: '25w02a' } });
  const b = discordFormat.version({ release: '1.21.4', snapshot: '25w02a' });
  assert.match(a, /1\.21\.4/);
  assert.match(b, /25w02a/);
});
