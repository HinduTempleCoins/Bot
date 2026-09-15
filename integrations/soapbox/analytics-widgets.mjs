// analytics-widgets.mjs — THE WIDGET LAYER OVER THE FIRST-PARTY COLLECTOR.
//
// The dashboard was three rank tables and a bar chart. WordPress figured out thirty years ago that a
// stats page is not one view, it is a BOARD of small answers a person can scan in ten seconds: what
// happened today, where did they come from, which page did the work, what is broken.
//
// So this is a registry of independent widgets over the same event array. Each widget is a pure
// function of events → {id, title, note, html}. Nothing here reads the disk, nothing here fetches, and
// every widget renders its own ZERO STATE rather than a zero — "no data yet" and "0 visits" mean very
// different things and only one of them is honest before the collector has been deployed.
//
// ⭐ TWO WIDGETS EXIST THAT WORDPRESS DOES NOT HAVE, AND THEY ARE THE POINT:
//
//   • `traffic-sources` separates AI ASSISTANT referrals (chatgpt.com, claude.ai, perplexity.ai,
//     copilot, gemini) from ordinary search. That is the traffic class that actually matters to a
//     network whose robots.txt deliberately invites every AI crawler, and no stock analytics package
//     breaks it out yet.
//   • `coverage` is a Site-Health-shaped widget that lists the properties with NO data. On a network of
//     105 surfaces the useful question is not "which page won" but "which twelve pages are dark",
//     because a dark page is either unvisited or un-deployed and those need different fixes.
//
// ⚠️ AND ONE WIDGET EXISTS TO STATE A LIMITATION RATHER THAN HIDE IT: `crawler-blindness`. A JS/pixel
// beacon cannot see a crawler, because crawlers do not run the script. Any "bot %" derived from the
// beacon is wrong and wrong in the flattering direction. The widget says so and points at the Caddy
// log parser, which is the instrument that can actually answer it.

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const num = (n) => Number(n || 0).toLocaleString('en-US');
const pct = (n, d) => (d > 0 ? `${Math.round((n / d) * 1000) / 10}%` : '—');

// ── referrer classification ──────────────────────────────────────────────────────────────────────────
// Host-only matching, because the store keeps only the referrer HOST. Ordered: the AI check runs before
// the search check so that copilot.microsoft.com is not filed as Bing.
const AI_ASSISTANTS = [
  'chatgpt.com', 'chat.openai.com', 'openai.com', 'claude.ai', 'anthropic.com',
  'perplexity.ai', 'copilot.microsoft.com', 'gemini.google.com', 'bard.google.com',
  'you.com', 'phind.com', 'poe.com', 'grok.com', 'x.ai',
];
const SEARCH = [
  'google.', 'bing.com', 'duckduckgo.com', 'search.yahoo.', 'yandex.', 'baidu.com',
  'search.brave.com', 'ecosia.org', 'startpage.com', 'mojeek.com', 'qwant.com', 'naver.com',
  'seznam.cz', 'lite.duckduckgo.com',
];
const SOCIAL = [
  'reddit.com', 'x.com', 'twitter.com', 't.co', 'facebook.com', 'fb.com', 'instagram.com',
  'linkedin.com', 'lnkd.in', 'mastodon.', 'bsky.app', 'pinterest.', 'tumblr.com',
  'youtube.com', 'youtu.be', 'tiktok.com', 'news.ycombinator.com', 'lobste.rs', 'discord.com',
  'telegram.', 't.me', 'whatsapp.com',
];

// The collector stores a visit with no referrer as the literal string '(direct)', not as an empty
// field. Matching only on '' put every direct visit into "Other sites" — which reads as a referral
// from a site that does not exist, and quietly erases the largest and most valuable bucket a
// young site has. Both spellings map to direct.
export const DIRECT_TOKENS = Object.freeze(['', '(direct)', 'direct', '-']);

/**
 * ⚠️ Host matching is done on LABEL BOUNDARIES, never as a substring, and this is not pedantry:
 * a naive `host.includes('x.com')` classifies EVERY ONE of our own `*box.community` hosts as a
 * referral from X — "soap**box.com**munity". The bug is silent, it only hits our own domains, and it
 * would have shown Twitter as a top referrer forever.
 *
 * A pattern ending in '.' is a family prefix ('google.' matches google.com, google.co.uk, www.google.de).
 * Anything else is a domain: exact match, or a subdomain of it.
 */
export function hostMatches(host, pattern) {
  const h = String(host || '').toLowerCase();
  const p = String(pattern || '').toLowerCase();
  if (!h || !p) return false;
  if (p.endsWith('.')) {
    const stem = p.slice(0, -1);
    return h === stem || h.startsWith(p) || h.includes(`.${p}`);
  }
  return h === p || h.endsWith(`.${p}`);
}

/** Which bucket does a referrer host fall in? No referrer → 'direct'. Our own hosts → 'internal'. */
export function classifyReferrer(ref, ownHosts = []) {
  const h = String(ref || '').toLowerCase().trim();
  if (DIRECT_TOKENS.includes(h)) return 'direct';
  const own = (ownHosts || []).map((x) => String(x || '').toLowerCase());
  if (own.some((o) => o && (h === o || h.endsWith(`.${o}`)))) return 'internal';
  if (AI_ASSISTANTS.some((a) => hostMatches(h, a))) return 'ai-assistant';
  if (SEARCH.some((x) => hostMatches(h, x))) return 'search';
  if (SOCIAL.some((x) => hostMatches(h, x))) return 'social';
  return 'other';
}

export const SOURCE_LABELS = Object.freeze({
  search: 'Search engines',
  'ai-assistant': 'AI assistants',
  social: 'Social & forums',
  direct: 'Direct / no referrer',
  internal: 'Our own network',
  other: 'Other sites',
});

// ── derivations (pure, testable without any HTML) ────────────────────────────────────────────────────
const bump = (o, k) => { o[k] = (o[k] || 0) + 1; };
const rank = (o, n = 10) => Object.entries(o)
  .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, n);

export function trafficSources(events = [], ownHosts = []) {
  const out = {};
  for (const e of events) bump(out, classifyReferrer(e && e.ref, ownHosts));
  return out;
}

export function byDay(events = []) {
  const o = {};
  for (const e of events) { const d = e && e.day; if (d) bump(o, d); }
  return Object.entries(o).sort((a, b) => (a[0] < b[0] ? -1 : 1));
}

/** Today vs yesterday and last 7 days vs the 7 before, as counts + a direction. No forecasting. */
export function trend(events = [], today = new Date().toISOString().slice(0, 10)) {
  const days = Object.fromEntries(byDay(events));
  const at = (offset) => {
    const d = new Date(`${today}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - offset);
    return days[d.toISOString().slice(0, 10)] || 0;
  };
  const window = (from, to) => { let s = 0; for (let i = from; i < to; i++) s += at(i); return s; };
  const t = at(0), y = at(1);
  const w = window(0, 7), pw = window(7, 14);
  return {
    today: t, yesterday: y, dayDelta: t - y,
    last7: w, prev7: pw, weekDelta: w - pw,
    measuredDays: Object.keys(days).length,
  };
}

/** Which of the known properties have produced NOTHING yet. The actionable half of the board. */
export function coverage(events = [], knownHosts = []) {
  const seen = new Set();
  for (const e of events) if (e && e.host) seen.add(String(e.host).toLowerCase());
  const known = [...new Set((knownHosts || []).map((h) => String(h || '').toLowerCase()).filter(Boolean))];
  const dark = known.filter((h) => !seen.has(h));
  return {
    known: known.length,
    live: known.filter((h) => seen.has(h)).length,
    dark,
    unknownSeen: [...seen].filter((h) => !known.includes(h)).sort(),
  };
}

export function devices(events = []) {
  const o = {};
  for (const e of events) bump(o, (e && e.device) || 'unknown');
  return o;
}

export function topPaths(events = [], n = 10) {
  const o = {};
  for (const e of events) if (e && e.path) bump(o, `${e.host || ''}${e.path}`);
  return rank(o, n);
}

export function topHosts(events = [], n = 10) {
  const o = {};
  for (const e of events) if (e && e.host) bump(o, e.host);
  return rank(o, n);
}

export function topReferrers(events = [], n = 10) {
  const o = {};
  for (const e of events) {
    if (!e || !e.ref) continue;
    if (DIRECT_TOKENS.includes(String(e.ref).toLowerCase())) continue; // not a referring site
    bump(o, e.ref);
  }
  return rank(o, n);
}

// ── rendering helpers ────────────────────────────────────────────────────────────────────────────────
const EMPTY = (what) => `<p class="wz">No data yet — <b>${esc(what)}</b> will appear here once the
collector is deployed and a surface is visited. This is a zero-state, not a zero.</p>`;

function barRows(rows, total, hrefFn = null) {
  if (!rows.length) return '';
  const max = Math.max(...rows.map((r) => r[1]), 1);
  return `<ol class="wrank">${rows.map(([k, v]) => {
    const label = hrefFn ? `<a href="${esc(hrefFn(k))}">${esc(k)}</a>` : esc(k);
    return `<li><span class="wbar" style="width:${Math.round((v / max) * 100)}%"></span>
<span class="wlab">${label}</span><span class="wnum">${esc(num(v))}${total ? ` <i>${esc(pct(v, total))}</i>` : ''}</span></li>`;
  }).join('')}</ol>`;
}

function sparkline(series, w = 260, h = 44) {
  if (!series.length) return '';
  const vals = series.map((s) => s[1]);
  const max = Math.max(...vals, 1);
  const step = series.length > 1 ? w / (series.length - 1) : w;
  const pts = vals.map((v, i) => `${Math.round(i * step)},${Math.round(h - (v / max) * (h - 4)) - 1}`).join(' ');
  return `<svg class="wspark" viewBox="0 0 ${w} ${h}" width="100%" height="${h}" role="img"
aria-label="Pageviews over ${series.length} days, peak ${max}"><polyline points="${pts}"
fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>`;
}

const arrow = (d) => (d > 0 ? `<b class="up">▲ ${esc(num(d))}</b>` : d < 0 ? `<b class="down">▼ ${esc(num(-d))}</b>` : '<b class="flat">— no change</b>');

// ── the widgets ──────────────────────────────────────────────────────────────────────────────────────
// Each: { id, title, render(events, ctx) -> html }. ctx: { ownHosts, knownHosts, today, logsUrl }.
export const WIDGETS = Object.freeze([
  {
    id: 'at-a-glance',
    title: 'At a glance',
    render(events, ctx = {}) {
      const t = trend(events, ctx.today);
      const hosts = topHosts(events, 1000).length;
      const paths = topPaths(events, 100000).length;
      if (!events.length) return EMPTY('total pageviews, properties and pages');
      return `<div class="wkpi">
<div><b>${esc(num(events.length))}</b><span>Pageviews</span></div>
<div><b>${esc(num(hosts))}</b><span>Properties</span></div>
<div><b>${esc(num(paths))}</b><span>Pages</span></div>
<div><b>${esc(num(t.measuredDays))}</b><span>Days measured</span></div>
</div>`;
    },
  },
  {
    id: 'trend',
    title: 'Today and this week',
    render(events, ctx = {}) {
      if (!events.length) return EMPTY('the day-over-day and week-over-week comparison');
      const t = trend(events, ctx.today);
      return `<table class="wtbl">
<tr><td>Today</td><td class="wnum">${esc(num(t.today))}</td><td>${arrow(t.dayDelta)} vs yesterday</td></tr>
<tr><td>Last 7 days</td><td class="wnum">${esc(num(t.last7))}</td><td>${arrow(t.weekDelta)} vs the 7 before</td></tr>
</table>
${t.measuredDays < 14 ? `<p class="wz">Only ${esc(String(t.measuredDays))} day${t.measuredDays === 1 ? '' : 's'} of data
exist, so the week-over-week comparison is against a partly empty window. It becomes meaningful at 14 days.</p>` : ''}`;
    },
  },
  {
    id: 'views-by-day',
    title: 'Pageviews per day',
    render(events) {
      const series = byDay(events);
      if (!series.length) return EMPTY('the daily traffic line');
      const last = series.slice(-60);
      return `${sparkline(last)}<p class="wz">${esc(last[0][0])} → ${esc(last[last.length - 1][0])},
peak ${esc(num(Math.max(...last.map((s) => s[1]))))} in a day.</p>`;
    },
  },
  {
    id: 'top-properties',
    title: 'Which properties get the traffic',
    render(events) {
      const rows = topHosts(events, 15);
      if (!rows.length) return EMPTY('the property leaderboard');
      return `${barRows(rows, events.length, (h) => `https://${h}`)}
<p class="wz">This is the answer to the one question a network of this size cannot infer: <b>which of
the surfaces actually earns attention.</b> It is also the table an advertiser is buying from.</p>`;
    },
  },
  {
    id: 'top-content',
    title: 'Top pages',
    render(events) {
      const rows = topPaths(events, 15);
      if (!rows.length) return EMPTY('the page leaderboard');
      return barRows(rows, events.length, (p) => `https://${p}`);
    },
  },
  {
    id: 'traffic-sources',
    title: 'Where visitors come from',
    render(events, ctx = {}) {
      if (!events.length) return EMPTY('the search / AI / social / direct split');
      const src = trafficSources(events, ctx.ownHosts || []);
      const rows = Object.entries(SOURCE_LABELS)
        .map(([k, label]) => [label, src[k] || 0])
        .filter((r) => r[1] > 0)
        .sort((a, b) => b[1] - a[1]);
      const ai = src['ai-assistant'] || 0;
      return `${barRows(rows, events.length)}
<p class="wz"><b>AI assistants are broken out on purpose.</b> A referral from chatgpt.com or claude.ai
is a person who was <i>told about us by a model</i> — a different and more valuable visit than a search
click, and the class of traffic our crawler-welcoming robots.txt exists to earn.
${ai ? `Currently ${esc(num(ai))} of ${esc(num(events.length))} visits (${esc(pct(ai, events.length))}).`
    : 'None recorded yet.'}</p>`;
    },
  },
  {
    id: 'referrers',
    title: 'Referring sites',
    render(events) {
      const rows = topReferrers(events, 15);
      if (!rows.length) return EMPTY('the referring-site list');
      return barRows(rows, null, (h) => `https://${h}`);
    },
  },
  {
    id: 'devices',
    title: 'Devices',
    render(events) {
      if (!events.length) return EMPTY('the device split');
      const rows = Object.entries(devices(events)).sort((a, b) => b[1] - a[1]);
      return `${barRows(rows, events.length)}
<p class="wz">Deliberately coarse — no version, no model. The user-agent string is used to derive this
bucket in memory and is then discarded, never stored.</p>`;
    },
  },
  {
    id: 'coverage',
    title: 'Properties with no data',
    render(events, ctx = {}) {
      const c = coverage(events, ctx.knownHosts || []);
      if (!c.known) return EMPTY('the coverage check');
      return `<div class="wkpi"><div><b>${esc(num(c.live))}</b><span>Reporting</span></div>
<div><b>${esc(num(c.dark.length))}</b><span>Dark</span></div></div>
${c.dark.length ? `<ol class="wrank wdark">${c.dark.map((h) => `<li><span class="wlab">${esc(h)}</span></li>`).join('')}</ol>
<p class="wz"><b>A dark property is either un-visited or un-deployed, and those need opposite fixes.</b>
Check it resolves and returns the beacon tag before concluding nobody came.</p>`
    : '<p class="wz">Every known property has reported at least one visit.</p>'}
${c.unknownSeen.length ? `<p class="wz">Also reporting but not in the registry:
${c.unknownSeen.map((h) => `<code>${esc(h)}</code>`).join(' ')} — add them to <code>PUBLIC_SITES</code>.</p>` : ''}`;
    },
  },
  {
    id: 'crawler-blindness',
    title: '⚠️ What this dashboard cannot see',
    render(events, ctx = {}) {
      const bots = (devices(events).bot || 0);
      return `<p class="wz"><b>Crawlers do not run JavaScript, so a beacon cannot count them.</b>
Any bot percentage derived from this page is wrong, and wrong in the flattering direction — it makes
human traffic look like a larger share than it is.
${bots ? `The ${esc(num(bots))} bot hit${bots === 1 ? '' : 's'} recorded here came through the
<code>&lt;noscript&gt;</code> pixel and are a floor, not a count.` : ''}</p>
<p class="wz"><b>The instrument that can answer it is the Caddy access-log parser</b>
(<code>integrations/soapbox/analytics.mjs</code>), which sees every request including GPTBot, ClaudeBot,
PerplexityBot and CCBot${ctx.logsUrl ? ` — <a href="${esc(ctx.logsUrl)}">server-log view</a>` : ''}.
Read the two together; neither is complete alone.</p>`;
    },
  },
]);

export const widget = (id) => WIDGETS.find((w) => w.id === String(id || '')) || null;
export const WIDGET_IDS = WIDGETS.map((w) => w.id);

/** One widget, framed. Never throws — a broken widget shows its error, it does not take the page down. */
export function renderWidget(id, events = [], ctx = {}) {
  const w = widget(id);
  if (!w) return '';
  let body;
  try { body = w.render(events || [], ctx || {}); }
  catch (e) { body = `<p class="wz">This widget failed to render: ${esc(e && e.message)}</p>`; }
  return `<section class="wcard" id="w-${esc(w.id)}"><h2>${esc(w.title)}</h2>${body}</section>`;
}

/** The whole board, in registry order, or a chosen subset. */
export function renderBoard(events = [], ctx = {}, ids = WIDGET_IDS) {
  return `<div class="wgrid">${ids.map((id) => renderWidget(id, events, ctx)).join('')}</div>`;
}

export const WIDGET_STYLE = `<style>
.wgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:14px;align-items:start}
.wcard{background:var(--panel,#16191d);border:1px solid var(--line,#232830);border-radius:14px;padding:15px 16px}
.wcard h2{font-size:13px;letter-spacing:.8px;text-transform:uppercase;color:var(--mut,#98a0a9);margin:0 0 12px}
.wkpi{display:flex;flex-wrap:wrap;gap:16px}
.wkpi div{min-width:78px}.wkpi b{display:block;font-size:26px;letter-spacing:-.5px;font-variant-numeric:tabular-nums}
.wkpi span{font-size:11px;text-transform:uppercase;letter-spacing:.6px;color:var(--mut,#98a0a9)}
.wrank{list-style:none;margin:0;padding:0}
.wrank li{position:relative;display:flex;justify-content:space-between;gap:10px;padding:7px 9px;margin:0 0 3px;border-radius:7px;font-size:14px;overflow:hidden}
.wbar{position:absolute;inset:0 auto 0 0;background:currentColor;opacity:.13;border-radius:7px}
.wlab{position:relative;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wnum{position:relative;font-variant-numeric:tabular-nums;white-space:nowrap}
.wnum i{opacity:.6;font-style:normal;font-size:12px}
.wdark li{opacity:.7}
.wtbl{width:100%;border-collapse:collapse;font-size:14px}
.wtbl td{padding:7px 0;border-bottom:1px solid var(--line,#232830)}
.wtbl .wnum{font-weight:700}
.wspark{display:block;color:var(--up,#3fb950);margin:2px 0 8px}
.wz{color:var(--mut,#98a0a9);font-size:12.5px;line-height:1.5;margin:11px 0 0}
.up{color:var(--up,#3fb950)}.down{color:var(--down,#f85149)}.flat{color:var(--mut,#98a0a9);font-weight:400}
.wcard a{color:inherit}
</style>`;
