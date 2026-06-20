// minecraft-ai-projects.mjs — the catalog of AI-that-plays-Minecraft projects we can borrow from.
//
// Operator (2026-06-20): "look for AI that play Minecraft and see if you can steal some stuff to let
// Hathor mess with… AI that are just doing things random on worlds… and I want to see what Hathor does
// with the stuff we put in the LoRAs." This is the survey + what's STEALABLE for our stack (Hathor runs
// on mineflayer + JS, persona/character-driven — so mineflayer-compatible, persona-profile projects are
// the gold; pixel/RL Python agents are reference-only). Pure data + helpers; no live calls.
//
// `mc`: 'yes' = mineflayer/JS, drop-in for us | 'adapt' = good ideas, different stack | 'ref' = research only.
// House style: ESM, helpers, handler(req,res), CLI guard.

export const PROJECTS = [
  // ── Frameworks we can directly build on (mineflayer / JS) ──────────────────────────────────────
  { name: 'Mindcraft', kind: 'framework', repo: 'kolbytn/mindcraft', license: 'MIT', lang: 'JS (mineflayer)', mc: 'yes',
    steal: 'persona PROFILE files (JSON character + examples) + a rich ACTION command set (!goToPlayer, !collectBlocks, !placeBlock, !attack, !followPlayer, !craft, !smelt), multi-agent rooms, any-LLM backend',
    note: 'THE one to mine — same stack as our game-agent.mjs. Its profile system is exactly "drive behavior from a character file" = our LoRA/persona.' },
  { name: 'Voyager', kind: 'framework', repo: 'MineDojo/Voyager', license: 'MIT', lang: 'Python + JS skills (mineflayer)', mc: 'adapt',
    steal: 'the SKILL LIBRARY idea — the agent WRITES its own mineflayer skills, tests them, and saves the ones that work; an automatic curriculum ("what should I learn next?")',
    note: 'NVIDIA/Jim Fan. Lifelong learning. The skill-library is how Hathor could grow capabilities over time (advanced autonomy).' },
  { name: 'MineDojo', kind: 'framework', repo: 'MineDojo/MineDojo', license: 'MIT', lang: 'Python', mc: 'ref',
    steal: 'the KNOWLEDGE BASE — 730k+ YouTube videos w/ transcripts, wiki, reddit, 3000+ tasks — grounding for "how do I do X in Minecraft"',
    note: 'Reference/grounding; pairs with our transcript + corpus lobes.' },

  // ── The "AI doing random things / a whole society in a world" he means ──────────────────────────
  { name: 'Project Sid (Altera)', kind: 'research', repo: 'altera-al / PIANO architecture', license: 'paper + partial', lang: 'multi', mc: 'adapt',
    steal: 'the EMERGENT-SOCIETY design (PIANO: concurrent modules for action/memory/social) — 1000+ agents living, trading, forming roles in one world. The vision of many Hathor-kin coexisting.',
    note: 'This is the "1000 AIs doing things in a world" you are picturing. Our bot society on testnet is the chain analogue; same idea in a game.' },
  { name: 'STEVE-1 / VPT', kind: 'research', repo: 'openai/Video-Pre-Training + STEVE-1', license: 'MIT', lang: 'Python (pixels)', mc: 'ref',
    steal: 'behavior CLONED from human gameplay videos — instruction-following from raw pixels',
    note: 'Pixel agent; heavy GPU. Reference for the post-GPU era.' },
  { name: 'GITM / JARVIS-1 / Optimus-1', kind: 'research', repo: 'various (Ghost-in-the-Minecraft, CraftJarvis)', license: 'mixed', lang: 'Python', mc: 'ref',
    steal: 'LLM + planner + memory architectures for long-horizon goals (mine diamonds, full tech tree)',
    note: 'Planning/memory papers — informs Hathor\'s decide-step + the hippocampus.' },

  // ── Mineflayer plugins = the concrete "stuff to mess with" (drop-in for us) ─────────────────────
  { name: 'mineflayer-pathfinder', kind: 'plugin', repo: 'PrismarineJS/mineflayer-pathfinder', license: 'MIT', lang: 'JS', mc: 'yes',
    steal: 'A* navigation, GoalFollow/GoalNear/GoalBlock', note: 'ALREADY INSTALLED — Hathor follows players with it.' },
  { name: 'mineflayer-collectblock', kind: 'plugin', repo: 'PrismarineJS/mineflayer-collectblock', license: 'MIT', lang: 'JS', mc: 'yes',
    steal: 'collect(block) — find, path to, and mine a block/ore; gather wood/stone', note: 'Gives her "gather" — the first productive verb.' },
  { name: 'mineflayer-pvp', kind: 'plugin', repo: 'PrismarineJS/mineflayer-pvp', license: 'MIT', lang: 'JS', mc: 'yes',
    steal: 'attack(entity), combat loop', note: 'Optional — keep peaceful for the friendly test world; useful for survival mobs.' },
  { name: 'mineflayer-auto-eat', kind: 'plugin', repo: 'link-discord/mineflayer-auto-eat', license: 'MIT', lang: 'JS', mc: 'yes',
    steal: 'auto-eat when hungry', note: 'Survival hygiene so she does not starve during long runs.' },
  { name: 'mineflayer-tool', kind: 'plugin', repo: 'PrismarineJS/mineflayer-tool', license: 'MIT', lang: 'JS', mc: 'yes',
    steal: 'equip the right tool for a block', note: 'Pairs with collectblock.' },
  { name: 'mineflayer-armor-manager', kind: 'plugin', repo: 'G07cha/MineflayerArmorManager', license: 'MIT', lang: 'JS', mc: 'yes',
    steal: 'auto-equip best armor', note: 'Survival.' },
  { name: 'mineflayer-statemachine', kind: 'plugin', repo: 'PrismarineJS/mineflayer-statemachine', license: 'MIT', lang: 'JS', mc: 'yes',
    steal: 'a visual behavior STATE MACHINE (idle→follow→gather→talk)', note: 'Structures her autonomy into named states — clean for "what is she doing right now".' },
  { name: 'prismarine-viewer', kind: 'plugin', repo: 'PrismarineJS/prismarine-viewer', license: 'MIT', lang: 'JS', mc: 'yes',
    steal: 'render the world to a browser (watch her from a phone)', note: 'Needs the `canvas` system libs on the box — the iPhone-viewing path.' },
];

// ── Downloadable "AI friend" mods people install to play WITH an AI (client-side, preloaded) ──────
// These are the ready-to-run things the operator asked about — install on your Minecraft, plug a key
// (or use a hosted/local model), and an AI companion plays with you. Distinct from our server-side
// mineflayer bots (Hathor/Sophia = separate accounts on a server): mods run inside the game client.
export const DOWNLOADABLE_MODS = [
  { name: 'Player2 AI NPC (PlayerEngine)', where: 'CurseForge', downloads: '173k+', loader: 'Fabric/Forge', byok: 'hosted (Player2) — minimal setup', mc: 'mod',
    note: 'Most popular + very active (2026). Embodied companions that listen, talk back, and act like real players. Best UX reference.' },
  { name: 'AI-Player', where: 'CurseForge + Modrinth', downloads: '100k+', loader: 'Fabric/Forge', byok: 'YOUR keys OR local Ollama', mc: 'mod',
    note: 'CLOSEST to our architecture — a real "second player" you point at your OWN LLM (Ollama or API key). We could give it a Hathor persona / learn its in-client action model.' },
  { name: 'ChatClef', where: 'CurseForge', downloads: '10k+', loader: 'Fabric/Forge', byok: 'hosted', mc: 'mod',
    note: 'AI copilot that plays FOR you or WITH you.' },
  { name: 'AI Companion', where: 'CurseForge', downloads: '12k+', loader: 'Fabric/Forge', byok: 'hosted', mc: 'mod',
    note: 'Interactive companion NPC that observes/reacts/engages in real time.' },
  { name: 'VoxelMind', where: 'CurseForge', downloads: 'n/a', loader: 'Fabric/Forge', byok: 'none — no setup', mc: 'mod',
    note: 'Easiest entry: singleplayer, no API keys/host to manage. Good "what does frictionless feel like" reference.' },
];

export const KINDS = ['framework', 'plugin', 'research', 'mod'];

export function all() { return PROJECTS; }
// Ready-to-install AI-friend mods (the "download and play with an AI" list).
export function downloadableMods() { return DOWNLOADABLE_MODS; }
export function byKind(kind) { return PROJECTS.filter((p) => p.kind === kind); }
export function dropIn() { return PROJECTS.filter((p) => p.mc === 'yes'); }     // mineflayer-ready for us now

// What to adopt for Hathor, in order — the actionable "steal list".
export function stealList() {
  return [
    { from: 'Mindcraft', take: 'persona-profile + action commands', why: 'her character (the LoRA/corpus) drives behavior + gives her verbs', priority: 1 },
    { from: 'mineflayer-collectblock + tool', take: 'gather/mine', why: 'first productive thing to DO (wood, stone)', priority: 2 },
    { from: 'mineflayer-auto-eat + armor-manager', take: 'survival hygiene', why: 'survive long autonomous runs', priority: 3 },
    { from: 'mineflayer-statemachine', take: 'named behavior states', why: 'legible autonomy (idle/follow/gather/talk/wander)', priority: 4 },
    { from: 'Voyager', take: 'self-written skill library', why: 'she GROWS new abilities over time', priority: 5 },
    { from: 'Project Sid', take: 'many-agent society', why: 'many Hathor-kin in one world (the long vision)', priority: 6 },
  ];
}

export function summary() {
  return {
    total: PROJECTS.length,
    frameworks: byKind('framework').length,
    plugins: byKind('plugin').length,
    research: byKind('research').length,
    dropInNow: dropIn().length,
    topSteal: stealList().slice(0, 3).map((s) => s.from),
  };
}

export function handler(req, res) {
  let url; try { url = new URL(req.url, 'http://x'); } catch { url = { searchParams: new Map() }; }
  const kind = url.searchParams.get('kind');
  const data = kind && KINDS.includes(kind) ? byKind(kind) : PROJECTS;
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ projects: data, stealList: stealList(), summary: summary() }, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('STEAL LIST (adopt in this order):');
  for (const s of stealList()) console.log(`  ${s.priority}. ${s.from} → ${s.take} (${s.why})`);
  console.log('\nDrop-in for us now:', dropIn().map((p) => p.name).join(', '));
}
