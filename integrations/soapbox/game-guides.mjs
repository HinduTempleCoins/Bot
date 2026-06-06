// game-guides.mjs — the SoapBox cheats/guides aggregator, done CLEAN. The operator's ask is "cheat
// codes, guides, walkthroughs — aggregate everything for the gamer." The legitimate way to do that is to
// LINK OUT to licensed / community sources and NEVER copy their guide text:
//   • Guide/walkthrough prose is COPYRIGHTED (GameFAQs, IGN, Fextralife, etc.). We link, we do not mirror.
//   • Game wikis are community-owned (usually CC-BY-SA) but still belong to their communities — we link
//     to the wiki, we don't republish it.
//   • The only "cheats" we ever surface inline are first-party, publicly-documented console commands a
//     game's own developer ships (e.g. the game's built-in dev console) — and even then we point to the
//     game's OWN wiki/docs rather than reproducing a list. When unsure, we link, never copy.
//
// So this module is pure URL composition: for a title it builds link-outs to the game's own wiki, Steam
// community guides, and a GameFAQs search. No scraping, no fetch (hence no __setFetch). Soft-fails to
// empty link sets; never throws.
//
// Pattern matches game-communities.mjs / worldbank.mjs: ESM, zero deps, guarded CLI, escaped HTML,
// no secrets, provenance + copyright posture note.
//
//   import { guidesFor, renderGuides, dataNote } from './game-guides.mjs'
//   node integrations/soapbox/game-guides.mjs "Stardew Valley"

import { lookupGame, steamHubUrl } from './game-communities.mjs';

// ---- pure helpers ----

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

// ---- link-out builders (all to licensed / community sources; none host guide text) ----

/** GameFAQs SEARCH link-out (their guides are copyrighted — we only link to their search). */
export function gamefaqsSearchUrl(title) {
  const t = String(title || '').trim();
  return t ? `https://gamefaqs.gamespot.com/search?game=${encodeURIComponent(t)}` : null;
}
/** Steam community GUIDES tab for a game by appid (community-authored, hosted by Steam). */
export function steamGuidesUrl(appId) {
  const id = Number(appId);
  return Number.isFinite(id) && id > 0 ? `https://steamcommunity.com/app/${id}/guides/` : null;
}
/** A web search link-out for a "<title> wiki" when we have no curated wiki on file. */
export function wikiSearchUrl(title) {
  const t = String(title || '').trim();
  return t ? `https://duckduckgo.com/?q=${encodeURIComponent(`${t} wiki guide`)}` : null;
}

/**
 * Build the guides/cheats link-out set for a game title (or slug). Resolves against the shared
 * game-communities registry so it reuses the curated wiki + Steam appid. Returns
 *   { title, name, links: [{ label, url, note }], note }
 * Always returns an object; an unknown title still yields useful SEARCH link-outs. Never throws.
 * @param {string} title  game title or slug
 */
export async function guidesFor(title) {
  const raw = typeof title === 'string' ? title.trim() : '';
  let game = null;
  try { game = await lookupGame(raw); } catch { game = null; }
  const name = game ? game.name : raw;
  const links = [];
  const add = (label, url, note) => { if (url) links.push({ label, url, note: note || '' }); };

  if (name) {
    // The game's OWN wiki first (curated where we have it, else a wiki search) — best clean source.
    if (game && game.wiki) add('Game wiki', game.wiki, 'community wiki — strategies, items, quests');
    else add('Find the wiki', wikiSearchUrl(name), 'search for the game\'s wiki');

    // Steam community guides (community-authored, Steam-hosted) when we know the appid.
    const sg = game ? steamGuidesUrl(game.steamAppId) : null;
    add('Steam community guides', sg, 'player-written guides on Steam');
    if (!sg && game) add('Steam community hub', steamHubUrl(game.steamAppId), 'screenshots, guides, discussions');

    // GameFAQs SEARCH (classic walkthroughs/cheats — copyrighted, so we link to search, never copy).
    add('GameFAQs (search)', gamefaqsSearchUrl(name), 'walkthroughs & cheat lists — link-out only');
  }

  return { title: raw, name, links, note: dataNote() };
}

// ---- rendering (escaped HTML) ----

/** Render guidesFor() output into escaped link cards. PURE. */
export function renderGuides(data = {}) {
  const name = esc(data.name || 'Game');
  const links = Array.isArray(data.links) ? data.links : [];
  const parts = [`<section class="game-guides"><h3>Cheats & guides — ${name}</h3>`];
  if (!links.length) {
    parts.push('<p class="gg-empty">No guide links available.</p>');
  } else {
    parts.push('<ul class="gg-list" style="list-style:none;padding:0">');
    for (const l of links) {
      parts.push(
        '<li style="padding:5px 0">'
        + `<a href="${esc(l.url)}" target="_blank" rel="noopener nofollow">${esc(l.label)}</a>`
        + (l.note ? ` <span class="muted" style="font-size:12px">— ${esc(l.note)}</span>` : '')
        + '</li>',
      );
    }
    parts.push('</ul>');
  }
  parts.push(`<p class="data-note">${esc(dataNote())}</p></section>`);
  return parts.join('');
}

/** Provenance / copyright-posture line. */
export function dataNote() {
  return 'we link out to licensed/community guide sources (the game\'s own wiki, Steam guides, GameFAQs) — we never copy guide text (copyright)';
}

// ---- CLI (guarded) ----
if (process.argv[1] && process.argv[1].endsWith('game-guides.mjs')) {
  const title = process.argv.slice(2).join(' ') || 'Stardew Valley';
  const res = await guidesFor(title);
  console.log(`SoapBox Game Guides — ${res.name}`);
  console.log('─'.repeat(50));
  res.links.forEach((l) => console.log(`  ${l.label.padEnd(24)} ${l.url}`));
  console.log(`  ${res.note}`);
}
