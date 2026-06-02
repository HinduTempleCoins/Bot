// social-broadcast.mjs — fan Hathor's announcements out to social channels (task #110).
//
// Hathor's official voice lives in ONE place: the signed announcements feed (see
// integrations/soapbox/announcements.mjs), served as RSS at data.soapbox.community/announcements.xml.
// This module reads that feed (plus any ecosystem RSS), normalizes the items, and renders each one
// for each target channel — Telegram, Discord, Twitter/X, and a Hive post body.
//
// It produces a PLAN: exactly what WOULD be posted, per channel. It does NOT post anything — there
// are no credentials on this host by construction (zero-WIF / zero-token rule). A wired bot or an
// n8n flow (which DO hold the per-channel creds) consumes broadcastPlan() and does the sending.
// That keeps this module ToS-clean and key-free: the feed is the single source of Hathor's voice,
// and the broadcasters are downstream automations connected once to the operator's social accounts.
//
//   import { broadcastPlan, latestItems, formatForChannel, FEEDS } from './social-broadcast.mjs'
//   const plan = await broadcastPlan({ limit: 5 })   // [{ item, posts: { telegram, discord, 'twitter/x', hive } }]
//   node integrations/social-broadcast.mjs            # print the plan (human-readable)
//   node integrations/social-broadcast.mjs --json     # print the plan as JSON (for a wired sender)
//
// A wired bot / n8n consumes it like this:
//   for (const { item, posts } of await broadcastPlan()) {
//     await telegram.send(CHAT_ID, posts.telegram, { parse_mode: 'Markdown' });
//     await discord.webhook(URL, { content: posts.discord });
//     await x.tweet(posts['twitter/x']);
//     // posts.hive → broadcast a `comment` op via MELEK-Signer (Hive post body)
//   }
// De-dup against already-sent guids is the SENDER's job (it has the persisted "last sent" cursor);
// this module just emits the current plan, newest first.

import { fetchClean } from './scraper.mjs';
import { cached, TTL } from './soapbox/cache.mjs';

const SITE = (process.env.SOAPBOX_SITE || 'https://data.soapbox.community').replace(/\/$/, '');
const SIGNATURE = process.env.HATHOR_SIGNATURE || '— Hathor 𓂀, MELEK AI Witness';

// The source feeds. Hathor's own announcements RSS is the primary, load-bearing one; ecosystem
// feeds (extra MELEK / community RSS) can be added via SOCIAL_EXTRA_FEEDS (comma-separated URLs).
export const FEEDS = [
  { id: 'hathor', name: 'Hathor — Announcements', url: `${SITE}/announcements.xml`, primary: true },
  ...((process.env.SOCIAL_EXTRA_FEEDS || '')
    .split(',').map((s) => s.trim()).filter(Boolean)
    .map((url, i) => ({ id: `ecosystem-${i + 1}`, name: 'Ecosystem feed', url, primary: false }))),
];

export const CHANNELS = ['telegram', 'discord', 'twitter/x', 'hive'];

// ── feed parsing ──────────────────────────────────────────────────────────
// A tiny, dependency-free RSS/Atom reader. We only need title/link/guid/date/summary; no XML lib.

function unescapeXml(s = '') {
  return String(s)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#3?9;|&apos;/g, "'").replace(/&amp;/g, '&')
    .trim();
}

function tag(block, name) {
  // first <name ...>...</name> (RSS) — non-greedy, dot-all
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? unescapeXml(m[1]) : '';
}

// strip residual markup + the signature line from a summary, collapse whitespace.
function cleanSummary(s = '') {
  return unescapeXml(s)
    .replace(/<[^>]+>/g, ' ')
    .split('\n').filter((ln) => ln.trim() !== SIGNATURE).join(' ')
    .replace(/\s+/g, ' ').trim();
}

// Jina Reader (the scraper's primary) renders RSS into MARKDOWN, not raw XML. We prefer raw XML
// (direct fetch), but parse the markdown shape too so the module is robust either way. The markdown
// form looks like:  ### [Title](link)\n\nSummary — signature\n\n[link](link)\n\n2026-06-02T...Z
function parseMarkdownFeed(md = '', feedUrl = '') {
  const items = [];
  // split on each heading-link entry
  const re = /\n#{2,3}\s+\[([^\]]+)\]\(([^)]+)\)\s*\n([\s\S]*?)(?=\n#{2,3}\s+\[|$(?![\s\S]))/g;
  let m;
  while ((m = re.exec(md))) {
    const title = m[1].trim();
    const link = m[2].trim();
    const body = m[3] || '';
    const ts = (body.match(/\b(\d{4}-\d{2}-\d{2}T[\d:.]+Z)\b/) || [])[1] || '';
    const summary = cleanSummary(
      body
        .replace(/\[[^\]]*\]\([^)]*\)/g, ' ')          // drop markdown links
        .replace(/\b\d{4}-\d{2}-\d{2}T[\d:.]+Z\b/g, '') // drop the timestamp
    );
    if (!title && !summary) continue;
    items.push({ id: link || `${title}|${ts}`, title, url: link || feedUrl, summary, ts });
  }
  return items;
}

/** Parse RSS/Atom XML — or the markdown shape Jina returns — into normalized items. Best-effort. */
export function parseFeed(xml = '', feedUrl = '') {
  if (typeof xml !== 'string' || !xml.trim()) return [];
  // not real XML (e.g. Jina markdown) → try the markdown parser
  if (!/<(item|entry)[\s>]/i.test(xml)) return parseMarkdownFeed(xml, feedUrl);
  const items = [];
  const isAtom = /<entry[\s>]/i.test(xml) && !/<item[\s>]/i.test(xml);
  const blocks = xml.match(isAtom ? /<entry[\s\S]*?<\/entry>/gi : /<item[\s\S]*?<\/item>/gi) || [];
  for (const block of blocks) {
    let link = tag(block, 'link');
    if (isAtom && !link) { const m = block.match(/<link[^>]*href=["']([^"']+)["']/i); link = m ? m[1] : ''; }
    const title = tag(block, 'title');
    const summary = cleanSummary(tag(block, 'description') || tag(block, 'summary') || tag(block, 'content'));
    const ts = tag(block, 'pubDate') || tag(block, 'updated') || tag(block, 'published') || '';
    const guid = tag(block, 'guid') || tag(block, 'id') || link || title;
    if (!title && !summary) continue;
    items.push({ id: guid, title, url: link || feedUrl, summary, ts });
  }
  return items;
}

// ── latest items ──────────────────────────────────────────────────────────

// Fetch the feed body. Prefer a DIRECT raw-XML fetch (RSS parses cleanly from XML); fall back to
// the scraper's fetchClean — but note Jina renders RSS into markdown, so parseFeed handles both.
async function fetchFeedBody(url) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 15000);
    try {
      const r = await globalThis.fetch(url, {
        signal: ctrl.signal,
        headers: { 'user-agent': 'MELEK-Bot/1.0 (+https://github.com/HinduTempleCoins/Bot)', accept: 'application/rss+xml, application/xml, text/xml, */*' },
      });
      if (r.ok) {
        const body = await r.text();
        if (/<(item|entry|rss|feed)[\s>]/i.test(body)) return body;  // got real XML
      }
    } finally { clearTimeout(t); }
  } catch { /* fall through to scraper */ }
  // fallback: scraper (may hand back Jina markdown — parseFeed copes)
  const { markdown } = await fetchClean(url, { maxChars: 60000, fresh: true });
  return markdown || '';
}

async function fetchFeedItems(feed) {
  try {
    const body = await fetchFeedBody(feed.url);
    return parseFeed(body, feed.url).map((it) => ({ ...it, feed: feed.id }));
  } catch {
    return [];
  }
}

/**
 * Pull recent items across all FEEDS, normalized + deduped (by id, else title+ts), newest first.
 * Cached (list TTL) with single-flight + stale-on-error via the condenser cache. Never throws.
 */
export async function latestItems({ limit = 10 } = {}) {
  try {
    const all = await cached(`social:feeds:${FEEDS.map((f) => f.id).join(',')}`, TTL.list, async () => {
      const lists = await Promise.all(FEEDS.map(fetchFeedItems));
      const seen = new Set();
      const merged = [];
      for (const it of lists.flat()) {
        const key = it.id || `${it.title}|${it.ts}`;
        if (seen.has(key)) continue;
        seen.add(key);
        merged.push(it);
      }
      merged.sort((a, b) => String(b.ts || '').localeCompare(String(a.ts || '')));
      return merged;
    });
    return all.slice(0, Math.max(0, limit));
  } catch {
    return [];
  }
}

// ── per-channel formatting ──────────────────────────────────────────────────

function clip(s, n) {
  s = String(s || '');
  return s.length > n ? s.slice(0, Math.max(0, n - 1)).trimEnd() + '…' : s;
}

const fmt = {
  // Telegram: Markdown — bold title, summary, link, signature.
  telegram(item) {
    const lines = [`*${escapeMd(item.title)}*`];
    if (item.summary) lines.push(escapeMd(item.summary));
    if (item.url) lines.push(item.url);
    lines.push(`_${SIGNATURE}_`);
    return lines.join('\n\n');
  },
  // Discord: embed-ish plain text (a webhook-content style block; a richer embed object can wrap this).
  discord(item) {
    const lines = [`**${item.title}**`];
    if (item.summary) lines.push(item.summary);
    if (item.url) lines.push(`<${item.url}>`);
    lines.push(`*${SIGNATURE}*`);
    return lines.join('\n');
  },
  // Twitter/X: ≤280 chars including the link + signature. Trim the body to fit.
  'twitter/x'(item) {
    const tail = `\n${SIGNATURE}`;
    const link = item.url ? `\n${item.url}` : '';
    const room = 280 - tail.length - link.length;
    const head = item.summary ? `${item.title} — ${item.summary}` : item.title;
    return `${clip(head, room)}${link}${tail}`;
  },
  // Hive: a full post body (markdown). This is the text a `comment` op would carry via MELEK-Signer.
  hive(item) {
    const lines = [`## ${item.title}`, ''];
    if (item.summary) lines.push(item.summary, '');
    if (item.url) lines.push(`Read more: ${item.url}`, '');
    lines.push('---', SIGNATURE);
    return lines.join('\n');
  },
};

function escapeMd(s = '') { return String(s).replace(/([*_`\[])/g, '\\$1'); }

/** Render one normalized item for a given channel. Unknown channel → plain title+url. */
export function formatForChannel(item = {}, channel = 'telegram') {
  const it = { title: '', summary: '', url: '', ts: '', ...item };
  const f = fmt[channel];
  if (f) return f(it);
  return [it.title, it.url].filter(Boolean).join('\n');
}

// ── the plan ────────────────────────────────────────────────────────────────

/**
 * The ready-to-send plan: the latest items × channels, each rendered. What WOULD be posted.
 * DOES NOT post — a wired bot / n8n flow (with the per-channel creds) consumes this and sends.
 * Best-effort: never throws; returns [] if the feeds are unreachable.
 */
export async function broadcastPlan({ limit = 5, channels = CHANNELS } = {}) {
  const items = await latestItems({ limit });
  return items.map((item) => ({
    item,
    posts: Object.fromEntries(channels.map((ch) => [ch, formatForChannel(item, ch)])),
  }));
}

// ── CLI ──────────────────────────────────────────────────────────────────────

async function main() {
  const json = process.argv.includes('--json');
  const limit = +(process.argv.find((a) => /^--limit=/.test(a))?.split('=')[1] || 5);
  const plan = await broadcastPlan({ limit });

  if (json) { console.log(JSON.stringify(plan, null, 2)); return; }

  console.log('SOCIAL BROADCAST — the PLAN (what WOULD be posted).');
  console.log('This module does NOT send. Actual sending is wired separately — the Telegram/Discord');
  console.log('bots and the n8n flow hold their own per-channel creds and consume broadcastPlan().');
  console.log(`\nFeeds: ${FEEDS.map((f) => `${f.name} <${f.url}>`).join('  ·  ')}`);
  console.log(`Items: ${plan.length}  ·  Channels: ${CHANNELS.join(', ')}\n`);

  if (!plan.length) { console.log('(no items — feeds unreachable or empty)'); return; }

  for (const { item, posts } of plan) {
    console.log('━'.repeat(72));
    console.log(`${item.ts ? item.ts.slice(0, 16) + '  ' : ''}${item.title}   [${item.feed || 'feed'}]`);
    for (const ch of CHANNELS) {
      console.log(`\n· ${ch} ·`);
      console.log(posts[ch]);
    }
    console.log('');
  }
}

if (process.argv[1] && process.argv[1].endsWith('social-broadcast.mjs')) {
  main().catch((e) => { console.error('social-broadcast:', e.message); process.exit(1); });
}
