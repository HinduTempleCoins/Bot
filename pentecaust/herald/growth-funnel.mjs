// pentecaust/herald/growth-funnel.mjs — the ONE number that answers "are we getting users?".
//
// Herald's mission is user acquisition for our own sites. This module turns the raw signals the ecosystem
// already produces into a single, honest funnel — Reach → Leads → Subscribers → Signups — with per-campaign
// reach and step-to-step conversion. It reads real sources only; it fabricates nothing and never throws.
//
//   Reach       — clicks on our /go rail (qr-tracker.scanStats) — one click = one visitor sent to a funnel.
//   Leads       — top-of-funnel contacts captured (lead-crm) — an internal pipeline record, not a subscriber.
//   Subscribers — real double-opted-in email subscribers (campaign-sender.stats).
//   Signups     — accounts that actually registered through the invite viral tree (signup/invites.inviteStats).
//   Invites out — unredeemed invites in existing users' hands: the viral growth still in flight.
//
// House style: pure core (computeFunnel) + a thin collector (collectFunnel) that binds live sources + an
// HTTP handler factory + a dashboard renderer. Injectable everywhere, offline, soft-fail-never-throw.

export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const n0 = (v) => { const x = Number(v); return Number.isFinite(x) && x > 0 ? x : 0; };
// percentage of n out of d, one decimal; null when the denominator is 0 (no false 0% / division).
const pct = (n, d) => (d > 0 ? Math.round((n / d) * 1000) / 10 : null);

/**
 * computeFunnel(input) — pure. Shapes the funnel from already-derived numbers. Never throws.
 *   { reachByCampaign?:{[code]:total}, leads?, verifiedLeads?, subscribers?, signups?,
 *     invitesOutstanding?, invitesRedeemed?, signupsSource?, now? }
 */
export function computeFunnel(input = {}) {
  const reachByCampaign = (input.reachByCampaign && typeof input.reachByCampaign === 'object') ? input.reachByCampaign : {};
  const perCampaign = {};
  let reach = 0;
  for (const [code, v] of Object.entries(reachByCampaign)) {
    const t = n0(v && typeof v === 'object' ? v.total : v);   // accept scanStats shape {total} or a bare number
    perCampaign[code] = t;
    reach += t;
  }
  const leads = n0(input.leads);
  const verifiedLeads = n0(input.verifiedLeads);
  const subscribers = n0(input.subscribers);
  const signups = n0(input.signups);
  const invitesOutstanding = n0(input.invitesOutstanding);
  const invitesRedeemed = n0(input.invitesRedeemed);

  const stages = [
    { key: 'reach', label: 'Reach — clicks to our sites', value: reach, ofPrev: null },
    { key: 'leads', label: 'Leads captured', value: leads, ofPrev: pct(leads, reach) },
    { key: 'subscribers', label: 'Opt-in subscribers', value: subscribers, ofPrev: pct(subscribers, leads) },
    { key: 'signups', label: 'MELEK signups (viral tree)', value: signups, ofPrev: pct(signups, subscribers) },
  ];

  return {
    ok: true,
    stages,
    reach, reachByCampaign: perCampaign,
    leads, verifiedLeads, subscribers, signups,
    invitesOutstanding, invitesRedeemed,
    conversion: { leadsPerReach: pct(leads, reach), signupsPerReach: pct(signups, reach) },
    signupsSource: input.signupsSource || 'invite-tree',
    generatedAt: input.now != null ? input.now : null,
  };
}

/**
 * collectFunnel(deps) — binds live sources into computeFunnel. Every dep is optional and soft-failed, so a
 * missing/dead source degrades to 0 for that stage rather than erroring the whole funnel.
 *   deps: { scanStats:()=>({[code]:{total}}), leadPipeline:()=>({stage:count}), verifiedLeads:()=>n,
 *           senderStats:()=>({subscribers}), inviteStats:()=>({registeredAccounts, invitesOutstanding, invitesRedeemed}),
 *           campaignCodes?:[code], now? }
 * campaignCodes, when given, restricts Reach to OUR growth campaigns (ignores unrelated /go codes).
 */
export function collectFunnel(deps = {}) {
  const safe = (fn, d) => { try { const v = typeof fn === 'function' ? fn() : undefined; return v == null ? d : v; } catch { return d; } };

  const allScans = safe(deps.scanStats, {});
  const codes = Array.isArray(deps.campaignCodes) && deps.campaignCodes.length ? deps.campaignCodes : null;
  const reachByCampaign = {};
  for (const [code, st] of Object.entries(allScans || {})) {
    if (codes && !codes.includes(code)) continue;
    reachByCampaign[code] = st && typeof st === 'object' ? n0(st.total) : n0(st);
  }
  // if we scoped to our campaigns, make sure each is present (0 if it has no clicks yet)
  if (codes) for (const c of codes) if (reachByCampaign[c] == null) reachByCampaign[c] = 0;

  const pipeline = safe(deps.leadPipeline, {});
  const leads = Object.values(pipeline || {}).reduce((a, v) => a + n0(v), 0);
  const verifiedLeads = n0(safe(deps.verifiedLeads, 0));
  const sStats = safe(deps.senderStats, {});
  const subscribers = n0(sStats && sStats.subscribers);
  const inv = safe(deps.inviteStats, {});

  return computeFunnel({
    reachByCampaign,
    leads, verifiedLeads, subscribers,
    signups: n0(inv && inv.registeredAccounts),
    invitesOutstanding: n0(inv && inv.invitesOutstanding),
    invitesRedeemed: n0(inv && inv.invitesRedeemed),
    now: typeof deps.now === 'function' ? deps.now() : (deps.now != null ? deps.now : Date.now()),
  });
}

/** funnelHandler(deps) — GET /api/funnel → the funnel as JSON. Read-only; holds no key. */
export function funnelHandler(deps = {}) {
  return async function handler(req, res) {
    try {
      const funnel = collectFunnel(deps);
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(JSON.stringify(funnel));
    } catch {
      try { res.writeHead(500, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: false })); } catch { /* soft */ }
      return undefined;
    }
  };
}

/** renderFunnelHtml(funnel) — the dashboard section (escaped). Renders the stages as a live funnel bar. */
export function renderFunnelHtml(funnel) {
  const f = funnel && funnel.ok ? funnel : computeFunnel({});
  const max = Math.max(1, ...f.stages.map((s) => s.value));
  const rows = f.stages.map((s) => {
    const w = Math.max(2, Math.round((s.value / max) * 100));
    const conv = s.ofPrev != null ? `<span class="fn-conv">${esc(s.ofPrev)}% of prev</span>` : '';
    return `<div class="fn-row"><div class="fn-lab">${esc(s.label)}</div>`
      + `<div class="fn-bar"><span style="width:${w}%"></span></div>`
      + `<div class="fn-val">${esc(s.value)} ${conv}</div></div>`;
  }).join('');
  const perCamp = Object.entries(f.reachByCampaign || {})
    .sort((a, b) => b[1] - a[1])
    .map(([c, t]) => `<span class="fn-chip">/go/${esc(c)} · ${esc(t)}</span>`).join(' ');
  return `<div class="funnel"><style>
    .funnel .fn-row{display:grid;grid-template-columns:180px 1fr 120px;gap:10px;align-items:center;margin:6px 0}
    .funnel .fn-lab{font-size:13px;color:var(--mut,#8896a6)} .funnel .fn-bar{background:#0a0c10;border:1px solid var(--line,#232c3a);border-radius:6px;height:16px;overflow:hidden}
    .funnel .fn-bar span{display:block;height:100%;background:linear-gradient(90deg,#1d9bf0,#3fb950)} .funnel .fn-val{font-weight:700;font-size:14px}
    .funnel .fn-conv{font-weight:400;font-size:11px;color:var(--mut,#8896a6)} .funnel .fn-chips{margin-top:8px} .funnel .fn-chip{display:inline-block;font-size:11px;color:#cfe3ff;background:#0a0c10;border:1px solid var(--line,#232c3a);border-radius:20px;padding:2px 9px;margin:2px 4px 2px 0;font-family:ui-monospace,monospace}
    .funnel .fn-foot{font-size:12px;color:var(--mut,#8896a6);margin-top:8px}
   </style>${rows}
   <div class="fn-chips">${perCamp || '<span class="fn-chip">no clicks logged yet</span>'}</div>
   <div class="fn-foot">Invites still in existing users' hands (viral growth in flight): <b>${esc(f.invitesOutstanding)}</b>
     · signups per 100 clicks: <b>${f.conversion.signupsPerReach == null ? '—' : esc(f.conversion.signupsPerReach)}${f.conversion.signupsPerReach == null ? '' : '%'}</b>
     · signups source: ${esc(f.signupsSource)}</div></div>`;
}

// ── CLI (guarded) — print the funnel from live disk data if present, else an empty shape ─────────────────
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const out = collectFunnel({});   // no deps bound → an honest empty funnel
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(out, null, 2));
}
