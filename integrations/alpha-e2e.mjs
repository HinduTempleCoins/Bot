// alpha-e2e.mjs — automated end-to-end diagnostics for the WHOLE live testnet stack
// (operator 2026-06-06: "APIs testing everything so we can start getting it working without
// somebody having to do it by hand and tell us about it").
//
// One pass probes every public surface and the chain itself, then emits a single report:
//   chain    — RPC up, head block advancing, hathor witness confirming, feed freshness
//   faucet   — /faucet/health answering (creator + testnet flags)
//   accounts — signup + keycheck pages served, graphene-keys module served
//   condenser— alpha serving with the RIGHT chain config (TST prefix + chain id in the page)
//   pool     — frontend served, wizard/miner/picker modules served, WSS bridge accepting
//   sites    — witness school, data, hierophant, wiki, cheetah + commands reports
//   bots     — steemd command layer answers locally (the same call Discord/Telegram make)
//
// House style: injectable fetch (__setFetch), every check soft-fails into the report
// (never throws), CLI guarded. Exit code 1 when any REQUIRED check fails so a systemd
// OnFailure= hook (or the watchdog) can alert. Designed to run from the box on a timer:
//   node integrations/alpha-e2e.mjs            # human output
//   node integrations/alpha-e2e.mjs --json     # machine output (for the annal writers)

let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

const RPC = process.env.MELEK_RPC_URL || 'https://alpha.melek.salon/rpc';
const ALPHA = process.env.ALPHA_BASE || 'https://alpha.melek.salon';
const POOL = process.env.POOL_BASE || 'https://pool.soapbox.community';

async function get(url, { timeout = 10000 } = {}) {
  try {
    const r = await _fetch(url, { signal: AbortSignal.timeout(timeout), headers: { cookie: 'tnaccept=1' } });
    const text = await r.text();
    return { ok: r.ok, status: r.status, text };
  } catch (e) { return { ok: false, status: 0, text: '', err: e.message }; }
}

async function rpc(method, params = [], tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await _fetch(RPC, {
        method: 'POST', signal: AbortSignal.timeout(10000),
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      });
      const d = await r.json();
      if (d.result != null) return d.result;
    } catch { /* retry */ }
    if (i < tries - 1) await new Promise((res) => setTimeout(res, 1200));
  }
  return null;
}

const AGE_H = (iso) => (Date.now() - new Date(iso + (iso?.endsWith('Z') ? '' : 'Z')).getTime()) / 3.6e6;

// Each check: { name, required, run() -> { pass, detail } }
export function buildChecks() {
  return [
    {
      name: 'chain: RPC + head advancing', required: true,
      async run() {
        const a = await rpc('condenser_api.get_dynamic_global_properties');
        if (!a) return { pass: false, detail: 'RPC unreachable' };
        await new Promise((r) => setTimeout(r, 6500));
        const b = await rpc('condenser_api.get_dynamic_global_properties');
        const advanced = b && b.head_block_number > a.head_block_number;
        return { pass: !!advanced, detail: `head #${a.head_block_number} -> #${b?.head_block_number ?? '?'}` };
      },
    },
    {
      name: 'chain: hathor witness confirming', required: true,
      async run() {
        const [g, w] = await Promise.all([
          rpc('condenser_api.get_dynamic_global_properties'),
          rpc('condenser_api.get_witness_by_account', ['hathor']),
        ]);
        if (!g || !w) return { pass: false, detail: 'lookup failed' };
        const behind = g.head_block_number - (w.last_confirmed_block_num || 0);
        return { pass: behind < 100, detail: `${behind} blocks behind head, ${w.total_missed} missed` };
      },
    },
    {
      name: 'chain: price feed fresh (<2h)', required: false,
      async run() {
        const w = await rpc('condenser_api.get_witness_by_account', ['hathor']);
        if (!w?.last_sbd_exchange_update) return { pass: false, detail: 'no feed timestamp' };
        const h = AGE_H(w.last_sbd_exchange_update);
        return { pass: h < 2, detail: `last feed ${h.toFixed(1)}h ago` };
      },
    },
    {
      name: 'faucet: health', required: true,
      async run() {
        const r = await get(`${ALPHA}/faucet/health`);
        if (!r.ok) return { pass: false, detail: `HTTP ${r.status}` };
        try { const d = JSON.parse(r.text); return { pass: !!d.ok && !!d.testnet, detail: `creator=${d.creator}` }; }
        catch { return { pass: false, detail: 'bad JSON' }; }
      },
    },
    {
      name: 'accounts: signup + keycheck + keys module served', required: true,
      async run() {
        const [s, k, m] = await Promise.all([
          get(`${ALPHA}/account/signup.html`), get(`${ALPHA}/account/keycheck.html`), get(`${ALPHA}/account/graphene-keys.mjs`),
        ]);
        const pass = s.ok && k.ok && m.ok && m.text.includes('keysFromLogin');
        return { pass, detail: `signup=${s.status} keycheck=${k.status} module=${m.status}` };
      },
    },
    {
      name: 'condenser: serving with TST config', required: true,
      async run() {
        const r = await get(`${ALPHA}/hot`);
        const pass = r.ok && r.text.includes('"address_prefix":"TST"');
        return { pass, detail: `HTTP ${r.status}, prefix ${pass ? 'TST ok' : 'MISSING'}` };
      },
    },
    {
      name: 'condenser: signup redirect not the dead domain', required: false,
      async run() {
        const r = await get(`${ALPHA}/pick_account`);
        // after the fix this lands on the signup page (followed redirect); the dead host would error
        const pass = r.ok && /Create your|signup/i.test(r.text);
        return { pass, detail: r.ok ? 'lands on signup' : `HTTP ${r.status} ${r.err || ''}` };
      },
    },
    {
      // Audit 2026-06-06: /tos.html is correct in the condenser source but the live build is
      // stale and 404s, while the side panel + nav still link to it -> live dead link. This
      // check makes the stale deploy visible until the alpha-button-fixes branch is redeployed.
      name: 'condenser: TOS page served (not stale-deploy 404)', required: false,
      async run() {
        const r = await get(`${ALPHA}/tos.html`);
        return { pass: r.ok, detail: r.ok ? 'tos served' : `HTTP ${r.status} (stale deploy — redeploy condenser)` };
      },
    },
    {
      // Audit 2026-06-06: the side-panel FAQ link still points at blurtfaq.org (a wrong-chain
      // BLURT property). The fix (-> /faq.html) is on the condenser branch but not yet deployed.
      // Flag whenever the dead off-chain FAQ host still appears in the served feed HTML.
      name: 'condenser: no wrong-chain blurtfaq FAQ link', required: false,
      async run() {
        const r = await get(`${ALPHA}/hot`);
        if (!r.ok) return { pass: false, detail: `HTTP ${r.status}` };
        const stale = r.text.includes('blurtfaq.org');
        return { pass: !stale, detail: stale ? 'side-panel FAQ still -> blurtfaq.org (redeploy fixes)' : 'FAQ link internal' };
      },
    },
    {
      name: 'pool: frontend + miner modules served', required: true,
      async run() {
        const [i, w, m, p] = await Promise.all([
          get(`${POOL}/`), get(`${POOL}/wizard.mjs`), get(`${POOL}/miner-worker.mjs`), get(`${POOL}/wallet-picker.mjs`),
        ]);
        const pass = i.ok && w.ok && m.ok && p.ok && m.text.includes('initializing RandomX');
        return { pass, detail: `index=${i.status} wizard=${w.status} worker=${m.status} picker=${p.status}` };
      },
    },
    {
      name: 'pool: API answering', required: false,
      async run() {
        const r = await get(`${POOL}/api/pools`);
        return { pass: r.ok, detail: `HTTP ${r.status}` };
      },
    },
    {
      name: 'sites: witness school / data / hierophant / wiki', required: false,
      async run() {
        const urls = ['https://witness.melek.salon/', 'https://data.soapbox.community/', 'https://hierophant.soapbox.community/', 'https://wiki.soapbox.community/'];
        const rs = await Promise.all(urls.map((u) => get(u, { timeout: 15000 })));
        const bad = rs.map((r, i) => (!r.ok ? `${new URL(urls[i]).hostname}=${r.status}` : null)).filter(Boolean);
        return { pass: bad.length === 0, detail: bad.length ? bad.join(' ') : 'all 200' };
      },
    },
    {
      name: 'bots: steemd command layer answers (same call Discord/TG make)', required: false,
      async run() {
        try {
          const { runCommand } = await import('./soapbox/steemd.mjs');
          const r = await runCommand('hathor');
          return { pass: !!r.ok && r.text.includes('[TestNet not MELEK]'), detail: r.ok ? 'labeled reply ok' : r.text.slice(0, 60) };
        } catch (e) { return { pass: false, detail: e.message }; }
      },
    },
  ];
}

/** Run all checks; returns { at, pass, failures, results } — never throws. */
export async function runAll({ checks = buildChecks() } = {}) {
  const results = [];
  for (const c of checks) {
    let out;
    try { out = await c.run(); } catch (e) { out = { pass: false, detail: 'check threw: ' + e.message }; }
    results.push({ name: c.name, required: !!c.required, ...out });
  }
  const failures = results.filter((r) => !r.pass);
  const requiredFailures = failures.filter((r) => r.required);
  return { at: new Date().toISOString(), pass: requiredFailures.length === 0, failures, requiredFailures, results };
}

export function renderReport(rep) {
  const lines = [`alpha-e2e @ ${rep.at} — ${rep.pass ? 'PASS' : 'FAIL'}`];
  for (const r of rep.results) lines.push(`  ${r.pass ? '✓' : '✗'}${r.required ? '' : ' (opt)'} ${r.name} — ${r.detail}`);
  if (!rep.pass) lines.push(`REQUIRED FAILURES: ${rep.requiredFailures.map((r) => r.name).join(' | ')}`);
  return lines.join('\n');
}

if (process.argv[1] && process.argv[1].endsWith('alpha-e2e.mjs')) {
  const rep = await runAll();
  if (process.argv.includes('--json')) console.log(JSON.stringify(rep, null, 2));
  else console.log(renderReport(rep));
  process.exit(rep.pass ? 0 : 1);
}
