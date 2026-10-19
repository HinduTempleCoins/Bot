// discord-feed.mjs — link everything we publish into the Van Kush Community Discord.
//
// Operator (2026-10-19): "We need all the Wikis and Webpages and @Hathor Posts and @Melek Posts and
// Forum Posts to be Linked in the Discord."
//
// Sources → channels (channel ids come from env, see CHANNEL_ENV):
//   wiki     every /wiki/ page in wiki.soapbox.community/sitemap.xml   → #library-of-ashurbanipal
//   hathor   @hathor's own posts on MELEK (get_discussions_by_blog)   → #witness-hathor
//   melek    @melek's own posts on MELEK                               → #announcements
//   forum    every thread in forum.soapbox.community's thread sitemap  → #forum
//   webpages the working sites and pages from the site-map inventory   → #directory
//
// Every item is posted once. A run with more than DIGEST_AT new items in a source (the first backfill,
// a big wiki batch) posts them as link digests with embeds suppressed; a run with a few new items posts
// each one on its own line with Discord's link preview. Posted URLs are kept in a JSON state file.
//
// The planner is pure (planMessages) and offline-testable. Network goes through an injected fetch.
// The bot token comes from env at call time and is never logged. The CLI defaults to a dry run.
//
//   DISCORD_TOKEN=… FEED_STATE=… WEBPAGES_JSON=… node integrations/discord-feed.mjs [--apply] [--only wiki,hathor]
//
// Exports: SOURCES, collect*, planMessages, chunkLines, postMessages, runFeed, __setFetch, __setSleep

import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';

const API = 'https://discord.com/api/v10';
const UA = 'MELEK-Bot discord-feed (+https://github.com/HinduTempleCoins/Bot)';
const RPC = process.env.MELEK_RPC || 'https://melek.salon/rpc';
const WIKI = process.env.WIKI_BASE || 'https://wiki.soapbox.community';
const FORUM = process.env.FORUM_BASE || 'https://forum.soapbox.community';
const MELEK_SITE = 'https://melek.salon';
export const DIGEST_AT = 5;
const MAX_LEN = 1900; // Discord's limit is 2000; leave room
const SUPPRESS_EMBEDS = 1 << 2;

let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }
let _sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export function __setSleep(fn) { _sleep = fn || ((ms) => new Promise((r) => setTimeout(r, ms))); }

export const SOURCES = {
  wiki: { env: 'DISCORD_CH_WIKI', label: 'Wiki — Library of Ashurbanipal', single: 'New on the wiki' },
  hathor: { env: 'DISCORD_CH_HATHOR', label: "Hathor's posts on MELEK", single: 'New from @hathor' },
  melek: { env: 'DISCORD_CH_MELEK', label: "@melek's posts on MELEK", single: 'New from @melek' },
  forum: { env: 'DISCORD_CH_FORUM', label: 'SoapBox Forum threads', single: 'New on the forum' },
  webpages: { env: 'DISCORD_CH_DIRECTORY', label: 'Our sites and pages', single: 'New page' },
};

const clean = (s) => String(s == null ? '' : s).replace(/[\r\n]+/g, ' ').replace(/[*_~`|>[\]]/g, '').replace(/\s+/g, ' ').trim();
const locs = (xml) => [...String(xml || '').matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1].replace(/&amp;/g, '&'));

async function getText(url) {
  try { const r = await _fetch(url, { headers: { 'user-agent': UA } }); return r.ok ? await r.text() : ''; } catch { return ''; }
}
async function rpc(method, params) {
  try {
    const r = await _fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
    const j = await r.json(); return j && j.result;
  } catch { return null; }
}

/** Wiki: every article URL in the sitemap, titled from its slug. Oldest-first order is the sitemap's. */
export async function collectWiki() {
  return locs(await getText(`${WIKI}/sitemap.xml`))
    .filter((u) => /\/wiki\/[^/]+$/.test(u))
    .map((url) => ({ url, title: decodeURIComponent(url.split('/wiki/')[1]).replace(/_/g, ' ') }));
}

/** An account's own top-level posts (no reblogs), oldest first. */
export async function collectPosts(account) {
  const all = []; let start = null;
  for (let i = 0; i < 50; i++) {
    const q = { tag: account, limit: 100 };
    if (start) { q.start_author = start.author; q.start_permlink = start.permlink; }
    const r = await rpc('condenser_api.get_discussions_by_blog', [q]);
    if (!Array.isArray(r) || !r.length) break;
    const page = start ? r.slice(1) : r;
    all.push(...page);
    start = r[r.length - 1];
    if (r.length < 100 || !page.length) break;
  }
  return all.filter((p) => p.author === account)
    .sort((a, b) => String(a.created).localeCompare(String(b.created)))
    .map((p) => ({ url: `${MELEK_SITE}/@${p.author}/${p.permlink}`, title: clean(p.title) || p.permlink }));
}

/** Forum: thread URLs from the thread sitemap shards, titled from each thread page's <title>. */
export async function collectForum() {
  const index = locs(await getText(`${FORUM}/sitemap.xml`));
  const shards = index.filter((u) => /sitemap-threads-\d+\.xml$/.test(u));
  if (!shards.length) shards.push(`${FORUM}/sitemap-threads-1.xml`);
  const urls = [];
  for (const s of shards) for (const u of locs(await getText(s))) if (/\/t\/[^/]+$/.test(u) && !urls.includes(u)) urls.push(u);
  const out = [];
  for (const url of urls) {
    const m = (await getText(url)).match(/<title>([^<]*)<\/title>/i);
    const title = m ? clean(m[1].replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+—\s+SoapBox Forum$/, '')) : '';
    out.push({ url, title: title || url.split('/').pop() });
  }
  return out;
}

/** Webpages: the working sites from the site-map inventory export ({ sites: [{ host, pages:[{url,title}] }] }). */
export function collectWebpages(json) {
  const out = [];
  for (const s of (json && json.sites) || []) {
    for (const p of s.pages || []) {
      if (!/^https:\/\//.test(p.url || '')) continue;
      out.push({ url: p.url, title: clean(p.title) || p.url.replace(/^https:\/\//, ''), group: s.host });
    }
  }
  return out;
}

/** Split lines into messages under MAX_LEN, each starting with `head(i)`. Pure. */
export function chunkLines(lines, head) {
  const msgs = []; let cur = [];
  const len = (arr) => arr.join('\n').length;
  for (const l of lines) {
    if (cur.length && len([head(msgs.length), ...cur, l]) > MAX_LEN) { msgs.push(cur); cur = []; }
    cur.push(l.length > MAX_LEN - 100 ? l.slice(0, MAX_LEN - 100) : l);
  }
  if (cur.length) msgs.push(cur);
  return msgs.map((c, i) => [head(i, msgs.length), ...c].join('\n'));
}

const line = (it) => `• [${it.title.slice(0, 120)}](<${it.url}>)`;

/**
 * Plan the messages for one source. Pure.
 * items: [{url,title,group?}] oldest first; posted: Set of urls already posted.
 * Returns { fresh: items not yet posted, messages: [{content, flags?}] }.
 */
export function planMessages(source, items, posted) {
  const meta = SOURCES[source];
  const fresh = items.filter((it) => it && it.url && !posted.has(it.url));
  if (!fresh.length) return { fresh, messages: [] };
  if (fresh.length <= DIGEST_AT) {
    return { fresh, messages: fresh.map((it) => ({ content: `**${meta.single}:** ${it.title.slice(0, 200)}\n${it.url}` })) };
  }
  const lines = [];
  let group = null;
  for (const it of fresh) {
    if (it.group && it.group !== group) { group = it.group; lines.push(`**${group}**`); }
    lines.push(line(it));
  }
  const messages = chunkLines(lines, (i, n) => `**${meta.label}** — ${fresh.length} links${n > 1 ? ` (part ${i + 1} of ${n})` : ''}`)
    .map((content) => ({ content, flags: SUPPRESS_EMBEDS }));
  return { fresh, messages };
}

/** Post messages to a channel in order, honouring 429 retry_after. Returns how many were posted. */
export async function postMessages(channelId, messages, token) {
  let n = 0;
  for (const m of messages) {
    let sent = false;
    for (let attempt = 0; attempt < 5 && !sent; attempt++) {
      const r = await _fetch(`${API}/channels/${channelId}/messages`, {
        method: 'POST',
        headers: { authorization: `Bot ${token}`, 'content-type': 'application/json', 'user-agent': UA },
        body: JSON.stringify({ ...m, allowed_mentions: { parse: [] } }),
      });
      if (r.status === 429) {
        const j = await r.json().catch(() => ({}));
        await _sleep(Math.ceil(((j && j.retry_after) || 2) * 1000) + 250);
        continue;
      }
      if (!r.ok) throw new Error(`post to ${channelId} -> HTTP ${r.status}`);
      n++;
      sent = true;
    }
    if (!sent) throw new Error(`post to ${channelId} still rate-limited after 5 tries`);
    await _sleep(1200);
  }
  return n;
}

function loadState(file) {
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return {}; }
}
function saveState(file, state) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file + '.new', JSON.stringify(state, null, 1)); renameSync(file + '.new', file);
}

/**
 * Collect, plan and (with apply) post every source. A source whose collection comes back empty is
 * skipped, so an outage never looks like "nothing to post" or wipes state.
 */
export async function runFeed({ apply = false, only = null, env = process.env, stateFile, webpagesJson } = {}) {
  const state = loadState(stateFile);
  const report = [];
  for (const source of Object.keys(SOURCES)) {
    if (only && !only.includes(source)) continue;
    const channel = env[SOURCES[source].env];
    if (!channel) { report.push({ source, skipped: `no ${SOURCES[source].env}` }); continue; }
    let items = [];
    if (source === 'wiki') items = await collectWiki();
    else if (source === 'hathor') items = await collectPosts('hathor');
    else if (source === 'melek') items = await collectPosts('melek');
    else if (source === 'forum') items = await collectForum();
    else if (source === 'webpages') {
      let json = null; try { json = webpagesJson && existsSync(webpagesJson) ? JSON.parse(readFileSync(webpagesJson, 'utf8')) : null; } catch {}
      items = collectWebpages(json);
    }
    if (!items.length) { report.push({ source, skipped: 'source returned nothing' }); continue; }
    const posted = new Set(state[source] || []);
    const plan = planMessages(source, items, posted);
    const row = { source, items: items.length, fresh: plan.fresh.length, messages: plan.messages.length };
    if (apply && plan.messages.length) {
      try {
        row.posted = await postMessages(channel, plan.messages, env.DISCORD_TOKEN);
        state[source] = [...posted, ...plan.fresh.map((it) => it.url)];
        saveState(stateFile, state);
      } catch (e) { row.error = e.message; }
    }
    report.push(row);
  }
  return report;
}

// ── CLI ──────────────────────────────────────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('discord-feed.mjs')) {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const oi = args.indexOf('--only');
  const only = oi >= 0 ? args[oi + 1].split(',') : null;
  if (apply && !process.env.DISCORD_TOKEN) { console.error('DISCORD_TOKEN is not set'); process.exit(2); }
  const report = await runFeed({
    apply, only,
    stateFile: process.env.FEED_STATE || 'data/discord-feed-state.json',
    webpagesJson: process.env.WEBPAGES_JSON || 'data/discord-webpages.json',
  });
  for (const r of report) console.log(`[discord-feed] ${JSON.stringify(r)}`);
  if (!apply) console.log('[discord-feed] dry run — pass --apply to post');
}
