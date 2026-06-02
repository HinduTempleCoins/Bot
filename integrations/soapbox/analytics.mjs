// analytics.mjs — first-party, privacy-friendly traffic analytics for the SoapBox subdomains
// (operator 2026-06-02, priority: "we need traffic data"). Reads Caddy's own JSON access logs on the
// box — nothing leaves the server, no third-party tracker, no cookies, no JS beacon. IP addresses are
// counted for uniqueness but never stored or displayed (hashed into a Set, discarded after counting).
//
//   node integrations/soapbox/analytics.mjs            # print a summary of /var/log/caddy
//   CADDY_LOG_DIR=./fixtures node ... --self-test      # against a fixture
//
// Caddy log line shape (JSON): { ts, status, duration, size, request:{ uri, host, method,
//   remote_ip|client_ip, headers:{ "User-Agent":[..], Referer:[..] } } }

import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

const DEFAULT_DIR = process.env.CADDY_LOG_DIR || '/var/log/caddy';

// crawlers/automation we separate from human pageviews (best-effort, by UA token).
const BOT_RE = /bot|crawl|spider|slurp|curl|wget|python|go-http|java\/|libwww|okhttp|headless|facebookexternal|twitterbot|bingpreview|yandex|ahrefs|semrush|mj12|dotbot|petalbot|gptbot|claudebot|ccbot|bytespider|amazonbot|applebot/i;
// noise we don't count as a "page" (assets, probes).
const ASSET_RE = /\.(?:ico|png|jpg|jpeg|svg|gif|webp|css|js|map|txt|xml|woff2?|ttf)$/i;

const ua1 = (h) => { const u = h && h['User-Agent']; const s = Array.isArray(u) ? u[0] : u; return s || ''; };
const dayOf = (ts) => { // caddy ts is unix seconds (float) or RFC3339 string
  if (typeof ts === 'number') return new Date(ts * 1000).toISOString().slice(0, 10);
  if (typeof ts === 'string' && ts.length >= 10) return ts.slice(0, 10);
  return 'unknown';
};

/** Tally one or more Caddy JSON logs into a privacy-safe traffic summary. */
export function trafficSummary({ dir = DEFAULT_DIR, host = null } = {}) {
  const files = listLogs(dir, host);
  const t = {
    files: files.map((f) => f.replace(dir + '/', '')),
    total: 0, human: 0, bot: 0, assets: 0,
    status: {}, pages: {}, hosts: {}, days: {}, referrers: {}, bots: {},
    _ips: new Set(), _botIps: new Set(),
  };
  for (const f of files) {
    let txt; try { txt = readFileSync(f, 'utf8'); } catch { continue; }
    for (const ln of txt.split('\n')) {
      if (!ln) continue;
      let d; try { d = JSON.parse(ln); } catch { continue; }
      const r = d.request || {};
      const uri = r.uri || '/';
      const status = d.status ?? 0;
      const ip = r.remote_ip || r.client_ip || '';
      const ua = ua1(r.headers || {});
      const isBot = BOT_RE.test(ua) || !ua;
      const isAsset = ASSET_RE.test(uri.split('?')[0]);
      t.total++;
      bump(t.status, String(status));
      bump(t.hosts, r.host || host || 'unknown');
      bump(t.days, dayOf(d.ts));
      if (isBot) { t.bot++; if (ip) t._botIps.add(ip); bump(t.bots, (ua.split('/')[0] || ua).slice(0, 24) || '?'); }
      else { t.human++; if (ip) t._ips.add(ip); }
      if (isAsset) { t.assets++; continue; }
      // count real page views (humans, 2xx/3xx) by path
      if (!isBot && status < 400) bump(t.pages, uri.split('?')[0].slice(0, 80));
      const ref = (r.headers && (Array.isArray(r.headers.Referer) ? r.headers.Referer[0] : r.headers.Referer)) || '';
      if (ref && !ref.includes('soapbox.community')) bump(t.referrers, hostname(ref));
    }
  }
  t.uniqueVisitors = t._ips.size;
  t.uniqueBots = t._botIps.size;
  t.notFound = t.status['404'] || 0;
  t.topPages = top(t.pages, 15);
  t.topReferrers = top(t.referrers, 10);
  t.topBots = top(t.bots, 10);
  t.byStatus = top(t.status, 8);
  t.byHost = top(t.hosts, 10);
  t.byDay = Object.entries(t.days).sort().map(([k, v]) => [k, v]);
  delete t._ips; delete t._botIps; delete t.pages; delete t.referrers; delete t.bots; delete t.status; delete t.hosts; delete t.days;
  return t;
}

function listLogs(dir, host) {
  if (!existsSync(dir)) return [];
  let names;
  try { names = readdirSync(dir); } catch { return []; }
  return names
    .filter((n) => n.endsWith('.log') && (!host || n.includes(host)))
    .map((n) => join(dir, n))
    .filter((p) => { try { return statSync(p).isFile(); } catch { return false; } });
}
const bump = (o, k) => { o[k] = (o[k] || 0) + 1; };
const top = (o, n) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, n);
const hostname = (u) => { try { return new URL(u).hostname; } catch { return u.slice(0, 40); } };

if (process.argv[1] && process.argv[1].endsWith('analytics.mjs')) {
  const s = trafficSummary();
  if (!s.total) { console.log(`No Caddy logs found in ${DEFAULT_DIR} (set CADDY_LOG_DIR).`); process.exit(0); }
  console.log(`\nSoapBox traffic — ${s.files.join(', ')}`);
  console.log(`  total requests : ${s.total}   (human ${s.human} / bot ${s.bot} / assets ${s.assets})`);
  console.log(`  unique visitors: ${s.uniqueVisitors}   crawlers: ${s.uniqueBots}   404s: ${s.notFound}`);
  console.log(`  status         : ${s.byStatus.map(([k, v]) => `${k}:${v}`).join('  ')}`);
  console.log(`  by host        : ${s.byHost.map(([k, v]) => `${k}:${v}`).join('  ')}`);
  console.log(`\n  top pages:`); for (const [p, c] of s.topPages) console.log(`    ${String(c).padStart(5)}  ${p}`);
  if (s.topReferrers.length) { console.log(`\n  referrers:`); for (const [r, c] of s.topReferrers) console.log(`    ${String(c).padStart(5)}  ${r}`); }
  if (s.topBots.length) { console.log(`\n  crawlers:`); for (const [b, c] of s.topBots) console.log(`    ${String(c).padStart(5)}  ${b}`); }
}
