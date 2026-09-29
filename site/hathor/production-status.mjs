// production-status.mjs — read-only view of Hathor's production (documentary queue, worker heartbeat, pause state).
// The submitter (posting host) posts its queue snapshot with the production token; the worker loop posts a heartbeat
// with the worker token. /documentaries/status shows them — no controls on the public web (pausing is a flag file on
// the servers: deploy/PRODUCTION.md).

import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';

export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const DIR = () => process.env.PRODUCTION_STATUS_DIR || join(process.env.VSTUDIO_DIR || join(process.env.DATA_DIR || join(process.cwd(), '.data', 'hathor'), 'video-studio'), 'production');
const read = (name) => { try { return JSON.parse(readFileSync(join(DIR(), name), 'utf8')); } catch { return null; } };
function write(name, obj) {
  try { mkdirSync(DIR(), { recursive: true }); const p = join(DIR(), name); writeFileSync(`${p}.tmp`, JSON.stringify(obj)); renameSync(`${p}.tmp`, p); return true; } catch { return false; }
}

const num = (x) => (Number.isFinite(+x) ? +x : null);
/** Keep only the fields we render (the snapshot comes from our own submitter, but stay strict). */
export function saveSubmitterStatus(b) {
  if (!b || typeof b !== 'object') return false;
  const q = b.queue || {};
  return write('submitter.json', {
    updated: Date.now(), paused: !!b.paused, madeToday: num(b.madeToday), open: num(b.open),
    queue: { total: num(q.total), remaining: num(q.remaining), published: num(q.published), byLength: Object.fromEntries([10, 30, 60].map((m) => [m, num((q.byLength || {})[m])])) },
    next: (Array.isArray(b.next) ? b.next : []).slice(0, 12).map((e) => ({ docId: String(e.docId || '').slice(0, 70), name: String(e.name || '').slice(0, 120), minutes: num(e.minutes) })),
  });
}
export function saveWorkerHeartbeat(b) {
  if (!b || typeof b !== 'object') return false;
  return write('worker.json', { updated: Date.now(), paused: !!b.paused, load: num(b.load), jobsToday: num(b.jobsToday) });
}
export const loadStatus = () => ({ submitter: read('submitter.json'), worker: read('worker.json') });

const ago = (t) => { if (!t) return 'never'; const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'just now' : m < 90 ? `${m} min ago` : `${Math.round(m / 60)} h ago`; };
export function statusBody(st = loadStatus(), films = 0) {
  const s = st.submitter; const w = st.worker;
  const paused = (s && s.paused) || (w && w.paused);
  const bl = (s && s.queue && s.queue.byLength) || {};
  return `<h1>Production status</h1>
<p class=muted>Hathor's documentary production runs on our servers around the clock. This page is read-only.</p>
<div class=card><p><b>State:</b> ${paused ? '<b style="color:var(--gold)">Paused</b>' : 'Running'}${s && s.paused ? ' (planner paused)' : ''}${w && w.paused ? ' (renderer paused)' : ''}</p>
<p><b>Published documentaries:</b> ${films} · <b>made today:</b> ${esc(s && s.madeToday != null ? s.madeToday : '—')} · <b>in progress:</b> ${esc(s && s.open != null ? s.open : '—')}</p>
<p><b>Queue:</b> ${esc(s && s.queue ? s.queue.remaining : '—')} films waiting (${esc(bl[10] ?? '—')} × 10 min, ${esc(bl[30] ?? '—')} × 30 min, ${esc(bl[60] ?? '—')} × 60 min — 60-minute films start once a 30-minute film is out)</p>
<p class=muted style="font-size:12px">Planner last checked in ${ago(s && s.updated)} · renderer ${ago(w && w.updated)}${w && w.load != null ? ` · load ${esc(w.load)}` : ''}</p></div>
${s && s.next && s.next.length ? `<h2>Coming next</h2><ol>${s.next.map((e) => `<li>${esc(e.name)} <span class=muted>(${esc(e.minutes)} min)</span></li>`).join('')}</ol>` : ''}
<p><a href="/documentaries">← All documentaries</a></p>`;
}
