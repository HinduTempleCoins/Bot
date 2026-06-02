// crawlers.mjs — get indexed everywhere. A comprehensive robots.txt that explicitly welcomes every
// major search + AI crawler, plus IndexNow (instant, keyless submission to Bing/Yandex/Seznam) and a
// Bing sitemap ping. The sites are read-only public data — we WANT maximal crawling.

// every crawler we explicitly welcome. `*` already allows all; listing them is an explicit invite
// and lets us welcome AI crawlers by name (some operators block these — we don't).
export const CRAWLERS = [
  // search
  'Googlebot', 'Bingbot', 'Slurp', 'DuckDuckBot', 'YandexBot', 'Baiduspider', 'Applebot',
  'Sogou', 'Exabot', 'facebookexternalhit', 'Twitterbot', 'LinkedInBot', 'Pinterestbot',
  // AI / LLM crawlers (welcomed — our content wants to be in the models)
  'GPTBot', 'ChatGPT-User', 'OAI-SearchBot', 'ClaudeBot', 'anthropic-ai', 'Claude-Web',
  'PerplexityBot', 'Perplexity-User', 'Google-Extended', 'CCBot', 'Amazonbot', 'Applebot-Extended',
  'Bytespider', 'Meta-ExternalAgent', 'cohere-ai', 'Diffbot', 'Timpibot', 'Omgilibot',
];

/** A welcoming robots.txt: explicit Allow for every named crawler + a permissive wildcard + sitemap. */
export function robotsTxt(baseUrl) {
  const blocks = CRAWLERS.map((ua) => `User-agent: ${ua}\nAllow: /`).join('\n\n');
  return `# The SoapBox ecosystem welcomes all crawlers, including AI/LLM crawlers.\n${blocks}\n\nUser-agent: *\nAllow: /\n\nSitemap: ${baseUrl}/sitemap.xml\n`;
}

// ── IndexNow — instant URL submission to Bing, Yandex, Seznam, Naver (one POST, no account) ──
// The key is a public verification token hosted at /<key>.txt; it is NOT a secret.
export const INDEXNOW_KEY = process.env.INDEXNOW_KEY || 'a1b2c3d4e5f6478890123456789abcde';

let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

/** Submit a batch of URLs (same host) to IndexNow. Returns the HTTP status. Best-effort. */
export async function submitToIndexNow(baseUrl, urls = []) {
  const host = new URL(baseUrl).host;
  const urlList = [...new Set(urls)].map((u) => (u.startsWith('http') ? u : `${baseUrl}${u}`)).slice(0, 10000);
  if (!urlList.length) return { ok: false, reason: 'no urls' };
  const body = { host, key: INDEXNOW_KEY, keyLocation: `${baseUrl}/${INDEXNOW_KEY}.txt`, urlList };
  try {
    const r = await _fetch('https://api.indexnow.org/indexnow', {
      method: 'POST', headers: { 'content-type': 'application/json; charset=utf-8' }, body: JSON.stringify(body),
    });
    return { ok: r.ok || r.status === 202, status: r.status, count: urlList.length };
  } catch (e) { return { ok: false, reason: e.message }; }
}

/** Ping Bing to re-read the sitemap (Google deprecated its sitemap ping; use Search Console + IndexNow). */
export async function pingSitemap(baseUrl) {
  const sm = encodeURIComponent(`${baseUrl}/sitemap.xml`);
  try { const r = await _fetch(`https://www.bing.com/ping?sitemap=${sm}`); return { ok: r.ok, status: r.status }; }
  catch (e) { return { ok: false, reason: e.message }; }
}

if (process.argv[1] && process.argv[1].endsWith('crawlers.mjs')) {
  const base = process.argv[3] || 'https://data.soapbox.community';
  if (process.argv[2] === 'robots') console.log(robotsTxt(base));
  else if (process.argv[2] === 'submit') console.log(JSON.stringify(await submitToIndexNow(base, process.argv.slice(4))));
  else console.log(`crawlers: ${CRAWLERS.length} welcomed. usage: robots|submit <base> <urls...>`);
}
