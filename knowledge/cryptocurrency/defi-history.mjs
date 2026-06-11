// knowledge/cryptocurrency/defi-history.mjs
//
// DeFi history knowledge module — ICO → IEO → DeFi timeline + major AMM platforms.
//
// Pure ESM data + query module. No network, no clock, no disk. Soft-fail:
// unknown era / unmatched term returns []. Facts sourced statically from
// MASTER_ITINERARY.md "DeFi History" (§ Knowledge Base Requirements) and the
// platform-comparison queue items (Uniswap / PancakeSwap / SunSwap; KulaSwap
// is the TRON PancakeSwap/SunSwap fork referenced in Phase 5 KULASWAP AMM).
//
// House style: ESM .mjs, esc() all HTML interpolation, CLI guarded by
// process.argv[1], soft-fail never throw.

/** HTML-escape any interpolated value. */
export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// Ordered timeline. era ∈ {ICO, IEO, DeFi, Platform}. Platform entries carry
// chain + ammModel for the major-AMM comparison.
export const DEFI_TIMELINE = Object.freeze([
  {
    year: 2013,
    era: 'ICO',
    event: 'Mastercoin ICO',
    note: 'First widely-cited Initial Coin Offering — token sale on top of Bitcoin, raising funds before a product existed.',
  },
  {
    year: 2014,
    era: 'ICO',
    event: 'Ethereum crowdsale',
    note: 'Ether pre-sold for BTC; the canonical ICO that funded a smart-contract platform and made later token ICOs trivial.',
  },
  {
    year: 2017,
    era: 'ICO',
    event: 'ICO boom',
    note: 'ERC-20 token sales explode. Capital raised directly from the crowd; minimal gatekeeping, high fraud rate — the model that IEOs reacted against.',
  },
  {
    year: 2019,
    era: 'IEO',
    event: 'Initial Exchange Offering era',
    note: 'Exchanges (Binance Launchpad and peers) host token sales and vet projects. Trust shifts from the crowd to the exchange as gatekeeper and custodian.',
  },
  {
    year: 2020,
    era: 'DeFi',
    event: 'DeFi Summer',
    note: 'Liquidity mining and yield farming move issuance and price discovery on-chain. AMMs replace order books; no central gatekeeper — the answer to both ICO fraud and IEO custody.',
  },
  {
    year: 2018,
    era: 'Platform',
    event: 'Uniswap launch',
    note: 'First major constant-product AMM on Ethereum. Permissionless pools; the reference design every later AMM forked.',
    platform: 'Uniswap',
    chain: 'Ethereum',
    ammModel: 'Constant-product (x*y=k)',
  },
  {
    year: 2020,
    era: 'Platform',
    event: 'PancakeSwap launch',
    note: 'Uniswap-style AMM on BNB Chain (BSC). Lower fees and faster blocks than Ethereum; CAKE rewards drove BSC DeFi adoption.',
    platform: 'PancakeSwap',
    chain: 'BNB Chain (BSC)',
    ammModel: 'Constant-product (x*y=k), Uniswap v2 fork',
  },
  {
    year: 2020,
    era: 'Platform',
    event: 'SunSwap launch',
    note: 'AMM on TRON (originally JustSwap). Constant-product model on a high-throughput, low-fee chain — the TRON analogue to Uniswap/PancakeSwap.',
    platform: 'SunSwap',
    chain: 'TRON',
    ammModel: 'Constant-product (x*y=k), Uniswap-style',
  },
]);

/** Distinct era names, in first-seen order. */
export function eras() {
  const seen = [];
  for (const row of DEFI_TIMELINE) {
    if (!seen.includes(row.era)) seen.push(row.era);
  }
  return seen;
}

/** All entries for a given era (case-insensitive). Unknown era -> []. */
export function byEra(name) {
  if (name == null) return [];
  const key = String(name).trim().toLowerCase();
  if (!key) return [];
  return DEFI_TIMELINE.filter((r) => r.era.toLowerCase() === key);
}

/**
 * Case-insensitive substring match over event / note / platform.
 * Empty or null term -> [].
 */
export function search(term) {
  if (term == null) return [];
  const q = String(term).trim().toLowerCase();
  if (!q) return [];
  return DEFI_TIMELINE.filter((r) => {
    const hay = `${r.event} ${r.note} ${r.platform || ''}`.toLowerCase();
    return hay.includes(q);
  });
}

/** The ordered timeline (defensive shallow copy). */
export function timeline() {
  return DEFI_TIMELINE.slice();
}

/**
 * Deterministic render of a list of rows (defaults to the full timeline).
 * { html:false } (default) -> plain text, one line per row.
 * { html:true }            -> an esc()'d HTML table.
 */
export function renderTimeline({ html = false, rows = DEFI_TIMELINE } = {}) {
  const list = Array.isArray(rows) ? rows : [];
  if (html) {
    const head =
      '<table class="defi-timeline">' +
      '<thead><tr><th>Year</th><th>Era</th><th>Event</th>' +
      '<th>Platform</th><th>Chain</th><th>AMM model</th><th>Note</th></tr></thead><tbody>';
    const body = list
      .map(
        (r) =>
          '<tr>' +
          `<td>${esc(r.year)}</td>` +
          `<td>${esc(r.era)}</td>` +
          `<td>${esc(r.event)}</td>` +
          `<td>${esc(r.platform || '')}</td>` +
          `<td>${esc(r.chain || '')}</td>` +
          `<td>${esc(r.ammModel || '')}</td>` +
          `<td>${esc(r.note)}</td>` +
          '</tr>',
      )
      .join('');
    return `${head}${body}</tbody></table>`;
  }
  return list
    .map((r) => {
      const plat = r.platform ? ` [${r.platform} on ${r.chain} — ${r.ammModel}]` : '';
      return `${r.year}  ${r.era.padEnd(8)}  ${r.event}${plat}\n    ${r.note}`;
    })
    .join('\n');
}

// CLI: `node defi-history.mjs [filter]`. Optional arg filters by era, else by
// search term; with no arg prints the full timeline.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const arg = process.argv[2];
  let rows = DEFI_TIMELINE;
  if (arg) {
    const byE = byEra(arg);
    rows = byE.length ? byE : search(arg);
  }
  if (!rows.length) {
    process.stdout.write(`No timeline entries match "${arg}".\n`);
    process.stdout.write(`Known eras: ${eras().join(', ')}\n`);
  } else {
    process.stdout.write(`${renderTimeline({ rows })}\n`);
  }
}
