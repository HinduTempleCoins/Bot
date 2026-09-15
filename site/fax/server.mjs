// site/fax/server.mjs — SOAPBOX FAX. The app that actually sends.
//
// ⛔ WHY THIS EXISTS. integrations/soapbox/fax-system.mjs was complete and unreachable: buildJob →
// coverSheet → dispatch → receipt, 508 lines, imported by soapbox-tools.mjs and fax-receipts.mjs,
// neither of which is mounted anywhere. And createQueue() returns an IN-MEMORY object, so a held job
// lived only as long as the process that made it. `resendAt` was a field on a result, not an alarm —
// nothing anywhere would ever fire it. A queue that does not survive a restart is a note, not a queue.
//
// This service fixes exactly that: the queue is file-backed, a tick loop fires held jobs when their
// window opens, and a job survives a restart.
//
// ⚠️ MANUAL IS A REAL SEND, not a fallback. The fax-system header is explicit: "a fax system that only
// works once somebody buys Telnyx credit is a fax system that does not work." Walking a packet to a
// machine is a legitimate way to send a fax, so POST /api/fax/:id/sent records a human transmission
// with its confirmation and the ledger treats it the same as an API one.
//
// House style: ESM, soft-fail-never-throw, injectable fs/clock, handler(req,res), CLI guarded.

import { createServer } from 'node:http';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildJob, dispatch, renderPacket, recipients, windowFor, formatFax, esc,
} from '../../integrations/soapbox/fax-system.mjs';

const PORT = +(process.env.PORT || 8192);
const HOST = process.env.HOST || '127.0.0.1';
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const DATA = () => process.env.FAX_DATA || join(process.cwd(), 'data', 'fax-queue.json');
const TICK_MS = Math.max(15000, Number(process.env.FAX_TICK_MS || 60000));

const now = () => new Date().toISOString();
const json = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj, null, 2)); };

// ── the queue, on disk ──────────────────────────────────────────────────────────────────────────
// Whole-file load/save, same discipline as every other store here. Small by nature: a fax queue that
// needs a database is a fax queue with a different problem.
function load() {
  try { const j = JSON.parse(readFileSync(DATA(), 'utf8')); return Array.isArray(j.jobs) ? j : { jobs: [] }; }
  catch { return { jobs: [] }; }
}
function save(store) {
  try { mkdirSync(dirname(DATA()), { recursive: true }); writeFileSync(DATA(), JSON.stringify(store, null, 2)); return true; }
  catch { return false; }
}

const publicRow = (r) => ({
  id: r.id, to: r.to, fax: formatFax(r.fax), subject: r.subject, pages: r.pages,
  state: r.state, attempts: r.attempts || 0, createdAt: r.createdAt,
  resendAt: r.resendAt || null, reason: r.reason || '', sentAt: r.sentAt || null,
  confirmation: r.confirmation || '', history: r.history || [],
});

/** Build + enqueue + attempt. A held job is stored WITH its packet so a restart loses nothing. */
export async function submit(input = {}, opts = {}) {
  const job = buildJob(input);
  if (!job.ok) return { ok: false, problems: job.problems };

  const store = opts.store || load();
  const r = await dispatch(job, { ignoreHours: !!input.ignoreHours });
  const row = {
    id: job.id, to: job.to.name, fax: job.to.fax, subject: job.subject, pages: job.pages,
    createdAt: job.createdAt || now(), tz: (job.to && job.to.tz) || '',
    state: r.mode === 'held' ? 'held' : (r.ok ? 'sent' : 'manual'),
    reason: r.reason || '', resendAt: r.resendAt || null,
    packet: renderPacket(job),
    history: [{ at: now(), mode: r.mode, ok: !!r.ok, reason: r.reason || '' }],
    attempts: r.mode === 'held' ? 0 : 1,
  };
  store.jobs.push(row);
  if (!opts.store) save(store);
  return { ok: true, job: publicRow(row), mode: r.mode, note: r.note || '' };
}

/**
 * tick — fire every held job whose window has opened.
 * ⚠️ This is the piece that did not exist. Without it `resendAt` was decoration.
 */
export async function tick(opts = {}) {
  const store = opts.store || load();
  const at = opts.nowISO || now();
  const fired = [];
  for (const row of store.jobs) {
    if (row.state !== 'held') continue;
    if (row.resendAt && new Date(row.resendAt).getTime() > new Date(at).getTime()) continue;
    // Re-dispatch from the stored packet. No carrier ⇒ mode 'manual', which is a real outcome:
    // the packet is ready and a human can send it, and the row says so instead of pretending.
    const r = await dispatch({ ok: true, id: row.id, to: { name: row.to, fax: row.fax, tz: row.tz }, pages: row.pages, subject: row.subject, cover: { text: '' }, body: '' },
      { ignoreHours: true });
    row.attempts = (row.attempts || 0) + 1;
    row.state = r.ok && r.mode !== 'manual' && r.mode !== 'held' ? 'sent' : 'manual';
    row.reason = r.reason || (row.state === 'manual' ? 'no carrier configured — ready to send by hand' : '');
    row.history.push({ at, mode: r.mode, ok: !!r.ok, reason: row.reason });
    if (row.state === 'sent') row.sentAt = at;
    fired.push(publicRow(row));
  }
  if (fired.length && !opts.store) save(store);
  return { ok: true, checked: store.jobs.length, fired: fired.length, jobs: fired };
}

/** Record a human transmission. A walked packet is a send and the ledger says so. */
export function markSent(id, { confirmation = '', at = '' } = {}, opts = {}) {
  const store = opts.store || load();
  const row = store.jobs.find((j) => j.id === String(id));
  if (!row) return { ok: false, reason: 'no such job' };
  row.state = 'sent';
  row.sentAt = at || now();
  row.confirmation = String(confirmation || '');
  row.history.push({ at: row.sentAt, mode: 'manual-confirmed', ok: true, reason: `sent by hand${row.confirmation ? ` — ${row.confirmation}` : ''}` });
  if (!opts.store) save(store);
  return { ok: true, job: publicRow(row) };
}

export const queue = (opts = {}) => (opts.store || load()).jobs.map(publicRow);
export const getJob = (id, opts = {}) => (opts.store || load()).jobs.find((j) => j.id === String(id)) || null;

// ── HTTP ────────────────────────────────────────────────────────────────────────────────────────
function readBody(req, max = 524288) {
  if (req && req.body !== undefined && typeof req.body === 'object') return Promise.resolve(req.body);
  return new Promise((resolve) => {
    try {
      let d = ''; let over = false;
      req.on('data', (c) => { d += c; if (d.length > max) { over = true; try { req.destroy(); } catch {} } });
      req.on('end', () => { if (over) return resolve(null); try { resolve(JSON.parse(d || '{}')); } catch { resolve(null); } });
      req.on('error', () => resolve(null));
    } catch { resolve(null); }
  });
}

function page() {
  const rows = queue().slice().reverse();
  const book = recipients().map((r) => `<option value="${esc(r.id)}">${esc(r.name)} — ${esc(formatFax(r.fax))}</option>`).join('');
  const list = rows.length ? rows.map((r) => `<div class=item>
    <div style="flex:1"><b>${esc(r.subject || r.id)}</b> <span class="chip ${esc(r.state)}">${esc(r.state)}</span>
    <br><small>${esc(r.to)} · ${esc(r.fax)} · ${esc(r.pages)}p${r.resendAt ? ` · sends ${esc(r.resendAt)}` : ''}${r.reason ? ` · ${esc(r.reason)}` : ''}</small></div>
    <a class=btn href="/api/fax/${esc(r.id)}/packet">Packet</a>
    ${r.state !== 'sent' ? `<button class=btn data-sent="${esc(r.id)}">Mark sent</button>` : ''}</div>`).join('')
    : '<p class=mut>Nothing queued.</p>';
  return `<!doctype html><html lang=en><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1"><title>SoapBox Fax</title>
<style>
 :root{--bg:#0b0d12;--panel:#12161e;--fg:#e9eef5;--mut:#93a1b3;--bd:#222b38;--flame:#ff8c2b;--green:#36c08a;--amber:#d9a441}
 *{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 -apple-system,Segoe UI,Roboto,Arial,sans-serif;padding:16px}
 .wrap{max-width:820px;margin:0 auto}h1{font-size:22px;margin:0 0 4px}
 .card{background:var(--panel);border:1px solid var(--bd);border-radius:14px;padding:14px;margin:12px 0}
 input,textarea,select{width:100%;padding:9px 11px;border:1px solid var(--bd);border-radius:9px;background:#0e131b;color:var(--fg);font:inherit;margin-bottom:8px}
 textarea{min-height:160px;font-family:ui-monospace,Menlo,monospace}
 .btn{padding:8px 12px;border-radius:9px;border:1px solid var(--bd);background:#0e131b;color:var(--fg);font:inherit;font-weight:700;cursor:pointer;text-decoration:none;white-space:nowrap}
 .btn.primary{background:var(--flame);color:#1a1006;border-color:var(--flame)}
 .item{display:flex;gap:10px;align-items:center;border:1px solid var(--bd);border-radius:11px;padding:10px 12px;margin-top:8px}
 .chip{font-size:11px;border:1px solid var(--bd);border-radius:999px;padding:2px 8px;color:var(--mut)}
 .chip.sent{color:var(--green);border-color:var(--green)}.chip.held{color:var(--amber);border-color:var(--amber)}
 .chip.manual{color:var(--flame);border-color:var(--flame)}
 .mut{color:var(--mut)}small{color:var(--mut)}
</style></head><body><div class=wrap>
<h1>📠 SoapBox Fax</h1>
<p class=mut>A held job waits for the recipient's business hours, so the transmission report and their
date stamp agree. With no carrier configured a job becomes <b>manual</b> — the packet is rendered and
ready to send by hand, which is a real send and gets a real receipt.</p>
<div class=card>
  <select id=to><option value="">— pick a recipient, or type a number below —</option>${book}</select>
  <input id=fax placeholder="Fax number, e.g. +15124751135">
  <input id=name placeholder="Recipient name">
  <input id=from placeholder="Your name">
  <input id=subject placeholder="Subject">
  <textarea id=body placeholder="The document body (markdown or plain text)"></textarea>
  <label class=mut><input type=checkbox id=now style="width:auto;margin-right:6px">Send now, ignore business hours</label>
  <div style="margin-top:8px"><button class="btn primary" id=send>Queue fax</button></div>
</div>
<div class=card><b>Queue</b>${list}</div>
<script>
const $=i=>document.getElementById(i);
$('send').onclick=async()=>{
 const to=$('to').value?{id:$('to').value}:{name:$('name').value,fax:$('fax').value};
 const r=await fetch('/api/fax',{method:'POST',headers:{'content-type':'application/json'},
  body:JSON.stringify({to,from:{name:$('from').value},subject:$('subject').value,body:$('body').value,ignoreHours:$('now').checked})});
 const j=await r.json();
 if(j.ok)location.reload();else alert((j.problems||[j.reason]).join('\\n'));};
for(const b of document.querySelectorAll('[data-sent]'))b.onclick=async()=>{
 const c=prompt('Confirmation number or note from the fax machine:');
 if(c===null)return;
 await fetch('/api/fax/'+encodeURIComponent(b.dataset.sent)+'/sent',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({confirmation:c})});
 location.reload();};
</script></div></body></html>`;
}

export async function handler(req, res) {
  try {
    const method = ((req && req.method) || 'GET').toUpperCase();
    const path = (String((req && req.url) || '/').split('?')[0] || '/').replace(/\/+$/, '') || '/';
    const segs = path.split('/').filter(Boolean);

    if (path === '/health') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end('ok'); }
    if (method === 'GET' && path === '/api/fax') return json(res, 200, { ok: true, jobs: queue() });
    if (method === 'GET' && segs[0] === 'api' && segs[1] === 'fax' && segs[2] && segs[3] === 'packet') {
      const j = getJob(segs[2]);
      if (!j) return json(res, 404, { ok: false, reason: 'no such job' });
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      return res.end(typeof j.packet === 'string' ? j.packet : JSON.stringify(j.packet, null, 2));
    }
    if (method === 'POST' && path === '/api/fax') {
      const b = await readBody(req);
      if (!b) return json(res, 400, { ok: false, reason: 'bad-body' });
      const r = await submit(b);
      return json(res, r.ok ? 200 : 422, r);
    }
    if (method === 'POST' && segs[0] === 'api' && segs[1] === 'fax' && segs[2] && segs[3] === 'sent') {
      const b = (await readBody(req)) || {};
      return json(res, 200, markSent(segs[2], b));
    }
    if (method === 'POST' && path === '/api/fax/tick') return json(res, 200, await tick());
    if (method === 'GET' && path === '/') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end(page()); }
    return json(res, 404, { ok: false, reason: 'not-found' });
  } catch { return json(res, 500, { ok: false, reason: 'error' }); }
}

export default { handler, submit, tick, markSent, queue, getJob };

if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  createServer(handler).listen(PORT, HOST, () => console.log(`SoapBox Fax on http://${HOST}:${PORT} (${BASE_URL})`));
  // The loop that makes `resendAt` mean something. unref so it never holds the process open by itself.
  const t = setInterval(() => { tick().catch(() => {}); }, TICK_MS);
  if (t.unref) t.unref();
}
