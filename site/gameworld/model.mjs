// site/gameworld/model.mjs — the GAME WORLD / FORT hub state model. PURE, deterministic, offline.
//
// A persistent, buildable home base (inspiration: RS3 Fort Forinthry — IP-SAFE, original names/lore
// only, no Jagex/RuneScape names or assets). A player unlocks PLOTS (tiles), places BUILDINGS on them,
// and upgrades them with in-ecosystem play-resources. Each building HOSTS one of our SYSTEMS — the
// Seed Farm (the Season/Seed farming platform) attaches as the garden's seed-plot; the HUD (the
// console-overlay game) attaches at the keep and FRAMES the whole world. The fort is the home for our
// systems and the reusable, EMBEDDABLE component other games drop in.
//
// This module is the SDK's source of truth: an event-sourced reducer. reduce(world, event) is pure and
// never throws (soft-fail → {world, ok, reason}); apply() folds a stream. Any surface — our hub page,
// a third-party game's embed, a bot — drives the SAME reducer, so progression/economy state syncs by
// replaying the documented event stream. NO network, NO keys, NO token moves: the model only tracks
// non-cashable PLAY-resources; real token accounting (PRANA/KULA/MWALI, Move payouts) happens at the
// signer/edge and reaches the fort only as `resource/grant` events. Keeps the compliance line intact.
//
//   import { createWorld, reduce, apply, score, embedManifest, themeVars, EVENTS,
//            PLOTS, BUILDINGS, SYSTEMS, RESOURCES, ECONOMY_TOKENS } from './model.mjs';
//   node site/gameworld/model.mjs            # print the blueprint + a seeded demo world

export const SCHEMA_VERSION = 1;

// ── esc: escape ALL interpolation (shared with server.mjs) ───────────────────────────────────────────
export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ── RESOURCES: the non-cashable PLAY materials you build the fort from. NOT tokens. ──────────────────
// Earned inside the ecosystem (farm yields, arcade wins, Move steps) and spent on plots/buildings.
export const RESOURCES = Object.freeze(['timber', 'stone', 'fiber', 'essence', 'spark']);
const isResource = (r) => RESOURCES.includes(r);

// ── ECONOMY TOKENS: referenced for framing only — the model NEVER mints/moves/holds these. ───────────
// The edge converts token-denominated rewards into `resource/grant` events; the fort stays play-only.
export const ECONOMY_TOKENS = Object.freeze({
  PRANA: Object.freeze({ role: 'compute coin', chainId: 712217, cashable: true, note: 'gas/compute; earned by mining. Not spent in-fort.' }),
  KULA:  Object.freeze({ role: 'reward token', cashable: true, note: 'ecosystem reward token — NO stablecoin claim.' }),
  MWALI: Object.freeze({ role: 'liquidity token', cashable: true, note: 'DEX liquidity token.' }),
});

// ── SYSTEMS: the pluggable subsystems the fort hosts. Seed Farm + HUD are first-class. ───────────────
// Each declares how it EMBEDS (the modular surface): kind, the events it consumes/emits, and whether it
// is gambling-adjacent (→ play-token / non-cashable / geofenced framing enforced by the surface).
export const SYSTEMS = Object.freeze({
  hud: Object.freeze({
    title: 'Overlay HUD',
    kind: 'overlay',                 // frames the WHOLE world rather than sitting on one plot
    attachBuilding: 'command-centre',
    consumes: ['world/state'],
    emits: ['hud/focus', 'hud/route'],
    playOnly: false,
    blurb: 'The console-overlay HUD — the frame around the world. Shows resources, routes to systems, live scoreboard.',
  }),
  'seed-farm': Object.freeze({
    title: 'Seed Farm',
    kind: 'panel',                   // a building panel on the garden plot
    attachBuilding: 'seed-plot',
    consumes: ['farm/plant', 'farm/water', 'farm/harvest'],
    emits: ['resource/grant'],       // harvest yields flow back into the fort as play-resources
    playOnly: false,
    blurb: 'The Season/Seed farming platform (prana-farm/prana-seed). Plant → water → harvest; yields grant fort resources.',
  }),
  workshop: Object.freeze({
    title: 'Workshop', kind: 'panel', attachBuilding: 'workshop', consumes: ['craft/convert'], emits: ['resource/grant'], playOnly: false,
    blurb: 'Refine raw materials into higher-tier resources for advanced upgrades.',
  }),
  market: Object.freeze({
    title: 'Bazaar', kind: 'panel', attachBuilding: 'bazaar', consumes: ['market/trade'], emits: [], playOnly: false,
    blurb: 'Trade resources with visitors; the on-ramp to the wider KulaSwap market (off-fort).',
  }),
  'move-gate': Object.freeze({
    title: "Wayfarer's Gate", kind: 'panel', attachBuilding: 'wayfarers-gate', consumes: ['move/arrive'], emits: ['resource/grant', 'visitor/arrive'], playOnly: false,
    blurb: 'Walk-to-earn arrivals: Move steps grant resources and bring visitors to the fort.',
  }),
  arcade: Object.freeze({
    title: 'Arcade Cabinet', kind: 'panel', attachBuilding: 'arcade-cabinet', consumes: ['arcade/play'], emits: ['resource/grant'], playOnly: true,
    blurb: 'Quick provably-fair games. PLAY points only — non-cashable, entertainment, never real money.',
  }),
  'lantern-hall': Object.freeze({
    title: 'Lantern Hall', kind: 'panel', attachBuilding: 'lantern-hall', consumes: ['lotto/enter'], emits: [], playOnly: true,
    blurb: 'A play-token lotto/lantern draw. Non-cashable, geofenced framing; real-money play sits behind counsel.',
  }),
});

// ── PLOTS: the tiles you progressively unlock. `keep` is home (unlocked at start). ───────────────────
// unlock: the play-resource cost. needs: a prerequisite plot that must already be unlocked.
export const PLOTS = Object.freeze({
  keep:          Object.freeze({ name: 'The Keep',        tier: 0, unlock: {},                       needs: null,             blurb: 'The heart of the fort. Home of the Command Centre + HUD.' }),
  garden:        Object.freeze({ name: 'Garden Terrace',  tier: 1, unlock: { timber: 4 },             needs: 'keep',           blurb: 'Soil for the Seed Farm.' }),
  'workshop-yard': Object.freeze({ name: 'Workshop Yard', tier: 1, unlock: { timber: 6, stone: 4 },   needs: 'keep',           blurb: 'Room for crafting stations.' }),
  gate:          Object.freeze({ name: 'Outer Gate',      tier: 1, unlock: { timber: 4, fiber: 4 },   needs: 'keep',           blurb: "Where wayfarers arrive." }),
  'market-row':  Object.freeze({ name: 'Market Row',      tier: 2, unlock: { stone: 8 },              needs: 'workshop-yard',  blurb: 'Stalls for the Bazaar.' }),
  'arcade-hall': Object.freeze({ name: 'Arcade Hall',     tier: 2, unlock: { spark: 6, stone: 6 },    needs: 'workshop-yard',  blurb: 'A hall for cabinets and the Lantern draw.' }),
});

// ── BUILDINGS: what you place on a plot. Each HOSTS a system. Levels raise capacity/yield. ───────────
// plot: the plot id it must sit on. place: cost to build. upgrade(lvl): cost to reach the NEXT level.
// produces(lvl): passive resource nodes generated per tick at that level (the "resource node" feel).
export const BUILDINGS = Object.freeze({
  'command-centre': Object.freeze({
    name: 'Command Centre', system: 'hud', plot: 'keep', maxLevel: 5,
    place: { timber: 3, stone: 3 }, upgrade: (l) => ({ stone: 4 * (l + 1), essence: 1 * l }), produces: () => ({}),
  }),
  'seed-plot': Object.freeze({
    name: 'Seed Plot', system: 'seed-farm', plot: 'garden', maxLevel: 6,
    place: { timber: 2, fiber: 2 }, upgrade: (l) => ({ timber: 2 * (l + 1), essence: l }), produces: (l) => ({ fiber: l }),
  }),
  workshop: Object.freeze({
    name: 'Workshop', system: 'workshop', plot: 'workshop-yard', maxLevel: 5,
    place: { timber: 4, stone: 2 }, upgrade: (l) => ({ stone: 3 * (l + 1), spark: l }), produces: (l) => ({ essence: l }),
  }),
  bazaar: Object.freeze({
    name: 'Bazaar', system: 'market', plot: 'market-row', maxLevel: 4,
    place: { stone: 4, timber: 2 }, upgrade: (l) => ({ stone: 4 * (l + 1) }), produces: () => ({}),
  }),
  'arcade-cabinet': Object.freeze({
    name: 'Arcade Cabinet', system: 'arcade', plot: 'arcade-hall', maxLevel: 4,
    place: { spark: 3, stone: 2 }, upgrade: (l) => ({ spark: 3 * (l + 1) }), produces: (l) => ({ spark: l }),
  }),
  'lantern-hall': Object.freeze({
    name: 'Lantern Hall', system: 'lantern-hall', plot: 'arcade-hall', maxLevel: 3,
    place: { spark: 4, essence: 2 }, upgrade: (l) => ({ essence: 2 * (l + 1) }), produces: () => ({}),
  }),
  'wayfarers-gate': Object.freeze({
    name: "Wayfarer's Gate", system: 'move-gate', plot: 'gate', maxLevel: 5,
    place: { timber: 3, fiber: 3 }, upgrade: (l) => ({ fiber: 2 * (l + 1) }), produces: (l) => ({ timber: l }),
  }),
});

// ── EVENTS: the documented event stream. This IS the embed protocol (state syncs by replay). ─────────
export const EVENTS = Object.freeze({
  INIT: 'world/init',
  PLOT_UNLOCK: 'plot/unlock',
  BUILDING_PLACE: 'building/place',
  BUILDING_UPGRADE: 'building/upgrade',
  RESOURCE_GRANT: 'resource/grant',       // external (farm/arcade/move) → fort play-resources
  SYSTEM_ATTACH: 'system/attach',
  VISITOR_ARRIVE: 'visitor/arrive',
  TICK: 'world/tick',                     // advance passive resource nodes one step
});
const EVENT_TYPES = new Set(Object.values(EVENTS));

// ── small pure helpers over a resources map ──────────────────────────────────────────────────────────
const clampInt = (n) => { const x = Math.floor(Number(n)); return Number.isFinite(x) ? x : 0; };
function canAfford(res, cost) {
  for (const [k, q] of Object.entries(cost || {})) if ((res[k] || 0) < q) return false;
  return true;
}
function spend(res, cost) { const out = { ...res }; for (const [k, q] of Object.entries(cost || {})) out[k] = (out[k] || 0) - q; return out; }
function shortfall(res, cost) {
  const miss = [];
  for (const [k, q] of Object.entries(cost || {})) { const have = res[k] || 0; if (have < q) miss.push(`${q - have} ${k}`); }
  return miss.join(', ');
}

// ── createWorld(owner, opts) — a fresh fort. The keep is unlocked; nothing built; resources seeded. ──
export function createWorld(owner, opts = {}) {
  if (!owner) throw new Error('createWorld: owner is required');
  const resources = {};
  for (const r of RESOURCES) resources[r] = 0;
  if (opts.seedResources) for (const r of RESOURCES) resources[r] = clampInt(opts.seedResources[r] || 0);
  return {
    schema: SCHEMA_VERSION,
    owner: String(owner).toLowerCase().replace(/^@/, ''),
    rev: 0,
    plots: { keep: { unlocked: true } },   // keep is home; others locked until unlocked
    buildings: {},                          // plot id → { id, level }
    systems: {},                            // system id → { attached: bool }
    resources,
    visitors: [],                           // {npc, at}
    journal: [],                            // capped list of applied event types (audit/replay marker)
  };
}

// ── reduce(world, event) — PURE, NEVER THROWS. Returns { world, ok, reason }. ────────────────────────
// Invalid/unaffordable events are no-ops (ok:false, reason set) leaving the input world untouched.
export function reduce(world, event) {
  const w = _clone(world);
  const type = event && event.type;
  if (!EVENT_TYPES.has(type)) return _rej(world, `unknown event "${type}"`);
  try {
    switch (type) {
      case EVENTS.INIT:
        return _ok({ ...createWorld(event.owner || w.owner, { seedResources: event.seedResources }), rev: 0 }, type);

      case EVENTS.PLOT_UNLOCK: {
        const id = event.plot;
        const def = PLOTS[id];
        if (!def) return _rej(world, `unknown plot "${id}"`);
        if (w.plots[id] && w.plots[id].unlocked) return _rej(world, `plot "${id}" already unlocked`);
        if (def.needs && !(w.plots[def.needs] && w.plots[def.needs].unlocked)) return _rej(world, `unlock "${def.needs}" first`);
        if (!canAfford(w.resources, def.unlock)) return _rej(world, `need ${shortfall(w.resources, def.unlock)}`);
        w.resources = spend(w.resources, def.unlock);
        w.plots[id] = { unlocked: true };
        return _ok(w, type);
      }

      case EVENTS.BUILDING_PLACE: {
        const id = event.building;
        const def = BUILDINGS[id];
        if (!def) return _rej(world, `unknown building "${id}"`);
        if (!(w.plots[def.plot] && w.plots[def.plot].unlocked)) return _rej(world, `unlock plot "${def.plot}" first`);
        if (w.buildings[id]) return _rej(world, `${id} already placed`);
        if (!canAfford(w.resources, def.place)) return _rej(world, `need ${shortfall(w.resources, def.place)}`);
        w.resources = spend(w.resources, def.place);
        w.buildings[id] = { id, level: 1 };
        return _ok(w, type);
      }

      case EVENTS.BUILDING_UPGRADE: {
        const id = event.building;
        const def = BUILDINGS[id];
        if (!def) return _rej(world, `unknown building "${id}"`);
        const slot = w.buildings[id];
        if (!slot) return _rej(world, `${id} not placed yet`);
        if (slot.level >= def.maxLevel) return _rej(world, `${id} at max level (${def.maxLevel})`);
        const cost = def.upgrade(slot.level);
        if (!canAfford(w.resources, cost)) return _rej(world, `need ${shortfall(w.resources, cost)}`);
        w.resources = spend(w.resources, cost);
        w.buildings[id] = { id, level: slot.level + 1 };
        return _ok(w, type);
      }

      case EVENTS.RESOURCE_GRANT: {
        // external systems (Seed Farm harvest, arcade win, Move steps) grant PLAY-resources into the fort.
        const r = event.resource;
        const qty = clampInt(event.qty);
        if (!isResource(r)) return _rej(world, `unknown resource "${r}"`);
        if (qty <= 0) return _rej(world, 'qty must be > 0');
        w.resources[r] = (w.resources[r] || 0) + qty;
        return _ok(w, type);
      }

      case EVENTS.SYSTEM_ATTACH: {
        const id = event.system;
        const def = SYSTEMS[id];
        if (!def) return _rej(world, `unknown system "${id}"`);
        const anchor = w.buildings[def.attachBuilding];
        if (!anchor) return _rej(world, `build "${def.attachBuilding}" to attach "${id}"`);
        w.systems[id] = { attached: true, level: anchor.level };
        return _ok(w, type);
      }

      case EVENTS.VISITOR_ARRIVE: {
        const npc = String(event.npc || '').slice(0, 40);
        if (!npc) return _rej(world, 'npc required');
        w.visitors = [...w.visitors.slice(-19), { npc, at: clampInt(event.at) }];
        return _ok(w, type);
      }

      case EVENTS.TICK: {
        // advance passive resource nodes: every placed building yields produces(level) once.
        for (const [id, slot] of Object.entries(w.buildings)) {
          const out = BUILDINGS[id].produces(slot.level) || {};
          for (const [r, q] of Object.entries(out)) if (q > 0 && isResource(r)) w.resources[r] = (w.resources[r] || 0) + q;
        }
        return _ok(w, type);
      }

      default:
        return _rej(world, `unhandled "${type}"`);
    }
  } catch (e) {
    return _rej(world, e && e.message ? e.message : 'reduce error');
  }
}

function _clone(world) {
  return {
    ...world,
    plots: { ...world.plots },
    buildings: Object.fromEntries(Object.entries(world.buildings).map(([k, v]) => [k, { ...v }])),
    systems: Object.fromEntries(Object.entries(world.systems).map(([k, v]) => [k, { ...v }])),
    resources: { ...world.resources },
    visitors: [...world.visitors],
    journal: [...world.journal],
  };
}
function _ok(w, type) { w.rev = (w.rev || 0) + 1; w.journal = [...w.journal.slice(-49), type]; return { world: w, ok: true, reason: null }; }
function _rej(world, reason) { return { world, ok: false, reason }; }

// ── apply(world, events[]) — fold an event stream; returns { world, applied, rejected[] }. ───────────
export function apply(world, events = []) {
  let w = world;
  const rejected = [];
  let applied = 0;
  for (const ev of events) {
    const r = reduce(w, ev);
    if (r.ok) { w = r.world; applied += 1; } else rejected.push({ event: ev, reason: r.reason });
  }
  return { world: w, applied, rejected };
}

// ── score(world) — the scoreboard number: plots + building levels + attached systems, weighted. ─────
export function score(world) {
  const plots = Object.values(world.plots).filter((p) => p.unlocked).length;
  const levels = Object.values(world.buildings).reduce((a, b) => a + b.level, 0);
  const systems = Object.values(world.systems).filter((s) => s.attached).length;
  return { plots, buildingLevels: levels, systems, total: plots * 5 + levels * 10 + systems * 15 };
}

// ── embedManifest(world) — the SAFE, documented state an embed exposes to a host game. ───────────────
// This is what /api/world returns and what the host reads via the SDK. No secrets, no internal journal.
export function embedManifest(world) {
  return {
    schema: SCHEMA_VERSION,
    owner: world.owner,
    rev: world.rev,
    plots: Object.entries(world.plots).filter(([, p]) => p.unlocked).map(([id]) => id),
    buildings: Object.entries(world.buildings).map(([id, b]) => ({ id, level: b.level, system: BUILDINGS[id].system })),
    systems: Object.keys(world.systems).filter((id) => world.systems[id].attached),
    resources: { ...world.resources },
    score: score(world).total,
    events: Object.values(EVENTS),   // the protocol the host may emit back
  };
}

// ── themeVars(theme) — theming hooks for the embed. Host overrides any subset; sane defaults. ────────
export const DEFAULT_THEME = Object.freeze({ bg: '#0b0b0f', panel: '#15151c', line: '#26262f', fg: '#e9e9ee', mut: '#9a9aa6', acc: '#8b7cff', gold: '#d29922', up: '#3fb950' });
export function themeVars(theme = {}) {
  const t = { ...DEFAULT_THEME, ...theme };
  return Object.entries(t).map(([k, v]) => `--${esc(k)}:${esc(v)}`).join(';');
}

// ── CLI: print the blueprint + a seeded demo world ───────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('model.mjs') && /gameworld/.test(process.argv[1])) {
  const demo = createWorld('hathor', { seedResources: { timber: 20, stone: 20, fiber: 10, essence: 6, spark: 10 } });
  const stream = [
    { type: EVENTS.PLOT_UNLOCK, plot: 'garden' },
    { type: EVENTS.BUILDING_PLACE, building: 'seed-plot' },
    { type: EVENTS.SYSTEM_ATTACH, system: 'seed-farm' },
    { type: EVENTS.BUILDING_PLACE, building: 'command-centre' },
    { type: EVENTS.SYSTEM_ATTACH, system: 'hud' },
    { type: EVENTS.TICK },
  ];
  const { world, applied, rejected } = apply(demo, stream);
  console.log('PLOTS:', Object.keys(PLOTS).join(', '));
  console.log('BUILDINGS:', Object.keys(BUILDINGS).join(', '));
  console.log('SYSTEMS:', Object.keys(SYSTEMS).join(', '));
  console.log(`demo: applied ${applied}, rejected ${rejected.length}`);
  console.log(JSON.stringify(embedManifest(world), null, 2));
}
