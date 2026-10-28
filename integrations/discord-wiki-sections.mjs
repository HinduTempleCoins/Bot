// discord-wiki-sections.mjs — give the Library of Ashurbanipal its own Discord topic area: one
// section per WIKI CATEGORY, each with a link to that category and an index of every article in it,
// refreshed on a timer so new articles appear on their own.
//
// WHY A SEPARATE MODULE FROM discord-organize.mjs. That module owns the guild's HAND-AUTHORED
// shape — the operator's category names and channel homes — and its layout is a frozen constant.
// This one is GENERATED from the live wiki and changes every time an article is published. Keeping
// them apart means a wiki edit can never rewrite the operator's layout, and the frozen-name tests
// in discord-organize stay meaningful.
//
// HARD RULES (same as the organizer):
//   • NON-DESTRUCTIVE. Creates categories/channels, sets topics, and edits messages it posted
//     before. Never deletes a channel, never renames one, never touches a message it did not write.
//   • Re-running is a no-op when nothing changed: message ids are remembered, so the index is
//     EDITED in place rather than posted again.
//   • The planner and the renderers are PURE and offline-testable. REST goes through an injected
//     fetch; the bot token comes from env at call time and is never logged.
//   • CLI defaults to --dry-run. --apply is the explicit gate.
//
//   DISCORD_TOKEN=… node integrations/discord-wiki-sections.mjs --guild <id> [--apply]

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const API = 'https://discord.com/api/v10';
const UA = 'MELEK-Bot discord-wiki-sections (+https://github.com/HinduTempleCoins/Bot)';
export const WIKI = process.env.WIKI_BASE || 'https://wiki.soapbox.community';
const STATE = process.env.DISCORD_WIKI_STATE || '/var/lib/melek-bot/discord-wiki-sections.json';

// Discord's documented ceilings. Staying under them is the whole formatting problem.
export const LIMITS = { topic: 1024, embedDescription: 4096, embedsPerMessage: 10, messageTotal: 6000 };

let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

const T_TEXT = 0;
const T_CATEGORY = 4;

const decode = (s) => String(s || '')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&rsaquo;/g, '›').replace(/&nbsp;/g, ' ');

/** Discord channel names: lowercase, dashes, no spaces, <=100 chars. */
const slug = (s) => String(s || '').toLowerCase()
  .replace(/&[a-z]+;/g, ' ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 100);

/**
 * Wiki channels are NAMESPACED with a `wiki-` prefix, and that is load-bearing.
 * The guild already has #law (in 🧼 SOAPBOX), #tools, #history, #people and others owned by
 * discord-organize.mjs's hand-authored layout. Without the prefix this module would find those
 * by name and overwrite their topics — silently hijacking the operator's channels for the wiki.
 */
export const chanName = (s) => slug(`wiki-${s}`);

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9-]/g, '');

// ── parsing the live wiki (pure) ────────────────────────────────────────────────────────────────

/** Categories from /categories: [{ id, name, count }]. Pure. */
export function parseCategoriesIndex(html) {
  const out = new Map();
  const re = /href="\/category\/([a-z0-9-]+)"[^>]*>([^<]+)/g;
  let m;
  while ((m = re.exec(String(html || '')))) {
    const id = m[1];
    const text = decode(m[2]).trim();
    const countMatch = /^(\d[\d,]*)\s+articles/.exec(text);
    const cur = out.get(id) || { id, name: '', count: 0 };
    if (countMatch) cur.count = Number(countMatch[1].replace(/,/g, ''));
    else if (!cur.name) cur.name = text;
    out.set(id, cur);
  }
  return [...out.values()].filter((c) => c.name);
}

/** Articles from /category/<id>: [{ slug, title }], de-duplicated, title-sorted. Pure. */
export function parseCategoryPage(html) {
  const seen = new Map();
  const re = /href="\/wiki\/([A-Za-z0-9_%.-]+)"[^>]*>([^<]+)/g;
  let m;
  while ((m = re.exec(String(html || '')))) {
    const slug = m[1];
    const title = decode(m[2]).trim();
    if (!title || seen.has(slug)) continue;
    seen.set(slug, { slug, title });
  }
  return [...seen.values()].sort((a, b) => a.title.localeCompare(b.title));
}

// ── rendering (pure) ────────────────────────────────────────────────────────────────────────────

/** The channel topic for a wiki category: what it is, how many, and where to read it. */
export function topicFor(cat) {
  const url = `${WIKI}/category/${cat.id}`;
  const n = cat.articles ? cat.articles.length : cat.count || 0;
  const base = `${cat.name} — ${n} article${n === 1 ? '' : 's'} in the Library of Ashurbanipal · ${url}`;
  return base.slice(0, LIMITS.topic);
}

/**
 * Every article as a masked link, packed into embeds. Masked links only render inside embeds,
 * which is why this does not just post plain text.
 */
export function buildEmbeds(cat) {
  const url = `${WIKI}/category/${cat.id}`;
  const lines = (cat.articles || []).map((a) => `• [${a.title}](${WIKI}/wiki/${a.slug})`);
  const embeds = [];
  let buf = [];
  let bufLen = 0;
  const flush = () => {
    if (!buf.length) return;
    embeds.push({ description: buf.join('\n') });
    buf = []; bufLen = 0;
  };
  for (const line of lines) {
    if (bufLen + line.length + 1 > LIMITS.embedDescription) flush();
    buf.push(line); bufLen += line.length + 1;
  }
  flush();
  if (!embeds.length) embeds.push({ description: '_No articles in this category yet._' });
  embeds[0] = {
    ...embeds[0],
    title: `${cat.name} — ${(cat.articles || []).length} articles`,
    url,
  };
  return embeds;
}

/**
 * Split embeds across messages so no message exceeds Discord's per-message ceilings.
 * Returns an array of arrays of embeds.
 */
export function chunkEmbeds(embeds) {
  const msgs = [];
  let cur = [];
  let total = 0;
  for (const e of embeds) {
    const len = (e.description || '').length + (e.title || '').length;
    if (cur.length >= LIMITS.embedsPerMessage || (total + len > LIMITS.messageTotal && cur.length)) {
      msgs.push(cur); cur = []; total = 0;
    }
    cur.push(e); total += len;
  }
  if (cur.length) msgs.push(cur);
  return msgs;
}

// ── the planner (pure) ──────────────────────────────────────────────────────────────────────────

export const categoryLabel = (cat) => `📖 WIKI — ${cat.name}`.slice(0, 100);

/**
 * Diff the live guild against the wiki's categories.
 * ops: create-category | create-channel | set-topic   (never delete, never rename)
 */
export function planWikiSections(cats, existing) {
  const chans = Array.isArray(existing) ? existing : [];
  const haveCats = new Map(chans.filter((c) => c.type === T_CATEGORY).map((c) => [norm(c.name), c]));
  const haveChans = new Map(chans.filter((c) => c.type === T_TEXT).map((c) => [norm(c.name), c]));
  const ops = [];
  for (const cat of cats) {
    const label = categoryLabel(cat);
    if (!haveCats.has(norm(label))) ops.push({ kind: 'create-category', name: label, catId: cat.id });
    const cname = chanName(cat.id);
    const live = haveChans.get(norm(cname));
    if (!live) ops.push({ kind: 'create-channel', name: cname, category: label, catId: cat.id });
    const topic = topicFor(cat);
    if (!live || (live.topic || '') !== topic) {
      ops.push({ kind: 'set-topic', name: cname, category: label, topic, id: live ? live.id : null, catId: cat.id });
    }
  }
  return {
    ops,
    summary: {
      categories: cats.length,
      articles: cats.reduce((n, c) => n + ((c.articles || []).length), 0),
      createCategories: ops.filter((o) => o.kind === 'create-category').length,
      createChannels: ops.filter((o) => o.kind === 'create-channel').length,
      setTopics: ops.filter((o) => o.kind === 'set-topic').length,
    },
  };
}

export function renderPlan(plan) {
  const lines = [];
  for (const o of plan.ops) {
    if (o.kind === 'create-category') lines.push(`+ category ${o.name}`);
    if (o.kind === 'create-channel') lines.push(`+ #${o.name} in ${o.category}`);
    if (o.kind === 'set-topic') lines.push(`🔗 topic on #${o.name} — ${o.topic.length} chars`);
  }
  const s = plan.summary;
  lines.push(`(${s.categories} wiki categories, ${s.articles} article links, ${s.createCategories} new categories, ${s.createChannels} new channels, ${s.setTopics} topics — nothing deleted)`);
  return lines.join('\n');
}

// ── state: remember the messages we posted so reruns EDIT instead of duplicating ────────────────

export function loadState(path = STATE) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return { messages: {} }; }
}
export function saveState(state, path = STATE) {
  try { mkdirSync(dirname(path), { recursive: true }); } catch { /* already there */ }
  try { writeFileSync(path, JSON.stringify(state, null, 2)); } catch { /* best effort */ }
}

// ── network ─────────────────────────────────────────────────────────────────────────────────────

async function rest(method, path, body) {
  const token = (process.env.DISCORD_TOKEN || '').trim();
  if (!token) throw new Error('DISCORD_TOKEN not set');
  const r = await _fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bot ${token}`, 'content-type': 'application/json', 'User-Agent': UA },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (r.status === 429) {
    const j = await r.json().catch(() => ({ retry_after: 2 }));
    await new Promise((res) => setTimeout(res, Math.ceil((j.retry_after || 2) * 1000)));
    return rest(method, path, body);
  }
  if (!r.ok) throw new Error(`${method} ${path} -> HTTP ${r.status}`);
  return r.status === 204 ? null : r.json();
}

async function getText(url) {
  const r = await _fetch(url, { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error(`GET ${url} -> HTTP ${r.status}`);
  return r.text();
}

/** Read the live wiki: every category with every article in it. */
export async function fetchWiki(base = WIKI) {
  const cats = parseCategoriesIndex(await getText(`${base}/categories`));
  const out = [];
  for (const c of cats) {
    try {
      c.articles = parseCategoryPage(await getText(`${base}/category/${c.id}`));
    } catch {
      c.articles = []; // soft-fail: an unreachable category must not drop the rest
    }
    out.push(c);
  }
  return out;
}

export async function fetchGuildChannels(guildId) {
  return rest('GET', `/guilds/${guildId}/channels`);
}

/** Create/patch channels, then post or EDIT the per-category index messages. */
export async function applyPlan(guildId, plan, cats, existing, statePath = STATE) {
  const results = [];
  const channels = existing || await fetchGuildChannels(guildId);
  const catIds = new Map(channels.filter((c) => c.type === T_CATEGORY).map((c) => [norm(c.name), c.id]));
  const chanIds = new Map(channels.filter((c) => c.type === T_TEXT).map((c) => [norm(c.name), c.id]));

  for (const o of plan.ops) {
    try {
      if (o.kind === 'create-category') {
        const made = await rest('POST', `/guilds/${guildId}/channels`, { name: o.name, type: T_CATEGORY });
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
      }
    } catch (e) {
      results.push({ ...o, ok: false, reason: e.message });
    }
  }

  // the indexes — edit in place where we posted before, so this is safe to run on a timer
  const state = loadState(statePath);
  state.messages = state.messages || {};
  for (const cat of cats) {
    const chId = chanIds.get(norm(chanName(cat.id)));
    if (!chId) continue;
    const msgs = chunkEmbeds(buildEmbeds(cat));
    const known = state.messages[cat.id] || [];
    const nowIds = [];
    for (let i = 0; i < msgs.length; i += 1) {
      const payload = { embeds: msgs[i] };
      try {
        if (known[i]) {
          await rest('PATCH', `/channels/${chId}/messages/${known[i]}`, payload);
          nowIds.push(known[i]);
        } else {
          const made = await rest('POST', `/channels/${chId}/messages`, payload);
          nowIds.push(made.id);
        }
      } catch (e) {
        // a message we cannot edit (deleted by a human, say) is re-posted rather than abandoned
        try {
          const made = await rest('POST', `/channels/${chId}/messages`, payload);
          nowIds.push(made.id);
        } catch { results.push({ kind: 'index', category: cat.id, ok: false, reason: e.message }); }
      }
    }
    state.messages[cat.id] = nowIds;
    results.push({ kind: 'index', category: cat.id, ok: true, messages: nowIds.length, articles: (cat.articles || []).length });
  }
  saveState(state, statePath);
  return results;
}

// ── CLI ─────────────────────────────────────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('discord-wiki-sections.mjs')) {
  const args = process.argv.slice(2);
  const guildId = args[args.indexOf('--guild') + 1];
  const apply = args.includes('--apply');
  if (!guildId || guildId.startsWith('--')) {
    console.error('usage: DISCORD_TOKEN=… node integrations/discord-wiki-sections.mjs --guild <id> [--apply]');
    process.exit(2);
  }
  const cats = await fetchWiki();
  const existing = await fetchGuildChannels(guildId);
  const plan = planWikiSections(cats, existing);
  console.log(renderPlan(plan));
  if (!apply) { console.log('(dry-run — pass --apply to execute)'); process.exit(0); }
  const res = await applyPlan(guildId, plan, cats, existing);
  const bad = res.filter((r) => !r.ok);
  console.log(`applied: ${res.length - bad.length}/${res.length} ops ok`);
  for (const b of bad) console.log(`  FAILED ${b.kind} ${b.name || b.category}: ${b.reason}`);
}
