// games-market.mjs — the Gamer Hub unifier. Brings together the two sides of a game's market into one
// honest comparison for collectors:
//   • NEW / DIGITAL  — live store prices from CheapShark (game-deals.mjs, fully keyless).
//   • COLLECTIBLE    — used / retro / CIB pricing via link-out builders (game-collectibles.mjs), plus
//                      live eBay listings ONLY when an EBAY_APP_ID is present (otherwise link-out only).
//
// HONEST-COMPARISON DISCIPLINE (documented, enforced in the shape):
//   - Every block carries its `source` and the digital deals carry a per-request `dataNote` provenance
//     line; the collectible block declares `posture:'aggregate'` (link out, never scrape).
//   - Ordering of digital deals is by PRICE ASCENDING — there is NO pay-to-rank, no sponsored slot, no
//     editorial reordering. The same sources are always disclosed in `provenance.sources`.
//   - We never blend a scraped used-price into the table; collector pricing always sends the user to the
//     authoritative source. New-vs-used are presented side by side, not merged into a single number.
//
// Pattern matches the sibling soapbox modules: ESM, zero deps, keyless-first, __setFetch hook (delegated
// to the children), graceful soft-fail (NEVER throw), guarded CLI, escaped rendered HTML, no secrets.
//
//   import { marketFor, renderMarket, dataNote, __setFetch } from './games-market.mjs'
//   node integrations/soapbox/games-market.mjs "Hollow Knight"
//   node integrations/soapbox/games-market.mjs "Chrono Trigger" SNES

import * as deals from './game-deals.mjs';
import * as collectibles from './game-collectibles.mjs';

// Re-export the fetch hook so a single __setFetch wires BOTH children for tests.
export function __setFetch(fn) {
  deals.__setFetch(fn);
  collectibles.__setFetch(fn);
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

/**
 * The unified market for a game title (and optional collectible platform).
 * Returns:
 *   {
 *     title, platform,
 *     newDigital: { deals:[…], best:{…}|null, source, dataNote },   // CheapShark
 *     collectible: { posture:'aggregate', phrase, links:[…], ebay:{…}|null, keyed:bool, source, dataNote },
 *     provenance: { sources:[…], payToRank:false, note }
 *   }
 * Always returns an object; each side soft-fails independently (empty deals / link-out only).
 * @param {string} title
 * @param {string} [platform]
 * @param {{digitalLimit?:number}} [opts]
 */
export async function marketFor(title, platform = '', { digitalLimit = 15 } = {}) {
  const t = typeof title === 'string' ? title.trim() : '';
  const p = typeof platform === 'string' ? platform.trim() : '';
  if (!t) {
    return {
      title: '', platform: p,
      newDigital: { deals: [], best: null, source: 'CheapShark', dataNote: deals.dataNote() },
      collectible: { posture: 'aggregate', phrase: '', links: [], ebay: null, keyed: collectibles.hasEbayKey(), source: 'PriceCharting + eBay', dataNote: collectibles.dataNote() },
      provenance: provenanceBlock(),
    };
  }

  // NEW / DIGITAL (CheapShark, keyless).
  const dealRows = await deals.dealsFor(t, { limit: digitalLimit });
  const best = dealRows.length ? { ...dealRows[0], comparedAcross: dealRows.length } : null;

  // COLLECTIBLE: link-outs always; live eBay only when keyed.
  const links = collectibles.collectorLinks(t, p);
  const ebay = await collectibles.ebayBrowse(t, p);

  return {
    title: t,
    platform: p,
    newDigital: {
      deals: dealRows,
      best,
      source: 'CheapShark',
      dataNote: deals.dataNote(),
    },
    collectible: {
      posture: links.posture || 'aggregate',
      phrase: links.phrase,
      links: links.links,
      ebay, // null when no EBAY_APP_ID — link-out only
      keyed: collectibles.hasEbayKey(),
      source: 'PriceCharting + eBay sold-listings',
      dataNote: collectibles.dataNote(),
    },
    provenance: provenanceBlock(),
  };
}

// The disclosed-sources / no-pay-to-rank provenance envelope. Same for every query (no editorial knob).
function provenanceBlock() {
  return {
    sources: ['CheapShark (digital store prices)', 'PriceCharting (used/retro)', 'eBay sold-listings (realized prices)'],
    payToRank: false,
    note: 'Digital deals ranked by price ascending — no sponsored placement. New and used are shown side by side, never merged; used prices link out to the source, never scraped.',
  };
}

// ── rendering ───────────────────────────────────────────────────────────────────────────────────────

/**
 * Escaped HTML for the whole Gamer Hub market page: a digital-deals table (game-deals renderer) + a
 * collector-links section (game-collectibles renderer) + the honest-comparison provenance note.
 * PURE; soft-handles missing fields. Delegates each block to its child renderer so escaping is uniform.
 * @param {object} market  from marketFor()
 */
export function renderMarket(market = {}) {
  const title = market.title || 'game';
  const label = market.platform ? `${title} (${market.platform})` : title;
  const parts = [`<section class="games-market"><h1>Game market — ${esc(label)}</h1>`];

  // Digital side.
  parts.push(deals.renderDeals(label, (market.newDigital && market.newDigital.deals) || []));

  // Collectible side.
  parts.push(collectibles.renderCollectibles({
    collector: market.collectible || {},
    ebay: market.collectible && market.collectible.ebay,
  }));

  // Honest-comparison provenance.
  const prov = market.provenance || provenanceBlock();
  parts.push('<aside class="games-market-provenance"><h3>How these prices are sourced</h3>');
  parts.push('<ul>');
  for (const s of prov.sources || []) parts.push(`<li>${esc(s)}</li>`);
  parts.push('</ul>');
  parts.push(`<p class="muted">${esc(prov.note || '')}</p>`);
  parts.push(`<p class="data-note">${esc(dataNote())}</p></aside></section>`);
  return parts.join('');
}

/** Combined provenance line for the unified page. */
export function dataNote() {
  return 'sources disclosed; no pay-to-rank — digital via CheapShark (live), used/retro via PriceCharting + eBay sold-listings (link-out)';
}

// ── CLI (guarded) ─────────────────────────────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('games-market.mjs')) {
  const argv = process.argv.slice(2);
  const title = argv[0] || 'Hollow Knight';
  const platform = argv[1] || '';
  const m = await marketFor(title, platform);
  console.log(`SoapBox Games Market — ${m.title}${m.platform ? ` (${m.platform})` : ''}`);
  console.log('─'.repeat(56));
  console.log('  NEW / DIGITAL (CheapShark):');
  if (m.newDigital.deals.length) {
    m.newDigital.deals.slice(0, 8).forEach((d) => console.log(`    ${d.store.padEnd(18)} $${d.price.toFixed(2)}${d.savings ? `  (-${d.savings}%)` : ''}`));
  } else { console.log('    no digital deals found'); }
  console.log('  COLLECTIBLE (used/retro):');
  console.log(`    eBay live: ${m.collectible.keyed ? (m.collectible.ebay ? `${m.collectible.ebay.items.length} listings` : 'keyed, none') : 'no key — link-out only'}`);
  for (const l of m.collectible.links) console.log(`    • ${l.label}\n        ${l.url}`);
  console.log(`  ${dataNote()}`);
}
