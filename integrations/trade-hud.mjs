// trade-hud.mjs — the TRADE ANALYTICS board for the soapy.blog admin HUD (task #205). ONE aggregation
// that pulls every trade-related module into a single decision view for the operator: realized P&L,
// categorized findings (bleed/win/arbitrage), markets we should enter, AI suggestions, the
// staking-vs-trading plan, and the angelicalist dry-run plan (sweep to @kalivankush).
//
// ───────────────────────────────────────────────────────────────────────────────────────────────
//  DISPLAY-ONLY · READ-ONLY · NO KEYS.  This HUD only DISPLAYS what the read-only modules already
//  computed, and shows the DRY-RUN plan. It NEVER executes a trade, never broadcasts, never holds a
//  WIF (zero-WIF rule). Every source is behind a defensive dynamic import in try/catch and SOFT-FAILS
//  per section: one source down does NOT take the board down — that section is just marked ok:false.
// ───────────────────────────────────────────────────────────────────────────────────────────────
//
//   import { tradeBoard, headline, renderBoard, decisionQueue } from './integrations/trade-hud.mjs';
//   const board = await tradeBoard();
//   console.log(headline(board));        // one plain-English sentence
//   res.end(renderBoard(board));         // escaped HTML for the admin HUD
//
// Tests inject fake sources via __setSources({...}) so the whole board assembles OFFLINE.
//
//   node integrations/trade-hud.mjs      # prints the headline + decision queue (live; soft-fails)

// ── HTML escape (matches site/soapbox/render.mjs) ───────────────────────────────────────────────
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const num = (n, d = 0) => (Number.isFinite(+n) ? +n : d);
const round = (n, p = 2) => +num(n).toFixed(p);

// ── injectable sources (so tests run with zero network) ─────────────────────────────────────────
// null → load the real module lazily, defensively, per call. A test passes an object whose keys are
// the source names; each value REPLACES that source's loader. Set __setSources(null) to reset.
let _sources = null;
export function __setSources(obj) { _sources = obj || null; return _sources; }

// Resolve one source: prefer an injected override, else dynamic-import the real module. ANY failure
// (missing module, throw, missing export) returns null and the caller soft-fails that section.
async function getSource(name, importer) {
  if (_sources && Object.prototype.hasOwnProperty.call(_sources, name)) {
    return _sources[name] ?? null;
  }
  try {
    return await importer();
  } catch {
    return null;
  }
}

// Run a per-section builder, catching ANY throw so one bad section can't break the board.
// Returns { ok, value } — value is the section payload (or the supplied empty default on failure).
async function section(fn, empty) {
  try {
    const value = await fn();
    if (value == null) return { ok: false, value: empty };
    return { ok: true, value };
  } catch {
    return { ok: false, value: empty };
  }
}

// ── the board ───────────────────────────────────────────────────────────────────────────────────

/**
 * Assemble the full trade-analytics board from every trade module (each soft-failing independently).
 * @param {object} [opts]
 * @param {string} [opts.account]  account whose analysis/holdings drive the findings (default kalivankush)
 * @returns {Promise<object>} the board (see fields below). Each section is null/[]/{} when unavailable,
 *   and `sections.{name}.ok` reports whether that source produced data.
 */
export async function tradeBoard({ account = 'kalivankush' } = {}) {
  const asOf = new Date().toISOString();

  // 1) profit — realized P&L summary from the executions ledger.
  const profit = await section(async () => {
    const m = await getSource('profit-tracker', () => import('./profit-tracker.mjs'));
    if (!m || typeof m.summary !== 'function') return null;
    const s = m.summary();
    if (!s) return null;
    return {
      trades: num(s.trades), markets: num(s.markets),
      volume: round(s.volume), fees: round(s.fees), netPnl: round(s.netPnl),
      best: s.best || null, worst: s.worst || null,
    };
  }, null);

  // 2) findings — categorized analyzer output (bleed/win/arbitrage) + the top-ranked few.
  const findings = await section(async () => {
    const m = await getSource('trade-analyzer', () => import('./trade-analyzer.mjs'));
    if (!m || typeof m.analyze !== 'function') return null;
    const res = await m.analyze(account);
    if (!res) return null;
    const structured = Array.isArray(res.findingsStructured) ? res.findingsStructured : [];
    const groups = res.findingGroups || { byCategory: {}, summary: { bleed: 0, win: 0, net: 0 } };
    const byCategory = {};
    for (const [cat, arr] of Object.entries(groups.byCategory || {})) byCategory[cat] = arr.length;
    return {
      byCategory,
      summary: groups.summary || { bleed: 0, win: 0, net: 0 },
      top: structured.slice(0, 5).map((f) => ({
        text: typeof f === 'string' ? f : (f.text || ''),
        categories: Array.isArray(f.categories) ? f.categories : [],
        net: Number.isFinite(f && f.net) ? round(f.net) : null,
      })),
      warnings: structured
        .filter((f) => Array.isArray(f.categories) && f.categories.includes('bleed'))
        .slice(0, 5)
        .map((f) => (typeof f === 'string' ? f : (f.text || ''))),
    };
  }, null);

  // 3) entries — fused "markets we should enter" candidate list.
  const entries = await section(async () => {
    const m = await getSource('market-entry', () => import('./market-entry.mjs'));
    if (!m || typeof m.recommendEntries !== 'function') return null;
    const list = await m.recommendEntries({ max: 8 });
    return (Array.isArray(list) ? list : []).map((e) => ({
      market: e.market, venue: e.venue, kind: e.kind,
      edgePct: round(num(e.edgePct) * 100, 1),
      confidence: e.confidence, usJurisdictionOK: !!e.usJurisdictionOK,
      reason: e.reason, action: e.action,
    }));
  }, []);

  // 4) suggestions — AI-ranked, reasoned advisory ideas (deterministic scoring; LLM prose optional).
  const suggestions = await section(async () => {
    const m = await getSource('ai-trade-suggest', () => import('./ai-trade-suggest.mjs'));
    if (!m || typeof m.suggest !== 'function') return null;
    // Feed the suggester the same entry candidates we already surfaced (advisory; no network here).
    const ents = entries.ok ? entries.value : [];
    const list = await m.suggest({ entries: ents });
    return (Array.isArray(list) ? list : []).slice(0, 8).map((s) => ({
      market: s.market, action: s.action, sizeHint: s.sizeHint,
      risk: s.risk, confidence: s.confidence, rationale: s.rationale,
    }));
  }, []);

  // 5) staking — staking-vs-trading portfolio plan (PURE; needs injected market data to say much).
  const staking = await section(async () => {
    const m = await getSource('staking-decision', () => import('./staking-decision.mjs'));
    if (!m || typeof m.portfolioPlan !== 'function') return null;
    // No live market feed here (read-only HUD); surface the plan only when a source provides holdings.
    const holdings = (_sources && _sources.holdings) || [];
    const marketData = (_sources && _sources.marketData) || {};
    const plan = m.portfolioPlan(holdings, marketData);
    return {
      rows: (Array.isArray(plan) ? plan : []).slice(0, 12).map((r) => ({
        symbol: r.symbol, action: r.action, reason: r.reason,
      })),
    };
  }, null);

  // 6) dryRunPlan — the angelicalist end-to-end DRY-RUN plan (incl. sweep to @kalivankush). The HUD
  // only DISPLAYS this plan; it is paper-only by construction and performs no broadcasts.
  const dryRunPlan = await section(async () => {
    const m = await getSource('dry-run', () => import('./angelicalist/dry-run.mjs'));
    if (!m || typeof m.dryRunCycle !== 'function') return null;
    const fixture = (_sources && _sources.dryRunInput) || { market: null, signals: [] };
    const opts = (_sources && _sources.dryRunOpts) || {};
    const result = await m.dryRunCycle(fixture, opts);
    if (!result) return null;
    return {
      dryRun: result.dryRun === true,
      orders: (Array.isArray(result.orders) ? result.orders : []).length,
      blocked: (Array.isArray(result.blocked) ? result.blocked : []).map((b) => ({ sym: b.sym, blocked: b.blocked })),
      sweep: result.sweep ? { to: result.sweep.to, asset: result.sweep.asset, amount: round(result.sweep.amount, 8), skim: !!result.sweep.skim, reason: result.sweep.reason } : null,
      summary: typeof m.summary === 'function' ? m.summary(result) : null,
    };
  }, null);

  return {
    asOf,
    account,
    profit: profit.value,
    findings: findings.value,
    entries: entries.value,
    suggestions: suggestions.value,
    staking: staking.value,
    dryRunPlan: dryRunPlan.value,
    sections: {
      profit: { ok: profit.ok },
      findings: { ok: findings.ok },
      entries: { ok: entries.ok },
      suggestions: { ok: suggestions.ok },
      staking: { ok: staking.ok },
      dryRunPlan: { ok: dryRunPlan.ok },
    },
  };
}

// ── headline: one plain-English sentence for the operator (no file paths, no jargon) ─────────────

/**
 * One plain-English sentence summarizing the board, e.g.
 *   "Up 12.5 HIVE overall; 2 bleed warnings; 3 markets look enterable."
 * Falls back gracefully when sections are unavailable.
 */
export function headline(board) {
  if (!board) return 'Trade board unavailable right now.';
  const parts = [];

  const p = board.profit;
  if (p && board.sections?.profit?.ok) {
    const net = num(p.netPnl);
    if (net > 0) parts.push(`Up ${round(net)} HIVE overall`);
    else if (net < 0) parts.push(`Down ${round(Math.abs(net))} HIVE overall`);
    else parts.push('Flat on realized profit so far');
  }

  const f = board.findings;
  if (f && board.sections?.findings?.ok) {
    const warns = (f.warnings || []).length;
    if (warns) parts.push(`${warns} bleed warning${warns === 1 ? '' : 's'}`);
  }

  const e = board.entries;
  if (board.sections?.entries?.ok && Array.isArray(e) && e.length) {
    parts.push(`${e.length} market${e.length === 1 ? '' : 's'} look${e.length === 1 ? 's' : ''} enterable`);
  }

  if (!parts.length) return 'No trade data available yet — every source is offline or empty.';
  return parts.join('; ') + '.';
}

// ── decisionQueue: the operator-decision action items, in plain English ──────────────────────────

/**
 * Extract the items that need an operator DECISION (plain-English action items, no jargon).
 * @returns {string[]}
 */
export function decisionQueue(board) {
  const items = [];
  if (!board) return items;

  // A pending dry-run sweep means: approve the first real trade / let the sweep go live.
  const d = board.dryRunPlan;
  if (board.sections?.dryRunPlan?.ok && d) {
    if (d.sweep && d.sweep.skim) {
      items.push(`Approve the first real trade: the dry-run would sweep ${d.sweep.amount} ${d.sweep.asset} to @${d.sweep.to}.`);
    } else if (d.orders > 0) {
      items.push(`Review the dry-run plan (${d.orders} order${d.orders === 1 ? '' : 's'} staged) and approve going live when ready.`);
    }
  }

  // The angelicalist account is a breached account — its key disposition is a standing operator call.
  if (board.account === 'angelicalist' || (board.dryRunPlan && board.sections?.dryRunPlan?.ok)) {
    items.push('Decide on the angelicalist account: rotate or abandon its keys (it is the breached trading account).');
  }

  // Bleed warnings → an operator should decide whether to stop the losing strategy.
  const f = board.findings;
  if (board.sections?.findings?.ok && f && (f.warnings || []).length) {
    items.push(`Stop or review ${f.warnings.length} losing position(s) flagged as bleed.`);
  }

  // Top enterable markets are leads a human must verify before risking capital.
  const e = board.entries;
  if (board.sections?.entries?.ok && Array.isArray(e) && e.length) {
    const top = e[0];
    items.push(`Verify and approve the top entry candidate before risking capital: ${top.market} (${top.edgePct}% edge).`);
  }

  return items;
}

// ── renderBoard: escaped HTML for the admin HUD ──────────────────────────────────────────────────

function card(title, ok, inner) {
  const flag = ok ? '' : ` <span class="th-down">(source offline)</span>`;
  return `<section class="th-card"><h3>${esc(title)}${flag}</h3>${inner}</section>`;
}

/**
 * Render the board as escaped HTML: plain-English headline first, then one card per section
 * (profit summary, warnings in red, entry candidates, suggestions, staking plan, and the DRY-RUN
 * plan clearly labeled). Always includes a visible display-only line. Everything is HTML-escaped.
 */
export function renderBoard(board) {
  if (!board) return `<div class="trade-hud"><p>Trade board unavailable.</p></div>`;

  const head = `<p class="th-headline">${esc(headline(board))}</p>`;
  const note = `<p class="th-readonly"><strong>Display-only — nothing here executes trades.</strong> This board only shows what the read-only analysis modules computed; it holds no keys and broadcasts nothing.</p>`;

  // profit
  let profitHtml;
  const p = board.profit;
  if (p) {
    const cls = num(p.netPnl) < 0 ? 'th-down' : 'th-up';
    profitHtml = `<p class="${cls}">Net realized P&amp;L: ${esc(round(p.netPnl))} HIVE</p>`
      + `<p>${esc(p.trades)} trades across ${esc(p.markets)} markets · volume ${esc(p.volume)} HIVE · fees ${esc(p.fees)} HIVE</p>`
      + (p.best ? `<p>Best: ${esc(p.best.market)} (${esc(round(p.best.realized))})</p>` : '')
      + (p.worst ? `<p>Worst: ${esc(p.worst.market)} (${esc(round(p.worst.realized))})</p>` : '');
  } else {
    profitHtml = `<p>No profit data.</p>`;
  }

  // warnings (red) + findings summary
  let findingsHtml;
  const f = board.findings;
  if (f) {
    const warns = (f.warnings || []);
    const warnHtml = warns.length
      ? `<ul class="th-warnings">${warns.map((w) => `<li class="th-down">${esc(w)}</li>`).join('')}</ul>`
      : `<p>No bleed warnings.</p>`;
    const cats = Object.entries(f.byCategory || {});
    const catHtml = cats.length ? `<p>Categories: ${cats.map(([c, n]) => `${esc(c)} ${esc(n)}`).join(' · ')}</p>` : '';
    findingsHtml = `${warnHtml}${catHtml}`;
  } else {
    findingsHtml = `<p>No analyzer findings.</p>`;
  }

  // entries
  let entriesHtml;
  const e = board.entries;
  if (Array.isArray(e) && e.length) {
    entriesHtml = `<ul class="th-entries">${e.map((x) =>
      `<li><strong>${esc(x.market)}</strong> — ${esc(x.edgePct)}% edge, ${esc(x.kind)} (${esc(x.confidence)}${x.usJurisdictionOK ? ', US-OK' : ''})<br><span class="th-reason">${esc(x.reason)}</span></li>`,
    ).join('')}</ul>`;
  } else {
    entriesHtml = `<p>No entry candidates clear the threshold right now.</p>`;
  }

  // suggestions
  let sugHtml;
  const sug = board.suggestions;
  if (Array.isArray(sug) && sug.length) {
    sugHtml = `<ul class="th-suggestions">${sug.map((s) =>
      `<li>[${esc(s.action)}] <strong>${esc(s.market)}</strong> — risk ${esc(s.risk)}, size ${esc(s.sizeHint)}<br><span class="th-reason">${esc(s.rationale)}</span></li>`,
    ).join('')}</ul>`;
  } else {
    sugHtml = `<p>No advisory suggestions.</p>`;
  }

  // staking
  let stakeHtml;
  const st = board.staking;
  if (st && Array.isArray(st.rows) && st.rows.length) {
    stakeHtml = `<ul class="th-staking">${st.rows.map((r) =>
      `<li>[${esc(r.action)}] <strong>${esc(r.symbol)}</strong> — ${esc(r.reason)}</li>`,
    ).join('')}</ul>`;
  } else {
    stakeHtml = `<p>No staking plan (no portfolio/market data provided).</p>`;
  }

  // dry-run plan — clearly labeled DRY-RUN
  let dryHtml;
  const d = board.dryRunPlan;
  if (d) {
    const sweep = d.sweep
      ? (d.sweep.skim
        ? `<p>Would sweep <strong>${esc(d.sweep.amount)} ${esc(d.sweep.asset)}</strong> to @${esc(d.sweep.to)} — ${esc(d.sweep.reason)}</p>`
        : `<p>No sweep — ${esc(d.sweep.reason)}</p>`)
      : '';
    const blocked = (d.blocked || []).length
      ? `<ul class="th-blocked">${d.blocked.map((b) => `<li>${esc(b.sym)}: ${esc(b.blocked)}</li>`).join('')}</ul>`
      : '';
    dryHtml = `<p class="th-dryrun"><strong>DRY-RUN — paper only, no broadcasts.</strong></p>`
      + `<p>${esc(d.orders)} order(s) staged.</p>${sweep}${blocked}`;
  } else {
    dryHtml = `<p>No dry-run plan available.</p>`;
  }

  const S = board.sections || {};
  return `<div class="trade-hud">`
    + `<h2>Trade Analytics</h2>`
    + head
    + note
    + card('Profit', S.profit?.ok, profitHtml)
    + card('Warnings &amp; Findings', S.findings?.ok, findingsHtml)
    + card('Markets to Enter', S.entries?.ok, entriesHtml)
    + card('AI Suggestions (advisory)', S.suggestions?.ok, sugHtml)
    + card('Staking vs Trading', S.staking?.ok, stakeHtml)
    + card('Dry-Run Plan', S.dryRunPlan?.ok, dryHtml)
    + `</div>`;
}

// ── CLI (guarded) ────────────────────────────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('trade-hud.mjs')) {
  const account = process.argv[2] || 'kalivankush';
  const board = await tradeBoard({ account });
  console.log('TRADE ANALYTICS HUD — display-only, read-only, no keys\n' + '─'.repeat(60));
  console.log(headline(board));
  console.log('\nSection status:');
  for (const [name, s] of Object.entries(board.sections)) console.log(`  ${name.padEnd(12)} ${s.ok ? 'ok' : 'offline'}`);
  const q = decisionQueue(board);
  if (q.length) { console.log('\nDecisions for the operator:'); q.forEach((x, i) => console.log(`  ${i + 1}. ${x}`)); }
  console.log('\nNothing here executes a trade — this board only displays the read-only analysis.');
}
