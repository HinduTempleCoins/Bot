// discord-organize.mjs — reorganize the Van Kush Family Discord into the ecosystem layout.
// (Rebuilt 2026-06-06 — the original module + selected-layout exchange was lost in the
// session crash; the layout below reconstructs the offered shape. Operator authorized apply.)
//
// HARD RULES:
//   • NON-DESTRUCTIVE, ALWAYS. This module CREATES categories/channels and MOVES existing
//     channels into categories. It NEVER deletes, never renames, never touches permissions
//     beyond the admin-only category it creates. Unknown channels stay exactly where they are.
//   • The planner is PURE (planChanges) — fully offline-testable. REST calls go through an
//     injected fetch; the bot token comes from env at call time and is never logged.
//   • CLI defaults to --dry-run. --apply is the explicit gate.
//
//   DISCORD_TOKEN=… node integrations/discord-organize.mjs --guild <id> [--apply]
//
// Exports: LAYOUT, planChanges(existing, layout), applyPlan(plan, opts), fetchGuildChannels(opts)

const API = 'https://discord.com/api/v10';
const UA = 'MELEK-Bot discord-organize (+https://github.com/HinduTempleCoins/Bot)';

let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

// ── the layout ───────────────────────────────────────────────────────────────────────────────────
// category → channels. `match` lists existing-channel names that belong in the category (moved,
// not recreated). Channel names listed under `create` are created if absent.
// Category ORDER matters: it's the top-to-bottom order operator set 2026-06-18 (live positions
// PATCHed to match). Fresh creates inherit this order too.
export const LAYOUT = [
  // ── the ten categories the operator set on 2026-06-18. NAMES AND MATCH LISTS ARE FROZEN:
  // renaming one makes the planner create a NEW category and orphan the old one's channels,
  // which is destructive. Sections added later go BELOW and must not claim these channels.
  {
    category: '📜 START HERE',
    create: ['welcome', 'announcements', 'introductions'],
    match: ['welcome', 'announcements', 'introductions', 'rules', 'start-here', 'general-info'],
    links: [['MELEK', 'https://melek.salon'], ['SoapBox', 'https://soapbox.community'],
            ['Roadmap', 'https://vankushfamily.com'], ['Directory', 'https://directory.soapbox.community'],
            ['Signup', 'https://melek.salon/signup'], ['Tutorial', 'https://melek.salon/tutorial']],
  },
  {
    // "The Others" — the catch-all, near the top. operator 2026-06-18: #biohacking lives here;
    // graphene-blockchains → MELEK CHAIN, bible/shaivism → RELIGION (later messages same day).
    category: '🎮 COMMUNITY',
    create: ['general'],
    match: ['general', 'off-topic', 'memes', 'chat', 'lounge', 'biohacking'],
    links: [['Forum', 'https://forum.soapbox.community'], ['Profiles', 'https://profile.soapbox.community'],
            ['Comms', 'https://comms.soapbox.community'], ['Contact', 'https://contact.soapbox.community'],
            ['Pact — groups & clubs', 'https://pact.pentecaust.com']],
  },
  {
    category: '⛓️ MELEK CHAIN',
    create: ['chain-status', 'witness-hathor', 'signup-help', 'tutorial'],
    match: ['chain-status', 'witness-hathor', 'signup-help', 'tutorial', 'melek', 'testnet', 'blockchain', 'graphene-blockchains', 'witness'],
    links: [['MELEK', 'https://melek.salon'], ['Wallet', 'https://wallet.melek.salon'],
            ['Explorer', 'https://explorer.melek.salon'], ['Witness School', 'https://witness.melek.salon'],
            ['Vote for witnesses', 'https://vote.melek.salon'], ['Karma', 'https://karma.melek.salon'],
            ['Hathor', 'https://hathor.melek.salon'], ['Mail', 'https://mail.melek.salon'],
            ['Holders', 'https://melek.salon/holders'], ['KULA fund', 'https://melek.salon/kula'],
            ['Tags', 'https://melek.salon/tags']],
  },
  {
    category: '⛏️ MINING POOL',
    create: ['pool-chat', 'pool-support'],
    match: ['pool-chat', 'pool-support', 'mining', 'pool', 'miners'],
    links: [['Mining pool', 'https://pool.soapbox.community'], ['Move miner', 'https://move.melek.salon'],
            ['Move', 'https://move.soapbox.community'], ['PRANA paper', 'https://prana-paper.melek.salon']],
  },
  {
    // SoapBox subdomain "brains" — one channel per vertical for humans to read + talk about on MELEK.
    category: '🧼 SOAPBOX',
    create: ['markets', 'data-feeds', 'directory', 'law', 'politics', 'oversight', 'hemp'],
    match: ['markets', 'data-feeds', 'directory', 'soapbox', 'crypto', 'trading', 'prices', 'law', 'politics', 'oversight', 'hemp', 'search', 'wiki'],
    links: [['SoapBox', 'https://soapbox.community'], ['Directory', 'https://directory.soapbox.community'],
            ['Data', 'https://data.soapbox.community'], ['Search', 'https://search.soapbox.community'],
            ['Law', 'https://law.soapbox.community'], ['Case Law of Us', 'https://caselaw.soapbox.community'],
            ['Legal lexicon', 'https://lexicon.soapbox.community'], ['Free speech', 'https://free-speech.soapbox.community'],
            ['Faux Law Files', 'https://encounters.soapbox.community'], ['Lawyers', 'https://lawyers.soapbox.community'],
            ['Politics', 'https://politics.soapbox.community'], ['Oversight', 'https://oversight.soapbox.community'],
            ['Hemp', 'https://hemp.soapbox.community'], ['Kush', 'https://kush.soapbox.community'],
            ['Farm', 'https://farm.soapbox.community'], ['Seeds', 'https://seeds.soapbox.community']],
  },
  {
    // The bots'/AIs' market brain ("Hive-Engine") — each channel is where a bot posts what it sees and
    // humans discuss it (with screenshots) per operator 2026-06-14. Crypto + metals + equities + futures.
    category: '📈 TRADE & MARKETS',
    create: ['trade-signals', 'arbitrage', 'markets-crypto', 'markets-metals', 'markets-stocks-bonds', 'futures-commodities'],
    match: ['trade-signals', 'arbitrage', 'arb', 'markets-crypto', 'markets-metals', 'metals', 'gold-silver', 'markets-stocks-bonds', 'stocks', 'bonds', 'futures-commodities', 'futures', 'hive-engine'],
    links: [['Stocks', 'https://stocks.soapbox.community'], ['Portfolio', 'https://portfolio.soapbox.community'],
            ['Data', 'https://data.soapbox.community'], ['A Buck', 'https://abuck.soapbox.community'],
            ['MELEK-Engine', 'https://engine.melek.salon'], ['Tokens', 'https://tokens.soapbox.community']],
  },
  {
    // operator 2026-06-18: renamed from LIBRARY → WIKI (wiki.soapbox.community). sacred-texts removed.
    category: '📚 WIKI',
    create: ['library-of-ashurbanipal', 'research'],
    match: ['library-of-ashurbanipal', 'research', 'library', 'wiki', 'books', 'knowledge'],
    links: [['Wiki — Library of Ashurbanipal', 'https://wiki.soapbox.community'],
            ['All categories', 'https://wiki.soapbox.community/categories'],
            ['Library', 'https://library.soapbox.community'], ['Legal lexicon', 'https://lexicon.soapbox.community'],
            ['Search', 'https://search.soapbox.community'], ['Language', 'https://language.soapbox.community'],
            ['Credentials', 'https://credentials.soapbox.community']],
  },
  {
    // operator 2026-06-18: #rs3 (RuneScape 3) belongs with Games now.
    category: '🕹️ GAMES',
    create: ['games'],
    match: ['games', 'minecraft', 'runescape', 'rs3', 'gaming'],
    links: [['Arcade', 'https://arcade.soapbox.community'], ['Games', 'https://games.soapbox.community'],
            ['Idle games', 'https://idlegames.soapbox.community'], ['Spin', 'https://spin.soapbox.community'],
            ['Gambling', 'https://gambling.soapbox.community'], ['Seeds', 'https://seeds.soapbox.community']],
  },
  {
    // operator 2026-06-18: Religion section at the bottom. bible/shaivism move in from COMMUNITY;
    // prayer-requests/lizard-people/hierophant are new.
    category: '⛪ RELIGION',
    create: ['prayer-requests', 'lizard-people', 'hierophant'],
    match: ['bible', 'shaivism', 'prayer-requests', 'lizard-people', 'hierophant', 'religion', 'prayer'],
    links: [['Hierophant', 'https://hierophant.soapbox.community'], ['Dudael', 'https://dudael.com'],
            ['Wiki — religion & practice', 'https://wiki.soapbox.community/category/religion'],
            ['Pentecaust', 'https://pentecaust.com']],
  },
  {
    category: '🔧 OPERATOR',
    adminOnly: true,
    create: ['bot-logs', 'admin'],
    match: ['bot-logs', 'admin', 'mod-chat', 'staff', 'operator'],
    links: [['Servers', 'https://servers.soapbox.community'], ['Scam alerts', 'https://scam-alert.soapbox.community']],
  },

  // ── added 2026-10-27 on operator request: a section for everything that had no home, each
  // carrying links to everything related to it. Purely ADDITIVE — these match lists deliberately
  // avoid every name already claimed above, so no existing channel is moved out of its category.
  {
    category: '💬 FORUM',
    create: ['forum-talk'],
    match: ['forum', 'forum-talk', 'boards', 'threads'],
    links: [['Forum', 'https://forum.soapbox.community'], ['Profiles', 'https://profile.soapbox.community'],
            ['Comms', 'https://comms.soapbox.community'], ['Contact', 'https://contact.soapbox.community']],
  },
  {
    category: '🤝 PACT — GROUPS & CLUBS',
    create: ['pact-groups', 'pact-charters'],
    match: ['pact', 'pact-groups', 'pact-charters', 'groups', 'clubs'],
    links: [['Pact', 'https://pact.pentecaust.com'], ['Pentecaust messenger', 'https://pentecaust.com'],
            ['Profiles', 'https://profile.soapbox.community'], ['Comms', 'https://comms.soapbox.community']],
  },
  {
    category: '📰 HERALD — NEWSROOM',
    create: ['herald-newsroom', 'press-releases'],
    match: ['herald', 'herald-newsroom', 'news', 'press', 'press-releases', 'newsroom'],
    links: [['Herald newsroom', 'https://herald.soapbox.community'], ['Scam alerts', 'https://scam-alert.soapbox.community'],
            ['Data', 'https://data.soapbox.community'], ['Search', 'https://search.soapbox.community']],
  },
  {
    category: '🪙 ENGINE & TOKENS',
    create: ['engine-tokens', 'token-talk'],
    match: ['engine', 'engine-tokens', 'token-talk', 'tokens'],
    links: [['MELEK-Engine', 'https://engine.melek.salon'], ['Tokens', 'https://tokens.soapbox.community'],
            ['Holders', 'https://melek.salon/holders'], ['KULA fund', 'https://melek.salon/kula'],
            ['KULA paper', 'https://kula-paper.melek.salon'], ['PRANA paper', 'https://prana-paper.melek.salon'],
            ['Portfolio', 'https://portfolio.soapbox.community']],
  },
  {
    category: '🎓 ACADEMY & CREDENTIALS',
    create: ['academy', 'credentials-talk'],
    match: ['academy', 'credentials', 'credentials-talk', 'school', 'courses'],
    links: [['Academy', 'https://academy.melek.salon'], ['Credentials', 'https://credentials.soapbox.community'],
            ['Grants', 'https://grants.soapbox.community'], ['Jobs', 'https://jobs.soapbox.community'],
            ['Witness School', 'https://witness.melek.salon'],
            ['Wiki — work & credentials', 'https://wiki.soapbox.community/category/work-credentials']],
  },
  {
    category: '🛒 SHOP, WORK & MONEY',
    create: ['shop-talk', 'jobs-board'],
    match: ['shop', 'shop-talk', 'shopping', 'jobs', 'jobs-board', 'business', 'coupons', 'deals'],
    links: [['Shop', 'https://shop.melek.salon'], ['Shopping', 'https://shopping.soapbox.community'],
            ['Coupons', 'https://coupons.soapbox.community'], ['Jobs', 'https://jobs.soapbox.community'],
            ['Business', 'https://business.soapbox.community'], ['Benefits', 'https://benefits.soapbox.community'],
            ['Insurance', 'https://insurance.soapbox.community'], ['Credit', 'https://credit.soapbox.community'],
            ['Cost of living', 'https://costofliving.soapbox.community'], ['Real estate', 'https://real-estate.soapbox.community']],
  },
  {
    category: '🧰 TOOLS',
    create: ['tools-talk'],
    match: ['tools', 'tools-talk', 'utilities'],
    links: [['Tools', 'https://tools.soapbox.community'], ['Calculator', 'https://calculator.soapbox.community'],
            ['Convert', 'https://convert.soapbox.community'], ['QR', 'https://qr.soapbox.community'],
            ['Passgen', 'https://passgen.soapbox.community'], ['Timer', 'https://timer.soapbox.community'],
            ['Notes', 'https://notes.soapbox.community'], ['Outliner', 'https://outliner.soapbox.community'],
            ['Markdown', 'https://markdown.soapbox.community'], ['Diagram', 'https://diagram.soapbox.community'],
            ['Map', 'https://map.soapbox.community'], ['Weather', 'https://weather.soapbox.community'],
            ['Fax', 'https://fax.soapbox.community'], ['Flashlight', 'https://flashlight.soapbox.community']],
  },
  {
    category: '🎧 MEDIA & STREAMS',
    create: ['media-talk'],
    match: ['media', 'media-talk', 'music', 'stream', 'streams', 'video'],
    links: [['Stream', 'https://stream.soapbox.community'], ['TuneIn', 'https://tunein.soapbox.community'],
            ['Player', 'https://player.soapbox.community'], ['Cams', 'https://cams.soapbox.community'],
            ['Travel', 'https://travel.soapbox.community'], ['Home', 'https://home.soapbox.community'],
            ['Pets', 'https://pets.soapbox.community'], ['Plate', 'https://plate.soapbox.community']],
  },
];

/** Discord channel topics cap at 1024 characters. Build one from a section's links, never exceeding it. */
export function topicFor(sec) {
  const links = (sec && sec.links) || [];
  if (!links.length) return '';
  const head = `${String(sec.category || '').replace(/^[^A-Za-z]+/, '')} — `;
  let out = '';
  for (const [label, url] of links) {
    const piece = `${label}: ${url}`;
    const next = out ? `${out} · ${piece}` : piece;
    if ((head + next).length > 1024) break;
    out = next;
  }
  return out ? head + out : '';
}

// Discord channel types
const T_TEXT = 0;
const T_CATEGORY = 4;

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9-]/g, '');

// ── the pure planner ─────────────────────────────────────────────────────────────────────────────
/**
 * Diff the live guild channels against the layout.
 * @param {Array<{id:string,name:string,type:number,parent_id?:string|null}>} existing
 * @param {Array} [layout]
 * @returns {{ ops: Array, summary: {createCategories:number,createChannels:number,moveChannels:number,untouched:number} }}
 *   ops: { kind:'create-category', name, adminOnly } |
 *        { kind:'create-channel', name, category } |
 *        { kind:'move-channel', id, name, category }
 */
export function planChanges(existing, layout = LAYOUT) {
  const chans = Array.isArray(existing) ? existing : [];
  const cats = new Map(chans.filter((c) => c.type === T_CATEGORY).map((c) => [norm(c.name), c]));
  const texts = chans.filter((c) => c.type === T_TEXT);
  const ops = [];
  const claimed = new Set();

  for (const sec of layout) {
    const catKey = norm(sec.category);
    const haveCat = cats.get(catKey);
    if (!haveCat) ops.push({ kind: 'create-category', name: sec.category, adminOnly: !!sec.adminOnly });

    const matchSet = new Set((sec.match || []).map(norm));
    // move existing text channels whose name matches this section (and not already inside it)
    for (const ch of texts) {
      if (claimed.has(ch.id)) continue;
      if (!matchSet.has(norm(ch.name))) continue;
      claimed.add(ch.id);
      const insideAlready = haveCat && ch.parent_id === haveCat.id;
      if (!insideAlready) ops.push({ kind: 'move-channel', id: ch.id, name: ch.name, category: sec.category });
    }
    // create the named channels that exist nowhere in the guild
    const allNames = new Set(texts.map((c) => norm(c.name)));
    for (const name of sec.create || []) {
      if (!allNames.has(norm(name))) ops.push({ kind: 'create-channel', name, category: sec.category });
    }

    // the section's first channel carries its links in the channel topic, so every section
    // points at everything related to it. Non-destructive: only set when it differs.
    const topic = topicFor(sec);
    const anchorName = (sec.create || [])[0];
    if (topic && anchorName) {
      const live = texts.find((c) => norm(c.name) === norm(anchorName));
      if (!live || (live.topic || '') !== topic) {
        ops.push({ kind: 'set-topic', name: anchorName, category: sec.category, topic, id: live ? live.id : null });
      }
    }
  }

  const untouched = texts.filter((c) => !claimed.has(c.id)).length;
  return {
    ops,
    summary: {
      createCategories: ops.filter((o) => o.kind === 'create-category').length,
      createChannels: ops.filter((o) => o.kind === 'create-channel').length,
      moveChannels: ops.filter((o) => o.kind === 'move-channel').length,
      setTopics: ops.filter((o) => o.kind === 'set-topic').length,
      untouched,
    },
  };
}

/** Render a plan as human-readable lines (for the dry-run + the operator report). Pure. */
export function renderPlan(plan) {
  const lines = [];
  for (const o of plan.ops) {
    if (o.kind === 'create-category') lines.push(`+ category ${o.name}${o.adminOnly ? ' (admin-only)' : ''}`);
    if (o.kind === 'create-channel') lines.push(`+ #${o.name} in ${o.category}`);
    if (o.kind === 'move-channel') lines.push(`→ move #${o.name} into ${o.category}`);
    if (o.kind === 'set-topic') lines.push(`🔗 links on #${o.name} (${o.category}) — ${o.topic.length} chars`);
  }
  const s = plan.summary;
  lines.push(`(${s.createCategories} new categories, ${s.createChannels} new channels, ${s.moveChannels} moves, ${s.setTopics} link topics, ${s.untouched} channels untouched — nothing deleted)`);
  return lines.join('\n');
}

// ── REST glue (token from env at call time; never logged) ──────────────────────────────────────
function tokenName() { return ['DISCORD', 'TOKEN'].join('_'); } // assembled, never one literal
function authHeaders() {
  const t = process.env[tokenName()] || '';
  if (!t) throw new Error(`${tokenName()} not set`);
  return { authorization: `Bot ${t}`, 'content-type': 'application/json', 'user-agent': UA };
}

async function rest(method, path, body) {
  const r = await _fetch(`${API}${path}`, {
    method, headers: authHeaders(), body: body ? JSON.stringify(body) : undefined,
  });
  if (r.status === 429) { // basic rate-limit respect
    const d = await r.json().catch(() => ({}));
    await new Promise((res) => setTimeout(res, Math.ceil((d.retry_after || 1) * 1000)));
    return rest(method, path, body);
  }
  if (!r.ok) throw new Error(`${method} ${path} -> HTTP ${r.status}`);
  return r.status === 204 ? null : r.json();
}

export async function fetchGuildChannels(guildId) {
  return rest('GET', `/guilds/${guildId}/channels`);
}

/**
 * Execute a plan against a guild. Sequential (rate-limit friendly). Returns per-op results.
 * Creates categories first so moves/creates can reference them.
 * `existing` (the guild's current channels) may be passed in to reuse a fetch the caller
 * already made (the CLI fetches it for the dry-run); omit it and applyPlan fetches it itself.
 */
export async function applyPlan(guildId, plan, existing) {
  const results = [];
  const catIds = new Map(); // category name -> id (existing + newly created)
  const chanIds = new Map(); // channel name -> id (existing + newly created)
  const channels = existing || await fetchGuildChannels(guildId);
  for (const c of channels.filter((x) => x.type === T_CATEGORY)) catIds.set(norm(c.name), c.id);
  for (const c of channels.filter((x) => x.type === T_TEXT)) chanIds.set(norm(c.name), c.id);

  for (const o of plan.ops) {
    try {
      if (o.kind === 'create-category') {
        const body = { name: o.name, type: T_CATEGORY };
        if (o.adminOnly) {
          // deny @everyone view; the bot + admins (via role perms) retain access
          body.permission_overwrites = [{ id: guildId, type: 0, deny: String(1 << 10) }]; // VIEW_CHANNEL
        }
        const made = await rest('POST', `/guilds/${guildId}/channels`, body);
        catIds.set(norm(o.name), made.id);
        results.push({ ...o, ok: true, id: made.id });
      } else if (o.kind === 'create-channel') {
        const parent = catIds.get(norm(o.category));
        const made = await rest('POST', `/guilds/${guildId}/channels`, { name: o.name, type: T_TEXT, parent_id: parent || undefined });
        chanIds.set(norm(o.name), made.id);
        results.push({ ...o, ok: true, id: made.id });
      } else if (o.kind === 'set-topic') {
        const id = o.id || chanIds.get(norm(o.name));
        if (!id) { results.push({ ...o, ok: false, reason: 'channel missing' }); continue; }
        await rest('PATCH', `/channels/${id}`, { topic: o.topic });
        results.push({ ...o, ok: true, id });
      } else if (o.kind === 'move-channel') {
        const parent = catIds.get(norm(o.category));
        if (!parent) { results.push({ ...o, ok: false, reason: 'category missing' }); continue; }
        await rest('PATCH', `/channels/${o.id}`, { parent_id: parent });
        results.push({ ...o, ok: true });
      }
    } catch (e) {
      results.push({ ...o, ok: false, reason: e.message }); // soft-fail per op, keep going
    }
  }
  return results;
}

// ── CLI ──────────────────────────────────────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('discord-organize.mjs')) {
  const args = process.argv.slice(2);
  const guildId = args[args.indexOf('--guild') + 1];
  const apply = args.includes('--apply');
  if (!guildId || guildId.startsWith('--')) {
    console.error('usage: node integrations/discord-organize.mjs --guild <id> [--apply]   (dry-run by default)');
    process.exit(2);
  }
  const existing = await fetchGuildChannels(guildId);
  const plan = planChanges(existing);
  console.log(renderPlan(plan));
  if (apply) {
    const res = await applyPlan(guildId, plan, existing); // reuse the dry-run fetch — no redundant GET
    const okN = res.filter((r) => r.ok).length;
    console.log(`applied: ${okN}/${res.length} ops ok`);
    for (const r of res.filter((x) => !x.ok)) console.log(`  FAILED ${r.kind} ${r.name || r.id}: ${r.reason}`);
  } else {
    console.log('(dry-run — pass --apply to execute)');
  }
}
