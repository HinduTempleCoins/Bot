// rs3.mjs — RuneScape 3 (RS3) player-tool feeds for the Van Kush Family Discord (gaming group).
//
// INFO-TOOLS ONLY — the "not-bot" lane. ───────────────────────────────────────────────────────────
//   This module is the Alt1-toolkit-style lane: it READS public RuneScape data (Grand Exchange prices,
//   hiscores, daily-reset rotations, clock-based events) and FORMATS it for a human to read in Discord.
//   It performs NO game automation, sends NO inputs to the RS client, logs into NO Jagex account, and
//   never touches a game socket. Jagex's rules forbid botting/automation of RuneScape; this code stays
//   firmly on the "information overlay" side of that line (the same side Alt1, the RS Wiki, and price
//   trackers live on). Game-playing AGENTS in this repo target our OWN games only (see
//   integrations/game-agent.mjs / integrations/games/*), never RuneScape.
//
// Pattern matches integrations/soapbox/worldbank.mjs: ESM, zero deps, keyless, a __setFetch() hook,
// graceful soft-fail (return null/[]/safe shape, NEVER throw), pure helpers unit-tested offline, a
// guarded CLI block, provenance lines on every feed.
//
//   import { price, priceAlert, hiscores, formatStats, merchantToday, flashEventAt,
//            voiceOfSerenNote, discordFormat, __setFetch } from './rs3.mjs'
//   node integrations/rs3.mjs price "Dragon bones"
//   node integrations/rs3.mjs stats Zezima
//   node integrations/rs3.mjs merchant
//   node integrations/rs3.mjs flash

let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

// Keyless endpoints; we identify ourselves politely like the sibling soapbox modules.
const UA = { 'User-Agent': 'VanKushRS3Tools/1.0 (+https://data.soapbox.community; info-overlay-only, no game automation)' };

// ── small shared helpers ───────────────────────────────────────────────────────────────────────
// Number(null)/Number('') → 0, which is wrong here; null means "no value".
const num = (x) => {
  if (x == null) return null;
  // RS GE prices arrive as strings like "1,082", "+2", "2.5k", "-11.0%". Strip commas/+, keep sign/dot/k/m/b.
  const s = String(x).trim().replace(/,/g, '');
  const m = /^([+-]?\d*\.?\d+)\s*([kmb])?$/i.exec(s);
  if (!m) { const n = Number(s); return Number.isFinite(n) ? n : null; }
  let n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  const suf = (m[2] || '').toLowerCase();
  if (suf === 'k') n *= 1e3; else if (suf === 'm') n *= 1e6; else if (suf === 'b') n *= 1e9;
  return n;
};

// Compact GP formatting for display (1.2b, 340.5m, 4.2k, 7).
export function fmtGp(v) {
  if (v == null || !Number.isFinite(Number(v))) return '—';
  const n = Number(v);
  const abs = Math.abs(n);
  if (abs >= 1e9) return (n / 1e9).toFixed(2).replace(/\.00$/, '') + 'b';
  if (abs >= 1e6) return (n / 1e6).toFixed(2).replace(/\.00$/, '') + 'm';
  if (abs >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'k';
  return String(Math.round(n));
}

const num0 = (x) => { const n = Number(x); return Number.isFinite(n) ? n : 0; };

async function getJson(url) {
  try {
    const r = await _fetch(url, { headers: UA });
    if (!r || !r.ok) return null;
    return await r.json();
  } catch { return null; }
}
async function getText(url) {
  try {
    const r = await _fetch(url, { headers: UA });
    if (!r || !r.ok) return null;
    return await r.text();
  } catch { return null; }
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// (1) GRAND EXCHANGE PRICES
//   Preferred source: Weird Gloop exchange API (keyless, query by item NAME, returns clean JSON).
//     api.weirdgloop.org/exchange/history/rs/latest?name=Dragon%20bones
//       → { "Dragon bones": { id:"536", timestamp:"...Z", price:1082, volume:996319 } }
//   Fallback source: official RuneScape GE detail API (keyless, query by item ID, prices are
//     thousands-separated strings like "1,082"):
//     secure.runescape.com/m=itemdb_rs/api/catalogue/detail.json?item=536
//       → { item: { id, name, current:{price:"1,082"}, today:{price:"+2"}, day30:{change:"-11.0%"} ... } }
// ════════════════════════════════════════════════════════════════════════════════════════════════

const WEIRDGLOOP = 'https://api.weirdgloop.org/exchange/history/rs/latest';
const RS_GE_DETAIL = 'https://secure.runescape.com/m=itemdb_rs/api/catalogue/detail.json';

// PURE: normalize a Weird Gloop latest payload → { name, id, price, volume, timestamp } or null.
export function parseWeirdGloop(json, name) {
  if (!json || typeof json !== 'object') return null;
  // Weird Gloop keys the object by the resolved item name; if we know the requested name, prefer it,
  // else take the first (and typically only) key.
  let key = name && json[name] ? name : null;
  if (!key) { const keys = Object.keys(json); key = keys.length ? keys[0] : null; }
  if (!key) return null;
  const e = json[key];
  if (!e || typeof e !== 'object') return null;
  const price = num(e.price);
  if (price == null) return null;
  return {
    name: key,
    id: e.id != null ? String(e.id) : null,
    price,
    volume: e.volume != null ? num(e.volume) : null,
    timestamp: e.timestamp != null ? String(e.timestamp) : null,
    source: 'weirdgloop',
  };
}

// PURE: normalize the official RS GE detail payload → { name, id, price, todayChange, day30, source }.
export function parseRsGeDetail(json) {
  if (!json || typeof json !== 'object' || !json.item) return null;
  const it = json.item;
  const price = num(it.current && it.current.price);
  if (price == null) return null;
  return {
    name: it.name != null ? String(it.name) : null,
    id: it.id != null ? String(it.id) : null,
    price,
    todayChange: it.today ? num(it.today.price) : null,
    day30: it.day30 ? String(it.day30.change || '') : null,
    members: it.members === 'true' || it.members === true,
    source: 'rs-ge',
  };
}

/**
 * Latest GE price for an item BY NAME (Weird Gloop), soft-failing to null.
 * @param {string} name  e.g. "Dragon bones"
 * @returns {Promise<{name,id,price,volume,timestamp,source}|null>}
 */
export async function price(name) {
  if (!name || typeof name !== 'string') return null;
  const url = `${WEIRDGLOOP}?name=${encodeURIComponent(name)}`;
  const j = await getJson(url);
  return parseWeirdGloop(j, name);
}

/**
 * Latest GE price BY ITEM ID via the official RuneScape API (fallback / richer metadata).
 * @param {string|number} id
 */
export async function priceById(id) {
  if (id == null || String(id).trim() === '') return null;
  const url = `${RS_GE_DETAIL}?item=${encodeURIComponent(String(id))}`;
  const j = await getJson(url);
  return parseRsGeDetail(j);
}

/**
 * PURE alert helper: compare a price against a threshold. No network.
 *   priceAlert(1082, { below: 1100 })          → { triggered:true,  direction:'below', ... }
 *   priceAlert(1082, { above: 2000 })          → { triggered:false, direction:'above', ... }
 *   priceAlert({ price: 1082, name:'Dragon bones' }, { below: 1100 })  // accepts a price object too
 * @param {number|{price:number,name?:string}} priceOrObj
 * @param {{above?:number, below?:number}} threshold
 * @returns {{triggered:boolean, price:number|null, direction:'above'|'below'|null, threshold:number|null, name:string|null}}
 */
export function priceAlert(priceOrObj, threshold = {}) {
  const name = priceOrObj && typeof priceOrObj === 'object' ? (priceOrObj.name || null) : null;
  const p = priceOrObj && typeof priceOrObj === 'object' ? num(priceOrObj.price) : num(priceOrObj);
  const above = threshold && threshold.above != null ? num(threshold.above) : null;
  const below = threshold && threshold.below != null ? num(threshold.below) : null;
  if (p == null || (above == null && below == null)) {
    return { triggered: false, price: p, direction: null, threshold: null, name };
  }
  if (above != null && p >= above) return { triggered: true, price: p, direction: 'above', threshold: above, name };
  if (below != null && p <= below) return { triggered: true, price: p, direction: 'below', threshold: below, name };
  // not triggered: report the threshold that was being watched (prefer below if both given)
  const watched = below != null ? below : above;
  const dir = below != null ? 'below' : 'above';
  return { triggered: false, price: p, direction: dir, threshold: watched, name };
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// (2) HISCORES — official hiscores_lite (keyless CSV)
//   secure.runescape.com/m=hiscore/index_lite.ws?player=NAME
//   CSV: one line per stat, each "rank,level,xp" (skills) then "rank,score" (activities/minigames).
//   The first 29 lines are skills in a FIXED order; the rest are activities. We name the skills.
// ════════════════════════════════════════════════════════════════════════════════════════════════

const HISCORES_LITE = 'https://secure.runescape.com/m=hiscore/index_lite.ws';

// Fixed RS3 hiscores skill order (index 0 = Overall, then alphabetical-ish per Jagex's layout).
export const SKILL_ORDER = [
  'Overall', 'Attack', 'Defence', 'Strength', 'Constitution', 'Ranged', 'Prayer', 'Magic',
  'Cooking', 'Woodcutting', 'Fletching', 'Fishing', 'Firemaking', 'Crafting', 'Smithing',
  'Mining', 'Herblore', 'Agility', 'Thieving', 'Slayer', 'Farming', 'Runecrafting', 'Hunter',
  'Construction', 'Summoning', 'Dungeoneering', 'Divination', 'Invention', 'Archaeology',
  'Necromancy',
];

/**
 * PURE: parse hiscores_lite CSV text into a named-skill structure.
 *   { player, skills: { Overall:{rank,level,xp}, Attack:{...}, ... }, raw:[...] }
 * Each skill line is "rank,level,xp"; -1 rank / -1 level means unranked → kept as nulls.
 * Soft-returns null on empty/garbage input.
 */
export function parseHiscores(csv, player = null) {
  if (!csv || typeof csv !== 'string') return null;
  const lines = csv.split('\n').map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return null;
  const skills = {};
  for (let i = 0; i < SKILL_ORDER.length && i < lines.length; i++) {
    const parts = lines[i].split(',');
    if (parts.length < 3) continue;
    const rank = num0(parts[0]);
    const level = num0(parts[1]);
    const xp = num0(parts[2]);
    skills[SKILL_ORDER[i]] = {
      rank: rank < 0 ? null : rank,
      level: level < 0 ? null : level,
      xp: xp < 0 ? null : xp,
    };
  }
  if (!Object.keys(skills).length) return null;
  return { player: player || null, skills, raw: lines };
}

/**
 * Fetch + parse a player's hiscores. Soft-fails to null (e.g. player not found → 404).
 * @param {string} player
 */
export async function hiscores(player) {
  if (!player || typeof player !== 'string') return null;
  const url = `${HISCORES_LITE}?player=${encodeURIComponent(player)}`;
  const csv = await getText(url);
  return parseHiscores(csv, player);
}

/**
 * PURE: format a parsed hiscores object (or the raw structure from hiscores()) into a Discord block.
 * Shows Overall + combat + a few headline skills compactly. Returns a string ('' if no data).
 */
export function formatStats(parsed) {
  if (!parsed || !parsed.skills) return '';
  const s = parsed.skills;
  const name = parsed.player || 'player';
  const lvl = (k) => (s[k] && s[k].level != null ? s[k].level : '—');
  const xp = (k) => (s[k] && s[k].xp != null ? fmtGp(s[k].xp) : '—');
  const lines = [];
  lines.push(`**RS3 stats — ${name}**`);
  if (s.Overall) lines.push(`Total level: ${lvl('Overall')}  •  XP: ${xp('Overall')}  •  Rank: ${s.Overall.rank != null ? '#' + s.Overall.rank.toLocaleString('en-US') : 'unranked'}`);
  // headline skills
  const show = ['Attack', 'Strength', 'Defence', 'Constitution', 'Magic', 'Ranged', 'Prayer',
    'Necromancy', 'Slayer', 'Invention', 'Archaeology'];
  const present = show.filter((k) => s[k]);
  if (present.length) {
    lines.push(present.map((k) => `${k} ${lvl(k)}`).join('  •  '));
  }
  lines.push('_info overlay only — no game automation (Jagex rules)_');
  return lines.join('\n');
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// (3) TRAVELLING MERCHANT — daily stock (DETERMINISTIC rotation, per the RS Wiki Module:Rotations).
//
//   The community-computed rotation (RS Wiki Module:Rotations/Merchant) is a PURE function of the
//   day number: items are drawn from ordered pools by  index = (dayNumber + offset) % poolSize.
//     • Slot 1 is ALWAYS the "Uncharted island map" (Deep Sea Fishing).
//     • Slots 2 & 3 (the "A/B" pool) cycle through 19 items.
//     • Slot 4 (the "C" pool) cycles through 13 items.
//   We implement that arithmetic as a PURE function. The only thing not publishable in closed form is
//   the absolute PHASE — the wiki module carries a calibration offset that maps the real-world day to
//   the pool index. We expose that offset as injectable config (default below) and a calibrate()
//   helper: feed one observed day's real stock to lock the phase. Document: the offsets need ONE live
//   calibration (or a wiki re-read) to be exactly correct; the rotation ITSELF is deterministic.
//   Resets 00:00 UTC daily.  Reference: RS Wiki Travelling Merchant's Shop/Details.
// ════════════════════════════════════════════════════════════════════════════════════════════════

// Ordered items list (RS Wiki Module:Rotations/Merchant/data). Index 0 is the fixed slot-1 map.
export const MERCHANT_FIXED = 'Uncharted island map (Deep Sea Fishing)';

// Slot A/B pool — 19 items, in rotation order.
export const MERCHANT_POOL_AB = [
  'Barrel of bait', 'Tangled fishbowl', 'Broken fishing rod', 'Small goebie burial charm',
  'Goebie burial charm', 'Menaphite gift offering (small)', 'Menaphite gift offering (medium)',
  'Unstable air rune', 'Anima crystal', 'Slayer VIP Coupon',
  'Distraction & Diversion reset token (daily)', 'Unfocused damage enhancer',
  'Sacred clay (Travelling Merchant)', 'Shattered anima', 'Advanced pulse core', 'Livid plant',
  'Gift for the Reaper', 'Silverhawk down', 'Large goebie burial charm',
];

// Slot C pool — 13 items, in rotation order.
export const MERCHANT_POOL_C = [
  'Message in a bottle (Deep Sea Fishing)', 'Dragonkin lamp', 'Dungeoneering Wildcard',
  'Menaphite gift offering (large)', 'Taijitu', 'Distraction & Diversion reset token (weekly)',
  'Distraction & Diversion reset token (monthly)', 'Starved ancient effigy', 'Harmonic dust',
  'Crystal triskelion', 'Deathtouched dart', 'Unfocused reward enhancer', 'Horn of honour',
];

// Calibration offsets (per-slot phase against the UTC day number). These set WHICH pool index each
// slot shows today. They require one live calibration (or a wiki re-read) to be exactly correct —
// the rotation arithmetic is deterministic regardless. Override via merchantToday(date, { offsets }).
export const MERCHANT_OFFSETS = { a: 0, b: 5, c: 0 };

// PURE: whole UTC days since the Unix epoch for a Date (the day-number the rotation indexes on).
export function utcDayNumber(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  return Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 86400000);
}

// PURE: positive modulo (JS % can go negative).
function mod(n, m) { return ((n % m) + m) % m; }

/**
 * PURE: the four merchant slots for a given day, computed from the day number.
 * @param {Date|string|number} date  (defaults to now; only the UTC calendar day is used)
 * @param {{offsets?:{a:number,b:number,c:number}}} opts
 * @returns {{date:string|null, dayNumber:number|null, slots:string[], deterministic:boolean, note:string}}
 */
export function merchantToday(date = new Date(), opts = {}) {
  const offsets = { ...MERCHANT_OFFSETS, ...(opts.offsets || {}) };
  const day = utcDayNumber(date);
  if (day == null) {
    return { date: null, dayNumber: null, slots: [], deterministic: true,
      note: 'invalid date' };
  }
  const a = MERCHANT_POOL_AB[mod(day + offsets.a, MERCHANT_POOL_AB.length)];
  let b = MERCHANT_POOL_AB[mod(day + offsets.b, MERCHANT_POOL_AB.length)];
  // Slots 2 & 3 share a pool but never show the same item; nudge B forward if it collides with A.
  if (b === a) b = MERCHANT_POOL_AB[mod(day + offsets.b + 1, MERCHANT_POOL_AB.length)];
  const c = MERCHANT_POOL_C[mod(day + offsets.c, MERCHANT_POOL_C.length)];
  const iso = new Date(day * 86400000).toISOString().slice(0, 10);
  return {
    date: iso,
    dayNumber: day,
    slots: [MERCHANT_FIXED, a, b, c],
    deterministic: true,
    note: 'rotation deterministic; phase set by calibration offsets (verify vs live once)',
  };
}

/**
 * PURE: derive calibration offsets from one observed day's real stock. Pass the three rotating item
 * names you actually saw on a given date; returns { a, b, c } offsets that reproduce them.
 * Returns null if an item isn't in the expected pool.
 * @param {Date|string|number} date
 * @param {{a:string,b:string,c:string}} observed  the real slot-2 / slot-3 / slot-4 item names
 */
export function calibrateMerchant(date, observed = {}) {
  const day = utcDayNumber(date);
  if (day == null || !observed) return null;
  const ia = MERCHANT_POOL_AB.indexOf(observed.a);
  const ib = MERCHANT_POOL_AB.indexOf(observed.b);
  const ic = MERCHANT_POOL_C.indexOf(observed.c);
  if (ia < 0 || ib < 0 || ic < 0) return null;
  return {
    a: mod(ia - day, MERCHANT_POOL_AB.length),
    b: mod(ib - day, MERCHANT_POOL_AB.length),
    c: mod(ic - day, MERCHANT_POOL_C.length),
  };
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// (4) WILDERNESS FLASH EVENTS + VOICE OF SEREN — clock math.
//
//   FLASH EVENTS: a fixed 14-event sequence, one per hour, synchronised across all worlds — so it is
//   DETERMINISTIC clock math given an anchor (one observed {UTC hour → event}). We compute the event
//   for any time from that anchor. The anchor is injectable; the default below is a single sighting
//   and should be re-calibrated against a live source once (then it's exact forever, being pure
//   modular hour arithmetic). Special (rare-drop) events are flagged.
//
//   VOICE OF SEREN: two of eight Prifddinas clans are active each hour, but selection is PSEUDO-RANDOM
//   (2-hour cooldown constraint), NOT a fixed sequence — so it is NOT deterministic from the clock.
//   We provide the clan list + the rules, and require a LIVE source for the current pair. Documented.
// ════════════════════════════════════════════════════════════════════════════════════════════════

// The 14-hour flash-event rotation, in order. `special:true` = rare/boss flash event.
export const FLASH_EVENTS = [
  { name: 'Spider Swarm', special: false },
  { name: 'Unnatural Outcrop', special: false },
  { name: 'Stryke the Wyrm', special: true },
  { name: 'Demon Stragglers', special: false },
  { name: 'Butterfly Swarm', special: false },
  { name: 'King Black Dragon Rampage', special: true },
  { name: 'Forgotten Soldiers', special: false },
  { name: 'Surprising Seedlings', special: false },
  { name: 'Hellhound Pack', special: false },
  { name: 'Infernal Star', special: true },
  { name: 'Lost Souls', special: false },
  { name: 'Ramokee Incursion', special: false },
  { name: 'Displaced Energy', special: false },
  { name: 'Evil Bloodwood Tree', special: true },
];

// Default anchor: a single observed {UTC hour-number → event index}. anchorHour is whole hours since
// the Unix epoch (UTC); anchorIndex is the FLASH_EVENTS index that was active at that hour. This is a
// CALIBRATION CONSTANT — re-verify once against a live source; the math around it is exact.
export const FLASH_ANCHOR = { anchorHour: 0, anchorIndex: 0 };

// PURE: whole UTC hours since the Unix epoch for a Date.
export function utcHourNumber(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  return Math.floor(d.getTime() / 3600000);
}

/**
 * PURE: which flash event is active at a given time, from the anchor. Deterministic clock math.
 * @param {Date|string|number} date
 * @param {{anchorHour:number, anchorIndex:number}} anchor
 * @returns {{event:string, special:boolean, index:number, hourUtc:number, calibrationNeeded:boolean}|null}
 */
export function flashEventAt(date = new Date(), anchor = FLASH_ANCHOR) {
  const h = utcHourNumber(date);
  if (h == null) return null;
  const a = anchor || FLASH_ANCHOR;
  const idx = mod((h - num0(a.anchorHour)) + num0(a.anchorIndex), FLASH_EVENTS.length);
  const ev = FLASH_EVENTS[idx];
  return {
    event: ev.name,
    special: ev.special,
    index: idx,
    hourUtc: h,
    // true unless the caller supplied a real (re-calibrated) anchor — flags that the default is a stub.
    calibrationNeeded: a === FLASH_ANCHOR,
  };
}

/**
 * PURE: the next N flash events from a given time (inclusive of the current hour).
 * @returns {Array<{event,special,index,hourUtc}>}
 */
export function flashSchedule(date = new Date(), count = 6, anchor = FLASH_ANCHOR) {
  const n = Math.max(1, Math.min(48, Number(count) || 6));
  const base = utcHourNumber(date);
  if (base == null) return [];
  const out = [];
  for (let i = 0; i < n; i++) {
    const at = new Date((base + i) * 3600000);
    const e = flashEventAt(at, anchor);
    if (e) out.push(e);
  }
  return out;
}

// The eight Prifddinas clans (Voice of Seren rotates two active per hour, pseudo-randomly).
export const SEREN_CLANS = [
  'Amlodd', 'Cadarn', 'Crwys', 'Hefin', 'Iorwerth', 'Ithell', 'Meilyr', 'Trahaearn',
];

/**
 * Voice of Seren note. Selection is pseudo-random (NOT clock-deterministic) — a live source is
 * required for the current active pair. This returns the rules + clan list, and echoes a live pair
 * if one is supplied. PURE.
 * @param {{active?:string[]}} opts  optionally pass the live active clans to render them
 */
export function voiceOfSerenNote(opts = {}) {
  const active = Array.isArray(opts.active) ? opts.active.filter((c) => SEREN_CLANS.includes(c)) : [];
  return {
    clans: SEREN_CLANS.slice(),
    activePerHour: 2,
    cooldownHours: 2,
    deterministic: false,
    active,
    note: active.length
      ? `Voice of Seren active: ${active.join(' & ')}`
      : 'Voice of Seren rotation is pseudo-random (2 of 8 clans hourly, 2h cooldown) — needs a live source for the current pair.',
  };
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// (5) DISCORD FORMAT HELPERS — produce clean message strings (NO Discord API calls here).
//   The feed poster wires these to a webhook/bot later. Every block carries the info-only provenance.
// ════════════════════════════════════════════════════════════════════════════════════════════════

const FOOTER = '_info overlay only — no game automation (Jagex rules); agents target our own games_';

export const discordFormat = {
  // GE price line.  discordFormat.price(priceObj)
  price(p) {
    if (!p || p.price == null) return 'No price found.';
    const vol = p.volume != null ? `  •  vol ${fmtGp(p.volume)}` : '';
    const chg = p.todayChange != null ? `  •  today ${p.todayChange >= 0 ? '+' : ''}${fmtGp(p.todayChange)}` : '';
    const d30 = p.day30 ? `  •  30d ${p.day30}` : '';
    return `**${p.name || 'item'}** — ${fmtGp(p.price)} gp${chg}${vol}${d30}\n_source: ${p.source === 'rs-ge' ? 'RuneScape GE' : 'Weird Gloop'}_  ${FOOTER}`;
  },

  // Price-alert line.  discordFormat.alert(priceAlert(...))
  alert(a) {
    if (!a) return '';
    const who = a.name ? `**${a.name}** ` : '';
    if (a.triggered) {
      return `🔔 ${who}price ${a.direction} ${fmtGp(a.threshold)} — now ${fmtGp(a.price)} gp.\n${FOOTER}`;
    }
    return `${who}at ${fmtGp(a.price)} gp (watching ${a.direction} ${fmtGp(a.threshold)}). No alert.\n${FOOTER}`;
  },

  // Hiscores block.  discordFormat.stats(parsedHiscores)
  stats(parsed) {
    const block = formatStats(parsed);
    return block || 'Player not found on the hiscores.';
  },

  // Travelling merchant block.  discordFormat.merchant(merchantToday(...))
  merchant(m) {
    if (!m || !Array.isArray(m.slots) || !m.slots.length) return 'Merchant stock unavailable.';
    const lines = [`**Travelling Merchant — ${m.date || 'today'}** (resets 00:00 UTC)`];
    m.slots.forEach((s, i) => lines.push(`  ${i + 1}. ${s}`));
    lines.push('_source: RS Wiki rotation (deterministic); verify phase vs live once_');
    lines.push(FOOTER);
    return lines.join('\n');
  },

  // Flash-event block.  discordFormat.flash(flashSchedule(...))  — accepts one event or a schedule array.
  flash(events) {
    const list = Array.isArray(events) ? events : (events ? [events] : []);
    if (!list.length) return 'Flash-event schedule unavailable.';
    const lines = ['**Wilderness Flash Events** (hourly)'];
    list.forEach((e, i) => {
      const when = i === 0 ? 'now' : `+${i}h`;
      lines.push(`  ${when.padEnd(4)} ${e.event}${e.special ? '  ⭐' : ''}`);
    });
    if (list[0] && list[0].calibrationNeeded) lines.push('_anchor is a stub — calibrate vs a live source once_');
    lines.push('_source: fixed 14-event rotation (clock math)_');
    lines.push(FOOTER);
    return lines.join('\n');
  },

  // Voice of Seren block.  discordFormat.seren(voiceOfSerenNote(...))
  seren(v) {
    if (!v) return '';
    const lines = ['**Voice of Seren**', `  ${v.note}`];
    lines.push('_pseudo-random rotation — live source needed for the current pair_');
    lines.push(FOOTER);
    return lines.join('\n');
  },
};

// ════════════════════════════════════════════════════════════════════════════════════════════════
// CLI (guarded) — quick manual checks. INFO ONLY; never automates the game.
// ════════════════════════════════════════════════════════════════════════════════════════════════
if (process.argv[1] && process.argv[1].endsWith('rs3.mjs')) {
  const [cmd, ...rest] = process.argv.slice(2);
  const arg = rest.join(' ').trim();
  switch ((cmd || '').toLowerCase()) {
    case 'price': {
      const p = await price(arg || 'Dragon bones');
      console.log(discordFormat.price(p));
      break;
    }
    case 'stats': {
      const h = await hiscores(arg || 'Zezima');
      console.log(discordFormat.stats(h));
      break;
    }
    case 'merchant':
    case 'merch': {
      console.log(discordFormat.merchant(merchantToday(new Date())));
      break;
    }
    case 'flash': {
      console.log(discordFormat.flash(flashSchedule(new Date(), 6)));
      break;
    }
    case 'seren': {
      console.log(discordFormat.seren(voiceOfSerenNote()));
      break;
    }
    default:
      console.log('RS3 player-tool feeds (info overlay only — no game automation; Jagex rules).');
      console.log('usage:');
      console.log('  node integrations/rs3.mjs price "Dragon bones"');
      console.log('  node integrations/rs3.mjs stats Zezima');
      console.log('  node integrations/rs3.mjs merchant');
      console.log('  node integrations/rs3.mjs flash');
      console.log('  node integrations/rs3.mjs seren');
  }
}
