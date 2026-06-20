// place-catalog.mjs — the vanilla structures/features Hathor can summon with /place.
//
// Operator (2026-06-20): "there are commands to place geodes, villages, mansions, igloos and things on the
// map through the command line — give Hathor access to those." Minecraft's `/place structure <id>` and
// `/place feature <id>` drop a whole prebuilt structure/feature at a position. This is the curated, safe
// allow-list she can draw from (her LoRA picks from these when planning her home base — see
// integrations/home-base-planner.mjs). Pure data + a command builder; no IO.
//
// Only wholesome, buildable picks — no command_block/tnt-laden traps. Ids are 1.21 structure/feature ids.

export const PLACEABLE = [
  // — structures (whole prebuilt builds) —
  { name: 'woodland mansion', kind: 'structure', id: 'minecraft:mansion', tags: ['grand', 'home', 'wood'], desc: 'a vast dark-oak mansion — a ready great hall' },
  { name: 'plains village', kind: 'structure', id: 'minecraft:village_plains', tags: ['settlement', 'people'], desc: 'a living village — houses, farms, villagers' },
  { name: 'desert village', kind: 'structure', id: 'minecraft:village_desert', tags: ['settlement', 'desert'], desc: 'a sandstone village (fits her Egyptian palette)' },
  { name: 'savanna village', kind: 'structure', id: 'minecraft:village_savanna', tags: ['settlement'], desc: 'an acacia village' },
  { name: 'snowy village', kind: 'structure', id: 'minecraft:village_snowy', tags: ['settlement', 'snow'], desc: 'a snowy village' },
  { name: 'taiga village', kind: 'structure', id: 'minecraft:village_taiga', tags: ['settlement'], desc: 'a spruce village' },
  { name: 'igloo', kind: 'structure', id: 'minecraft:igloo', tags: ['small', 'snow', 'shelter'], desc: 'a small snow shelter' },
  { name: 'desert pyramid', kind: 'structure', id: 'minecraft:desert_pyramid', tags: ['temple', 'egyptian', 'desert'], desc: 'a sandstone pyramid temple — very on-aesthetic' },
  { name: 'jungle temple', kind: 'structure', id: 'minecraft:jungle_pyramid', tags: ['temple', 'jungle'], desc: 'a mossy stone jungle temple' },
  { name: 'ocean monument', kind: 'structure', id: 'minecraft:monument', tags: ['grand', 'water', 'prismarine'], desc: 'a vast prismarine sea temple' },
  { name: 'pillager outpost', kind: 'structure', id: 'minecraft:pillager_outpost', tags: ['tower'], desc: 'a tall watchtower' },
  { name: 'ruined portal', kind: 'structure', id: 'minecraft:ruined_portal', tags: ['ruin', 'mystic'], desc: 'a broken obsidian portal — ruins to build around' },
  { name: 'ancient city', kind: 'structure', id: 'minecraft:ancient_city', tags: ['grand', 'deep', 'dark'], desc: 'a vast deepslate city (huge — place with care)' },
  { name: 'trail ruins', kind: 'structure', id: 'minecraft:trail_ruins', tags: ['ruin', 'archaeology'], desc: 'buried ruins to excavate' },
  { name: 'trial chambers', kind: 'structure', id: 'minecraft:trial_chambers', tags: ['dungeon', 'copper'], desc: 'a copper trial dungeon' },
  // — features (natural formations) —
  { name: 'amethyst geode', kind: 'feature', id: 'minecraft:amethyst_geode', tags: ['crystal', 'purple', 'aesthetic'], desc: 'a crystal geode — her violet amethyst, natural' },
  { name: 'iceberg', kind: 'feature', id: 'minecraft:iceberg', tags: ['ice'], desc: 'an ice formation' },
];

const BY_NAME = new Map(PLACEABLE.map((p) => [p.name.toLowerCase(), p]));
const BY_ID = new Map(PLACEABLE.map((p) => [p.id, p]));
const ALLOWED_IDS = new Set(PLACEABLE.map((p) => p.id));

export function find(nameOrId) {
  const k = String(nameOrId || '').toLowerCase();
  return BY_NAME.get(k) || BY_ID.get(String(nameOrId)) || PLACEABLE.find((p) => k && (p.name.toLowerCase().includes(k) || p.id.includes(k))) || null;
}

/** Build the /place command for a placeable at a position. Returns null if not on the allow-list. */
export function placeCommand(nameOrId, x, y, z) {
  const p = find(nameOrId);
  if (!p || !ALLOWED_IDS.has(p.id)) return null;
  return `place ${p.kind} ${p.id} ${Math.round(x)} ${Math.round(y)} ${Math.round(z)}`;
}

export function byTag(tag) { return PLACEABLE.filter((p) => p.tags.includes(tag)); }
export function names() { return PLACEABLE.map((p) => p.name); }
export function isAllowed(id) { return ALLOWED_IDS.has(id); }

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('placeables:', names().join(', '));
  console.log(placeCommand('desert pyramid', 100, 68, 100));
  console.log(placeCommand('amethyst geode', 120, 40, 120));
}
