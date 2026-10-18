// site/melek-explore/build.mjs — the Explore MELEK page (https://melek.salon/explore): one page that finds
// EVERYTHING in the MELEK / PRANA / KULA / SoapBox estate, grouped into sections, with a search box. The
// tab bar stays short (All Posts · Admin Updates · Witness Updates · Members · Groups · MELEK Move); this page
// is where the MELEK logo, the condenser's menu ("Explore MELEK") and the sidebar "Explore MELEK?" box lead.
//
// Honest by construction: at build time every link is fetched (short timeout) and anything not answering
// 2xx/3xx is left out and named in the build log, so the page never shows a dead link. A page whose own
// title says alpha / testnet / demo / beta gets that label. Public hosts only — admin and private hosts are
// never in the catalog, and a blocklist drops them even if one is added by mistake.
//
// Built on a timer and written as one static file (the last good build stays up).
//
//   EXPLORE_OUT=/var/www/melek-admin/explore/index.html node site/melek-explore/build.mjs
//   import { CATALOG, checkLinks, renderExplorePage } from './build.mjs'   // tests
import { writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';
import { TABS, esc } from '../melek-admin/build.mjs';

const env = (k, d) => (typeof process !== 'undefined' && process.env && process.env[k]) || d;
const SITE = 'https://melek.salon';

// Hosts that must never be listed publicly (admin / private / internal collectors).
export const BLOCKED_HOSTS = [/(^|\.)soapy\.blog$/i, /^analytics\./i, /^admin\./i, /^127\./, /^localhost$/i, /^10\./, /^192\.168\./];
export const isBlocked = (url) => { try { const h = new URL(url).hostname; return BLOCKED_HOSTS.some((re) => re.test(h)); } catch { return true; } };

// [icon, name, one-line description, url, label?]  label: 'alpha' | 'testnet' | 'demo' (also detected from the page title)
export const CATALOG = [
  { id: 'social', title: 'Social & community', icon: '💬', items: [
    ['📰', 'All Posts', 'Every post on MELEK: hot, trending and new.', `${SITE}/trending`],
    ['🆕', 'New posts', 'The newest posts, as they are published.', `${SITE}/created`],
    ['🏷️', 'Explore by tag', 'Browse posts by topic.', `${SITE}/tags`],
    ['📣', 'Admin Updates', "What MELEK's admins are building and what is live.", `${SITE}/`],
    ['⛓️', 'Witness Updates', 'News from the witnesses who run the chain.', `${SITE}/witness-updates`],
    ['🎖️', 'Members', 'Posts from people Hathor has promoted for quality.', `${SITE}/members`],
    ['👥', 'Groups & Clubs (Pact)', 'Join or start groups, clubs and channels.', 'https://pact.pentecaust.com/'],
    ['✉️', 'Messages (Pentecaust)', 'Private messages between MELEK accounts.', 'https://pentecaust.com/'],
    ['🗨️', 'Community Chat', 'The MELEK chat room.', `${SITE}/chat`],
    ['🗂️', 'Forum', 'MELEK community boards.', 'https://forum.soapbox.community/'],
    ['🐦', 'Congress', 'Short-form social posts on the chain.', 'https://alpha.congress.ink/', 'alpha'],
  ] },
  { id: 'create', title: 'Create', icon: '✍️', items: [
    ['📝', 'Write a post', 'Write and publish a post on MELEK.', `${SITE}/submit.html`],
    ['📌', 'Pinboard', 'Post photos and albums, or save pictures you found.', `${SITE}/pin`],
    ['📖', 'Hathor Metatron', 'Draft chapters, track your word count, export your book.', 'https://pentecaust.com/metatron'],
    ['🗓️', '50,000 words in November', 'The November novel challenge, with Hathor.', 'https://pentecaust.com/metatron/november'],
    ['🎵', 'Hathor Sandalphon', 'Plan and write songs, build beats.', 'https://pentecaust.com/sandalphon'],
    ['🎨', 'Image studio', "Make pictures with Hathor's studio.", 'https://hathor.soapbox.community/'],
    ['🎬', 'Bifrost video', "Upload a video to MELEK's video platform.", 'https://hathor.soapbox.community/pentecaust/bifrost/upload'],
  ] },
  { id: 'learn', title: 'Learn & library', icon: '📚', items: [
    ['👋', 'Welcome guide', 'Quick start: how MELEK works.', `${SITE}/welcome`],
    ['❓', 'FAQ', 'Answers to common questions.', `${SITE}/faq.html`],
    ['🏛️', 'Library of Ashurbanipal', 'The wiki: history, plants, medicine, mysteries and MELEK itself.', 'https://wiki.soapbox.community/'],
    ['🎓', 'Witness School', 'Learn to run a witness and connect to the pool.', 'https://witness.melek.salon/'],
    ['📜', 'The Hierophant', "The Temple's library of the world's sacred texts.", 'https://hierophant.soapbox.community/'],
    ['📗', 'SoapBox Library', 'Public-domain books and documents.', 'https://library.soapbox.community/'],
    ['🗣️', 'Hathor Language Center', 'Learn Spanish, Kurdish and French.', 'https://language.soapbox.community/'],
    ['🔖', 'KULA Paper', 'The economic spec for PRANA and KULA.', 'https://kula-paper.melek.salon/'],
    ['🧾', 'PRANA Paper', 'The technical and consensus spec for the PRANA chain.', 'https://prana-paper.melek.salon/'],
    ['🎞️', 'Films', 'Where to watch any film, and audience reviews.', 'https://stream.soapbox.community/films'],
    ['📺', 'SoapBox Stream', 'Films and shows to stream.', 'https://stream.soapbox.community/'],
    ['📡', 'Tune In', 'Browse and watch channels.', 'https://tunein.soapbox.community/'],
    ['🎧', 'Music', 'Music to listen to.', 'https://stream.soapbox.community/music'],
    ['🗞️', 'SoapBox Newsroom', 'Our own wire plus the full industry-category portal.', 'https://herald.soapbox.community/newsroom'],
    ['▶️', 'Media Player', 'A web media player with playlists.', 'https://player.soapbox.community/'],
  ] },
  { id: 'civic', title: 'Law, civics & consumer help', icon: '⚖️', items: [
    ['⚖️', 'SoapBox Law', 'Case law, statutes, regulations and judges.', 'https://law.soapbox.community/'],
    ['📘', 'Legal Lexicon', 'Dictionaries versus the law, and sources of authority.', 'https://lexicon.soapbox.community/'],
    ['🏛️', 'Politics', 'Congress, elections, lobbying and accountability.', 'https://politics.soapbox.community/'],
    ['🗽', 'Free Speech & Sedition', 'The law of speech and dissent.', 'https://free-speech.soapbox.community/'],
    ['📚', 'The Case Law of Us', 'American history told through the case reporters.', 'https://caselaw.soapbox.community/'],
    ['🕵️', 'Faux Law Files', 'Sovereign-citizen encounters and the real law they misread.', 'https://encounters.soapbox.community/'],
    ['🌿', 'Hemp', 'US cannabis law and reform.', 'https://hemp.soapbox.community/'],
    ['📞', 'Oversight', 'Who do I call? Consumer-protection agencies.', 'https://oversight.soapbox.community/'],
    ['🚨', 'Scam Alert', 'Check a company against official records.', 'https://scam-alert.soapbox.community/'],
    ['🎲', 'Gambling education', 'House edge, odds and expected value, explained.', 'https://gambling.soapbox.community/'],
  ] },
  { id: 'play', title: 'Earn & play', icon: '🎮', items: [
    ['👟', 'MELEK Move', 'Step counter and geo-miner app.', 'https://move.melek.salon/'],
    ['⛏️', 'Mining pool', 'Mine in your browser or with your own rig.', 'https://pool.soapbox.community/'],
    ['🖥️', 'Mine PRANA', 'Copy-paste GPU mining guide.', 'https://witness.melek.salon/mine'],
    ['🗳️', 'Auto-Vote', 'Set up automatic curation votes.', 'https://vote.melek.salon/'],
    ['🕹️', 'KULA Arcade', 'Games played with play tokens.', 'https://arcade.soapbox.community/'],
    ['🎯', 'PRANA Games', 'Play on the MELEK ecosystem.', 'https://games.soapbox.community/'],
    ['⏳', 'Idle-Time Games', 'Browser games.', 'https://idlegames.soapbox.community/'],
    ['🐾', 'Critter Keep', 'Adopt and raise a virtual critter.', 'https://pets.soapbox.community/'],
    ['🌱', 'Kush Farm', 'A farming game.', 'https://kush.soapbox.community/'],
    ['🚜', 'KULA Farm', 'Farm the ecosystem tokens.', 'https://farm.soapbox.community/'],
    ['🌰', 'Seeds', 'Seeds for the farm games.', 'https://seeds.soapbox.community/'],
    ['🛒', 'Seed Shop', 'Buy seeds, tools and compost for the farm.', 'https://shop.melek.salon/'],
    ['🎡', 'Daily Spin', 'A daily spin for PLAY points.', 'https://spin.soapbox.community/'],
    ['🗺️', 'The Frontier', 'Claim land on the game map.', 'https://map.soapbox.community/'],
    ['🌌', 'Dudael', 'The metaverse.', 'https://dudael.com/'],
  ] },
  { id: 'money', title: 'Wallet & tokens', icon: '👛', items: [
    ['👛', 'MELEK Wallet', 'Balances, transfers, staking and rewards.', 'https://wallet.melek.salon/'],
    ['🗳️', 'Vote for witnesses', 'Choose who runs the chain.', 'https://wallet.melek.salon/~witnesses'],
    ['📋', 'Proposals', 'Funding proposals voted on by stake.', 'https://wallet.melek.salon/proposals'],
    ['🔁', 'KulaSwap', 'The MELEK ecosystem exchange.', 'https://kula.money/'],
    ['🌉', 'Bridge', 'Move VKBT and CURE to and from PRANA.', 'https://kula.money/bridge.html'],
    ['💡', 'How KulaSwap works', 'A plain guide to swapping and pools.', 'https://kula.money/learn.html'],
    ['🔎', 'MELEKd explorer', 'Blocks, accounts and transactions on MELEK.', 'https://melekd.hathor.live/'],
    ['🔍', 'PRANA explorer', 'Blocks, addresses and contracts on PRANA.', 'https://pranascan.soapbox.community/'],
    ['🪙', 'MELEK-Engine', 'Side tokens on MELEK.', 'https://engine.melek.salon/'],
    ['🧪', 'MELEK Tokens', 'Create and trade tokens.', 'https://tokens.alpha.melek.salon/', 'alpha'],
    ['📈', 'Staking', 'Delegate and earn.', 'https://staking.alpha.melek.salon/', 'alpha'],
  ] },
  { id: 'hathor', title: 'Hathor (AI)', icon: '☥', items: [
    ['💬', 'Talk to Hathor', 'Her always-on public chat.', 'https://hathor.live/'],
    ['✍️', "Hathor's posts", 'What Hathor writes on MELEK.', `${SITE}/@hathor`],
    ['📊', 'Hathor, live', 'Her witness status: blocks, feed and votes.', 'https://witness.melek.salon/hathor'],
    ['⌨️', "Hathor's !commands", 'The command menu she answers.', 'https://alpha.melek.salon/commands/', 'testnet'],
    ['🌐', 'Hathor on the fediverse', 'Follow Hathor from Mastodon and other fediverse apps.', 'https://hathor.social.melek.salon/'],
    ['🧠', 'Your engines', 'Choose which AI engine Hathor uses, or add your own.', 'https://hathor.soapbox.community/engines'],
    ['🔊', '40Hz', 'Binaural-beat and entrainment sessions.', 'https://hathor.live/40hz'],
    ['🖼️', 'Hathor Gallery', 'Reference set and design lineage of Hathor.', 'https://gallery.melek.salon/'],
  ] },
  { id: 'tools', title: 'Tools & data', icon: '🧰', items: [
    ['🔎', 'SoapBox Search', 'Search the web and our sites.', 'https://search.soapbox.community/'],
    ['🧰', 'SoapBox Tools', 'Everyday web tools.', 'https://tools.soapbox.community/'],
    ['📊', 'Global Markets', 'Market data across asset classes.', 'https://data.soapbox.community/'],
    ['📈', 'Stocks', 'The stock index.', 'https://stocks.soapbox.community/'],
    ['📁', 'Directory', 'Site rankings and crypto resources.', 'https://directory.soapbox.community/'],
    ['💼', 'Portfolio tracker', 'Track a crypto portfolio and watchlist.', 'https://profile.soapbox.community/'],
    ['💰', 'Grants', 'Find a grant by field.', 'https://grants.soapbox.community/'],
    ['🎓', 'Credentials', 'Get credentialed, by industry.', 'https://credentials.soapbox.community/'],
    ['🧑‍💼', 'Jobs', 'Jobs, freelance gigs and courses.', 'https://jobs.soapbox.community/'],
    ['📷', 'Cams', 'Live public cameras.', 'https://cams.soapbox.community/'],
    ['🗺️', 'MELEK Maps', 'Search a place and see what is near it, on OpenStreetMap.', 'https://melek.salon/maps'],
    ['📠', 'Fax', 'Send a fax from the browser.', 'https://fax.soapbox.community/'],
  ] },
  { id: 'dev', title: 'Developers', icon: '🛠️', items: [
    ['📘', 'Developer docs', 'Guides for building on MELEK and PRANA.', 'https://witness.melek.salon/dev'],
    ['⛓️', 'MELEK API', 'The public RPC and how to call it.', 'https://witness.melek.salon/dev/melek'],
    ['🧱', 'PRANA API', 'The PRANA EVM chain for developers.', 'https://witness.melek.salon/dev/prana'],
    ['🤖', 'Bots', 'Write a bot for MELEK.', 'https://witness.melek.salon/dev/bots'],
    ['🪙', 'Make a token', 'Issue a token on the ecosystem.', 'https://witness.melek.salon/dev/token'],
    ['🧪', 'MELEK testnet', 'Try everything on the testnet first.', 'https://alpha.melek.salon/', 'testnet'],
    ['🧩', 'MELEK-Engine (testnet)', 'Side tokens on the testnet.', 'https://engine.alpha.melek.salon/', 'testnet'],
    ['💻', 'Hathor (Bot) on GitHub', 'The open-source AI witness and these sites.', 'https://github.com/HinduTempleCoins/Bot'],
    ['💻', 'melek-chain on GitHub', 'The MELEK blockchain node.', 'https://github.com/HinduTempleCoins/melek-chain'],
    ['💻', 'melek-condenser on GitHub', 'The melek.salon front end, self-hostable.', 'https://github.com/HinduTempleCoins/melek-condenser'],
    ['💻', 'PRANA on GitHub', 'The PRANA chain: node, contracts, wallet.', 'https://github.com/HinduTempleCoins/PRANA'],
    ['💻', 'KULASwap on GitHub', 'The exchange contracts.', 'https://github.com/HinduTempleCoins/KULASwap'],
  ] },
  { id: 'account', title: 'Account & safety', icon: '🔐', items: [
    ['✨', 'Sign up', 'Create a MELEK account.', `${SITE}/account/signup.html`],
    ['🔑', 'Log in', 'Sign in to melek.salon.', `${SITE}/login.html`],
    ['🖊️', 'MELEK Signer', 'Log in to MELEK apps with your MELEK account.', 'https://signer.melek.salon/'],
    ['🆕', 'Signer sign-up', 'Create an account through the Signer.', 'https://signer.melek.salon/signup'],
    ['🛟', 'Recover an account', 'Get back into an account you lost.', 'https://signer.melek.salon/recover'],
    ['🖼️', 'Profile picture', 'Change your profile picture.', `${SITE}/account/profile.html`],
    ['🔏', 'Privacy', 'What we collect and why.', `${SITE}/privacy.html`],
    ['📄', 'Terms', 'Terms of service.', `${SITE}/tos.html`],
    ['📮', 'Contact', 'Reach the team.', 'https://contact.soapbox.community/'],
  ] },
  { id: 'family', title: 'The wider family', icon: '🌳', items: [
    ['🌳', 'SoapBox Community', 'Map of the MELEK, PRANA and KULA sites.', 'https://soapbox.community/'],
    ['🏡', 'Van Kush Family', 'The Van Kush Family site and roadmap.', 'https://vankushfamily.com/'],
  ] },
];

const LABEL_RE = /\b(alpha|testnet|demo|beta)\b/i;

/** Fetch each URL (GET, short timeout, redirects followed). Keeps 2xx/3xx; reports the rest. Never throws. */
export async function checkLinks(urls, { fetch: f = globalThis.fetch, timeoutMs = 8000, concurrency = 8 } = {}) {
  const res = new Map();
  const queue = [...new Set(urls)];
  async function one(url) {
    if (isBlocked(url)) { res.set(url, { ok: false, why: 'blocked host' }); return; }
    const ac = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const t = ac ? setTimeout(() => ac.abort(), timeoutMs) : null;
    try {
      const r = await f(url, { method: 'GET', redirect: 'follow', signal: ac && ac.signal, headers: { 'user-agent': 'melek-explore-linkcheck/1' } });
      const status = Number(r && r.status) || 0;
      let title = '';
      try { const body = String(await r.text()).slice(0, 20000); const m = /<title[^>]*>([^<]*)/i.exec(body); title = m ? m[1].trim() : ''; } catch { /* soft */ }
      res.set(url, status >= 200 && status < 400 ? { ok: true, status, title } : { ok: false, status, why: `HTTP ${status}` });
    } catch (e) {
      res.set(url, { ok: false, why: (e && e.name === 'AbortError') ? `timeout ${timeoutMs}ms` : `error ${(e && (e.cause && e.cause.code)) || (e && e.message) || e}` });
    } finally { if (t) clearTimeout(t); }
  }
  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => { while (queue.length) await one(queue.shift()); });
  await Promise.all(workers);
  return res;
}

/** Catalog filtered to live links, each item with its label (static, or detected from the page title). */
export function liveCatalog(checks, catalog = CATALOG) {
  const dropped = [];
  const sections = catalog.map((s) => ({ ...s, items: s.items.filter(([, name, , url]) => {
    const c = checks.get(url);
    if (c && c.ok && !isBlocked(url)) return true;
    dropped.push({ section: s.title, name, url, why: (c && c.why) || 'not checked' });
    return false;
  }).map(([icon, name, desc, url, label]) => {
    const c = checks.get(url) || {};
    const t = LABEL_RE.exec(c.title || '');
    return { icon, name, desc, url, label: label || (t ? t[1].toLowerCase() : '') };
  }) })).filter((s) => s.items.length);
  return { sections, dropped };
}

export function renderExplorePage(sections, { builtAt = new Date() } = {}) {
  const total = sections.reduce((n, s) => n + s.items.length, 0);
  const lead = 'Links to MELEK sites and pages, grouped by section.';
  const jump = sections.map((s) => `<a href="#${esc(s.id)}">${esc(s.icon)} ${esc(s.title)}</a>`).join('');
  const body = sections.map((s) => `<section class=sec id="${esc(s.id)}"><h2>${esc(s.icon)} ${esc(s.title)} <small>${s.items.length}</small></h2>
<ul class=grid>
${s.items.map((i) => `<li class=it data-q="${esc(`${i.name} ${i.desc} ${s.title} ${new URL(i.url).hostname}`.toLowerCase())}"><a href="${esc(i.url)}"><span class=ic aria-hidden=true>${esc(i.icon)}</span><span class=tx><b>${esc(i.name)}</b>${i.label ? ` <span class=lab>${esc(i.label)}</span>` : ''}<span class=d>${esc(i.desc)}</span><span class=h>${esc(new URL(i.url).hostname + (new URL(i.url).pathname === '/' ? '' : new URL(i.url).pathname))}</span></span></a></li>`).join('\n')}
</ul></section>`).join('\n');
  return `<!doctype html><html lang=en><head><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">
<title>Explore MELEK</title>
<meta name=description content="${esc(lead)}">
<link rel=canonical href="${SITE}/explore">
<style>
:root{--bg:#f7f8fa;--fg:#1a1d24;--mut:#6b7280;--card:#fff;--line:#e5e7eb;--gold:#f5a623}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){--bg:#0f1218;--fg:#e5e7eb;--mut:#9ca3af;--card:#161a22;--line:#2a2f3a}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,-apple-system,Segoe UI,sans-serif}
header{display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:space-between;padding:12px 16px;background:var(--card);border-bottom:1px solid var(--line)}
header .brand{font-weight:800;font-size:20px;color:#f39c12;text-decoration:none}
nav a{color:var(--fg);text-decoration:none;margin:0 10px;padding:6px 0;border-bottom:3px solid transparent}
nav{white-space:nowrap}
@media(max-width:640px){header{padding:10px 12px 0}nav{order:3;width:100%;overflow-x:auto;display:flex;gap:14px;margin:4px -12px 0;padding:0 12px;font-size:14px}nav a{margin:0;padding:8px 0}}
.pill{display:inline-block;margin-right:8px;padding:5px 11px;border:2px solid #eab308;border-radius:6px;color:inherit;text-decoration:none;font-weight:700}
.pill.post{background:#eab308;color:#171f24}
@media(max-width:700px){.acts{order:2;width:100%;display:flex;gap:8px;margin:6px 0 4px}.acts .pill{flex:1;text-align:center;margin:0;padding:7px 0}}
.cta{background:#1a1d24;color:#fff;padding:8px 14px;border-radius:6px;text-decoration:none;font-weight:700;border-bottom:3px solid var(--gold)}
main{max-width:1100px;margin:0 auto;padding:20px 16px}
h1{margin:6px 0 10px}
.search{position:sticky;top:0;z-index:5;background:var(--bg);padding:8px 0 10px}
.search input{width:100%;font:inherit;font-size:17px;padding:11px 14px;border:1px solid var(--line);border-radius:10px;background:var(--card);color:var(--fg);outline-color:var(--gold)}
.jump{display:flex;flex-wrap:wrap;gap:6px;margin:4px 0 6px}
.jump a{font-size:13px;color:var(--fg);text-decoration:none;border:1px solid var(--line);background:var(--card);border-radius:999px;padding:3px 10px}
.count{color:var(--mut);font-size:13px;margin:4px 0 0}
.sec{margin:22px 0 0}.sec h2{font-size:20px;margin:0 0 10px;scroll-margin-top:80px}.sec h2 small{color:var(--mut);font-weight:400;font-size:13px}
.grid{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:10px}
.it a{display:flex;gap:10px;height:100%;padding:10px 12px;background:var(--card);border:1px solid var(--line);border-radius:10px;color:inherit;text-decoration:none}
.it a:hover,.it a:focus{border-color:var(--gold)}
.ic{font-size:22px;line-height:1.2;flex:none;width:28px;text-align:center}
.tx{min-width:0}.tx b{font-size:15px}.d{display:block;color:var(--mut);font-size:13px}.h{display:block;color:var(--mut);font-size:11px;opacity:.8;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lab{display:inline-block;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;padding:0 6px;border-radius:999px;background:#1a1d24;color:#fff;border-bottom:2px solid var(--gold);vertical-align:2px}
.wiki{display:flex;gap:10px;align-items:center;margin:0 0 8px;padding:12px 14px;background:var(--card);border:2px solid var(--gold);border-radius:10px;color:inherit;text-decoration:none}.wiki b{font-size:18px}
.none{color:var(--mut);display:none}
footer{color:var(--mut);font-size:13px;text-align:center;padding:24px 16px}
@media(max-width:600px){.grid{grid-template-columns:1fr}}
</style></head><body>
<header><a class=brand href="${SITE}/explore" aria-current=page title="Explore MELEK">MELEK</a><nav>${TABS.map((t) => `<a href="${esc(t.href)}">${esc(t.label)}</a>`).join('')}</nav>
<span class=acts><a class="pill post" href="${SITE}/submit.html">Post</a><a class=pill href="https://engine.melek.salon/">Trade</a><a class=pill href="https://wallet.melek.salon/~witnesses">Vote</a></span><span><a href="${SITE}/login.html" style="margin-right:10px;color:inherit">Log in</a><a class=cta href="${SITE}/account/signup.html">Sign up</a></span></header>
<main><h1>Explore MELEK</h1>
<a class=wiki href="https://wiki.soapbox.community/"><span class=ic>🏛️</span><span class=tx><b>Wiki</b><span class=d>Library of Ashurbanipal</span></span></a>
<div class=search><input id=q type=search placeholder="Search ${total} places: wallet, mining, music, library…" aria-label="Search everything on MELEK" autocomplete=off>
<p class=count id=count aria-live=polite>${total} places in ${sections.length} sections</p></div>
<div class=jump>${jump}</div>
${body}
<p class=none id=none>Nothing matches. Try a shorter word, or <a href="https://search.soapbox.community/">search the web</a>.</p>
</main>
<footer>Every link on this page answered when it was checked at ${esc(builtAt.toISOString().slice(0, 16).replace('T', ' '))} UTC · <a href="${SITE}/trending">back to All Posts</a></footer>
<script>
(function(){var q=document.getElementById('q'),items=[].slice.call(document.querySelectorAll('.it')),secs=[].slice.call(document.querySelectorAll('.sec')),cnt=document.getElementById('count'),none=document.getElementById('none'),total=items.length,nsec=secs.length;
function run(){var w=(q.value||'').toLowerCase().trim().split(/\\s+/).filter(Boolean),n=0;
items.forEach(function(li){var s=li.getAttribute('data-q'),hit=w.every(function(x){return s.indexOf(x)>=0});li.style.display=hit?'':'none';if(hit)n++});
secs.forEach(function(s){var any=s.querySelector('.it:not([style*="none"])');s.style.display=any?'':'none'});
cnt.textContent=w.length?n+' of '+total+' places match':total+' places in '+nsec+' sections';none.style.display=n?'none':'block'}
q.addEventListener('input',run);if(location.hash==='#search')q.focus();})();
</script>
<script src="https://pentecaust.com/translate.js" defer></script>
</body></html>`;
}

if (process.argv[1] && process.argv[1].endsWith('build.mjs') && process.argv[1].includes('melek-explore')) {
  const urls = CATALOG.flatMap((s) => s.items.map((i) => i[3]));
  const checks = await checkLinks(urls, { timeoutMs: Number(env('EXPLORE_TIMEOUT_MS', '10000')) });
  const { sections, dropped } = liveCatalog(checks);
  for (const d of dropped) console.log(`[explore] dropped ${d.url} (${d.section} / ${d.name}): ${d.why}`);
  const total = sections.reduce((n, s) => n + s.items.length, 0);
  if (total < urls.length / 2) {   // the network itself is down: keep the last good page
    console.log(`[explore] only ${total}/${urls.length} links answered — keeping the last good page`);
  } else {
    const out = env('EXPLORE_OUT', '/var/www/melek-admin/explore/index.html');
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out + '.new', renderExplorePage(sections)); renameSync(out + '.new', out);
    console.log(`[explore] ${total}/${urls.length} links live in ${sections.length} sections -> ${out}`);
  }
}
