// minecraft.mjs — Minecraft info-feed reader for the Van Kush Family Discord (gaming group).
//
// INFO-FEED ONLY — the "not-bot" lane. ───────────────────────────────────────────────────────────
//   This module READS public Minecraft data and FORMATS it for a human to read in Discord:
//     • server status (is it up? player count? MOTD?) via a keyless status-ping proxy,
//     • Mojang profile / UUID lookups (keyless),
//     • the official version manifest (latest release / snapshot, keyless).
//   It logs into NO account, joins NO server, sends NO game inputs, and touches NO game socket. The
//   actual game-PLAYING agents (Mineflayer/Mindcraft on OUR OWN servers) live in
//   integrations/game-agent.mjs and integrations/games/*; this is the read/format overlay only.
//
// Pattern matches integrations/soapbox/worldbank.mjs + integrations/rs3.mjs: ESM, zero deps, keyless,
// a __setFetch() hook, graceful soft-fail (return null/[]/safe shape, NEVER throw), pure helpers
// unit-tested offline, a guarded CLI block, provenance lines on every feed.
//
//   import { serverStatus, profile, uuid, versionManifest, latestVersions, discordFormat, __setFetch }
//     from './minecraft.mjs'
//   node integrations/minecraft.mjs status mc.hypixel.net
//   node integrations/minecraft.mjs profile Notch
//   node integrations/minecraft.mjs version

let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

// Keyless endpoints; we identify ourselves politely like the sibling soapbox modules.
const UA = { 'User-Agent': 'VanKushMinecraftTools/1.0 (+https://data.soapbox.community; info-feed-only, no game automation)' };

// ── endpoints ─────────────────────────────────────────────────────────────────────────────────
//   SERVER STATUS: mcsrvstat.us v3 (keyless, polite cache, Java + Bedrock variants). We use it rather
//     than api.mcstatus.io because mcsrvstat.us is the longest-running keyless status proxy, returns a
//     stable `online`/`players`/`motd`/`version` shape, and caches server-side so we don't hammer the
//     target server's status port. (api.mcstatus.io is an equivalent keyless alternative with an
//     `online`/`players.online`/`motd` shape — see parseMcStatusIo() below for that fallback shape.)
//       https://api.mcsrvstat.us/3/<host>           (Java)
//       https://api.mcsrvstat.us/bedrock/3/<host>   (Bedrock)
//   PROFILE/UUID: api.mojang.com (keyless). Name → UUID, and the session server for UUID → name.
//       https://api.mojang.com/users/profiles/minecraft/<name>   → { id:"<32hex>", name:"Notch" }
//       https://sessionserver.mojang.com/session/minecraft/profile/<uuid>  → { id, name, properties }
//   VERSION MANIFEST: launchermeta (keyless). Latest release + snapshot ids and the full version list.
//       https://launchermeta.mojang.com/mc/game/version_manifest_v2.json
const MCSRVSTAT = 'https://api.mcsrvstat.us/3';
const MCSRVSTAT_BEDROCK = 'https://api.mcsrvstat.us/bedrock/3';
const MCSTATUS_IO = 'https://api.mcstatus.io/v2/status';   // fallback — resolves SRV + IPv6-only (playit) hosts
const MOJANG_NAME = 'https://api.mojang.com/users/profiles/minecraft';
const MOJANG_PROFILE = 'https://sessionserver.mojang.com/session/minecraft/profile';
const VERSION_MANIFEST = 'https://launchermeta.mojang.com/mc/game/version_manifest_v2.json';

// ── small shared helpers ────────────────────────────────────────────────────────────────────────
const num = (x) => { if (x == null || x === '') return null; const n = Number(x); return Number.isFinite(n) ? n : null; };

async function getJson(url) {
  try {
    const r = await _fetch(url, { headers: UA });
    if (!r || !r.ok) return null;
    return await r.json();
  } catch { return null; }
}

// Insert a dashed UUID for a 32-char hex string (Mojang returns undashed ids). Pure; passes through
// anything that isn't a bare 32-hex string unchanged.
export function dashUuid(id) {
  if (!id || typeof id !== 'string') return id || null;
  const h = id.replace(/-/g, '');
  if (!/^[0-9a-fA-F]{32}$/.test(h)) return id;
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`.toLowerCase();
}

// MOTD/MC color-code stripper. In-game chat uses § (or sometimes &) color/format codes like §a, §l.
// Pure; safe on null. Also collapses the array-of-lines MOTD shape into one string when given an array.
export function stripMotd(motd) {
  if (motd == null) return '';
  let s;
  if (Array.isArray(motd)) s = motd.join('\n');
  else if (typeof motd === 'object') {
    // mcsrvstat returns motd as { raw:[], clean:[], html:[] } (arrays); mcstatus.io as
    // { raw, clean, html } (strings). Prefer clean, then raw, accepting either array or string.
    const pick = (v) => (Array.isArray(v) ? v.join('\n') : (typeof v === 'string' ? v : null));
    s = pick(motd.clean) ?? pick(motd.raw) ?? '';
  } else s = String(motd);
  return s.replace(/[§&][0-9a-fk-orA-FK-OR]/g, '').trim();
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// (1) SERVER STATUS  — mcsrvstat.us v3 (keyless), Java or Bedrock.
// ════════════════════════════════════════════════════════════════════════════════════════════════

// PURE: normalize a mcsrvstat.us v3 payload → a clean, stable status shape (or an offline shape).
//   { online, host, port, players:{online,max}, version, motd, icon, source }
export function parseMcsrvstat(json, host = null) {
  if (!json || typeof json !== 'object') {
    return { online: false, host, port: null, players: { online: null, max: null }, version: null, motd: '', source: 'mcsrvstat' };
  }
  const online = json.online === true;
  return {
    online,
    host: host || json.hostname || json.ip || null,
    port: num(json.port),
    players: {
      online: json.players ? num(json.players.online) : null,
      max: json.players ? num(json.players.max) : null,
    },
    version: json.version != null ? String(json.version) : null,
    protocol: json.protocol && json.protocol.name != null ? String(json.protocol.name) : null,
    motd: stripMotd(json.motd),
    source: 'mcsrvstat',
  };
}

// PURE: normalize an api.mcstatus.io payload → the SAME stable status shape. Provided so a caller can
// swap status backends without changing downstream code. (mcstatus.io nests players under players.online
// as a number, and motd under motd.clean.)
export function parseMcStatusIo(json, host = null) {
  if (!json || typeof json !== 'object') {
    return { online: false, host, port: null, players: { online: null, max: null }, version: null, motd: '', source: 'mcstatus.io' };
  }
  const online = json.online === true;
  return {
    online,
    host: host || json.host || null,
    port: json.port != null ? num(json.port) : null,
    players: {
      online: json.players ? num(json.players.online) : null,
      max: json.players ? num(json.players.max) : null,
    },
    version: json.version ? String(json.version.name_clean || json.version.name || '') || null : null,
    motd: stripMotd(json.motd),
    source: 'mcstatus.io',
  };
}

/**
 * Live status of a Minecraft server, soft-failing to an offline shape (NEVER throws).
 * @param {string} host  e.g. "mc.hypixel.net" or "play.example.com:25566"
 * @param {{bedrock?:boolean}} opts
 * @returns {Promise<{online,host,port,players:{online,max},version,motd,source}>}
 */
export async function serverStatus(host, opts = {}) {
  const offline = (h) => ({ online: false, host: h || null, port: null, players: { online: null, max: null }, version: null, motd: '', source: 'mcsrvstat' });
  if (!host || typeof host !== 'string') return offline(null);
  const base = opts.bedrock ? MCSRVSTAT_BEDROCK : MCSRVSTAT;
  const j = await getJson(`${base}/${encodeURIComponent(host)}`);
  const primary = j == null ? offline(host) : parseMcsrvstat(j, host);
  if (primary.online) return primary;
  // Fallback: mcstatus.io reaches some hosts mcsrvstat can't ping — notably SRV + IPv6-only targets like
  // playit.gg tunnels (our Hathor world). Only override when it actually reports the server online.
  const edition = opts.bedrock ? 'bedrock' : 'java';
  const alt = await getJson(`${MCSTATUS_IO}/${edition}/${encodeURIComponent(host)}`);
  if (alt) { const s = parseMcStatusIo(alt, host); if (s.online) return s; }
  return primary;
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// (2) MOJANG PROFILE / UUID  — api.mojang.com + sessionserver (keyless).
// ════════════════════════════════════════════════════════════════════════════════════════════════

// PURE: normalize a name→uuid payload → { name, uuid (dashed), id (raw) } or null.
export function parseNameToUuid(json) {
  if (!json || typeof json !== 'object' || !json.id) return null;
  const id = String(json.id);
  return { name: json.name != null ? String(json.name) : null, id, uuid: dashUuid(id) };
}

// PURE: normalize a sessionserver profile payload → { name, uuid (dashed), id (raw), properties } or null.
export function parseProfile(json) {
  if (!json || typeof json !== 'object' || !json.id) return null;
  const id = String(json.id);
  return {
    name: json.name != null ? String(json.name) : null,
    id,
    uuid: dashUuid(id),
    properties: Array.isArray(json.properties) ? json.properties : [],
  };
}

/**
 * Resolve a Minecraft username → UUID (dashed). Soft-fails to null (e.g. name not found → 404/204).
 * @param {string} name
 * @returns {Promise<{name,uuid,id}|null>}
 */
export async function uuid(name) {
  if (!name || typeof name !== 'string') return null;
  const j = await getJson(`${MOJANG_NAME}/${encodeURIComponent(name)}`);
  return parseNameToUuid(j);
}

/**
 * Look up a profile. Accepts a username (resolves to UUID first) OR a UUID directly. Soft-fails to null.
 * @param {string} nameOrUuid
 * @returns {Promise<{name,uuid,id,properties}|null>}
 */
export async function profile(nameOrUuid) {
  if (!nameOrUuid || typeof nameOrUuid !== 'string') return null;
  // A 32-hex (or dashed) string is treated as a UUID; otherwise resolve the name first.
  const bare = nameOrUuid.replace(/-/g, '');
  let id = /^[0-9a-fA-F]{32}$/.test(bare) ? bare : null;
  if (!id) {
    const u = await uuid(nameOrUuid);
    if (!u) return null;
    id = u.id;
  }
  const j = await getJson(`${MOJANG_PROFILE}/${encodeURIComponent(id)}`);
  return parseProfile(j);
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// (3) VERSION MANIFEST  — launchermeta (keyless). Latest release + snapshot.
// ════════════════════════════════════════════════════════════════════════════════════════════════

// PURE: normalize the version_manifest_v2 payload → { latest:{release,snapshot}, versions:[{id,type,releaseTime}] }.
export function parseVersionManifest(json) {
  if (!json || typeof json !== 'object') return { latest: { release: null, snapshot: null }, versions: [] };
  const latest = json.latest && typeof json.latest === 'object' ? json.latest : {};
  const versions = Array.isArray(json.versions)
    ? json.versions.filter(Boolean).map((v) => ({
        id: v.id != null ? String(v.id) : null,
        type: v.type != null ? String(v.type) : null,
        releaseTime: v.releaseTime != null ? String(v.releaseTime) : null,
      })).filter((v) => v.id)
    : [];
  return {
    latest: {
      release: latest.release != null ? String(latest.release) : null,
      snapshot: latest.snapshot != null ? String(latest.snapshot) : null,
    },
    versions,
  };
}

/**
 * Full version manifest (latest + list). Soft-fails to an empty-but-valid shape.
 * @returns {Promise<{latest:{release,snapshot}, versions:Array<{id,type,releaseTime}>}>}
 */
export async function versionManifest() {
  const j = await getJson(VERSION_MANIFEST);
  return parseVersionManifest(j);
}

/**
 * Convenience: just the latest release + snapshot ids. Soft-fails to { release:null, snapshot:null }.
 */
export async function latestVersions() {
  const m = await versionManifest();
  return m.latest;
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// (4) DISCORD FORMAT HELPERS — produce clean message strings (NO Discord API calls here).
//   The feed poster wires these to a webhook/bot later. Every block carries the info-only provenance.
// ════════════════════════════════════════════════════════════════════════════════════════════════

const FOOTER = '_info feed only — reads public Minecraft data, no game automation; agents target our own servers_';

export const discordFormat = {
  // Server-status block.  discordFormat.status(serverStatusResult)
  status(s) {
    if (!s) return 'Server status unavailable.';
    const host = s.host || 'server';
    if (!s.online) return `🔴 **${host}** is offline (or unreachable).\n${FOOTER}`;
    const lines = [`🟢 **${host}** is online`];
    const po = s.players ? s.players.online : null;
    const pm = s.players ? s.players.max : null;
    if (po != null) lines.push(`Players: ${po}${pm != null ? ` / ${pm}` : ''}`);
    if (s.version) lines.push(`Version: ${s.version}`);
    if (s.motd) lines.push(`MOTD: ${s.motd.replace(/\n/g, ' ').trim()}`);
    lines.push(`_source: ${s.source || 'mcsrvstat'}_  ${FOOTER}`);
    return lines.join('\n');
  },

  // Profile block.  discordFormat.profile(profileResult)
  profile(p) {
    if (!p) return 'Player not found.';
    const lines = [`**${p.name || 'player'}**`, `UUID: \`${p.uuid || p.id}\``];
    lines.push(`_source: Mojang API_  ${FOOTER}`);
    return lines.join('\n');
  },

  // Version block.  discordFormat.version(latestVersions() | versionManifest())
  version(m) {
    if (!m) return 'Version info unavailable.';
    const latest = m.latest || m; // accept either {latest:{...}} or {release,snapshot}
    const rel = latest.release || '—';
    const snap = latest.snapshot || '—';
    return `**Minecraft: Java Edition**\nLatest release: \`${rel}\`\nLatest snapshot: \`${snap}\`\n_source: Mojang launchermeta_  ${FOOTER}`;
  },
};

// ════════════════════════════════════════════════════════════════════════════════════════════════
// CLI (guarded) — quick manual checks. INFO ONLY; never automates the game.
// ════════════════════════════════════════════════════════════════════════════════════════════════
if (process.argv[1] && process.argv[1].endsWith('minecraft.mjs')) {
  const [cmd, ...rest] = process.argv.slice(2);
  const arg = rest.join(' ').trim();
  switch ((cmd || '').toLowerCase()) {
    case 'status': {
      const bedrock = rest.includes('--bedrock');
      const host = (arg.replace('--bedrock', '').trim()) || 'mc.hypixel.net';
      console.log(discordFormat.status(await serverStatus(host, { bedrock })));
      break;
    }
    case 'profile':
    case 'uuid': {
      console.log(discordFormat.profile(await profile(arg || 'Notch')));
      break;
    }
    case 'version':
    case 'versions': {
      console.log(discordFormat.version(await latestVersions()));
      break;
    }
    default:
      console.log('Minecraft info feeds (info feed only — reads public data; no game automation).');
      console.log('usage:');
      console.log('  node integrations/minecraft.mjs status mc.hypixel.net [--bedrock]');
      console.log('  node integrations/minecraft.mjs profile Notch');
      console.log('  node integrations/minecraft.mjs version');
  }
}
