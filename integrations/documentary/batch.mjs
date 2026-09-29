#!/usr/bin/env node
// batch.mjs — produce wordless documentaries back to back and publish each as soon as it exists.
//
//   DOC_LLM_HOST=… DOC_WORKER_HOST=… DOC_WEB_HOST=… node integrations/documentary/batch.mjs --topics kush-nile,tomb-life --minutes 10
//   … --queue queue.json            # [{ "topic": "minoans", "minutes": 10 }, …]
//
// Per film: pull /documentaries/feedback.json → choose the style by Thompson sampling over the votes of films made in
// each style → shot plan on the LLM host (keys stay there) → board here (reuse-only by default; parts index from the
// worker) → render on the worker (nice 15) → publish to the web host's DOCS_DIR (piped through this machine, because
// the worker cannot reach the web host) → rebuild the manifest. Each film's log line: topic, style, minutes, shots,
// missing parts, render seconds. Hosts are SSH aliases from env — none are committed.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { TOPICS } from './topics.mjs';
import { STYLES } from './plan.mjs';
import { buildBoard } from './run.mjs';

const env = (k, d) => process.env[k] || d;
const LLM = env('DOC_LLM_HOST'); const WORKER = env('DOC_WORKER_HOST'); const WEB = env('DOC_WEB_HOST');
const LLM_DIR = env('DOC_LLM_DIR', '/tmp/docmaker'); const LLM_ENV = env('DOC_LLM_ENVFILE'); // the key file on the LLM host (private; set in the runner)
const W_DIR = env('DOC_WORKER_DIR', '/opt/melek-gen/documentary'); const W_OUT = env('DOC_WORKER_OUT', '/opt/melek-gen/docs_out');
const W_PY = env('DOC_WORKER_PY', '/opt/melek-gen/face-venv/bin/python'); const WEB_DIR = env('DOC_WEB_DIR', '/var/lib/hathor-docs');
const PUBLIC = env('DOC_PUBLIC_URL', 'https://hathor.soapbox.community');
const LOCAL = env('DOC_LOCAL_DIR', path.join(process.cwd(), '.local', 'documentary', 'batch'));
const RENDER_CAP = { 10: 25, 30: 60, 60: 100 };

const sh = (host, cmd, opts = {}) => execFileSync('ssh', ['-o', 'BatchMode=yes', host, cmd], { encoding: 'utf8', maxBuffer: 64 << 20, timeout: opts.timeout || 3 * 3600e3 });
const scpTo = (file, host, dest) => execFileSync('scp', ['-q', '-o', 'BatchMode=yes', file, `${host}:${dest}`]);
const scpFrom = (host, src, file) => execFileSync('scp', ['-q', '-o', 'BatchMode=yes', `${host}:${src}`, file]);

/** Thompson sampling over styles: Beta(1+up, 1+down) summed over films made in that style. */
export function chooseStyle(feedback, rng = Math.random) {
  const stats = Object.fromEntries(Object.keys(STYLES).map((s) => [s, { up: 0, down: 0 }]));
  for (const f of Object.values((feedback && feedback.films) || {})) if (stats[f.style]) { stats[f.style].up += f.up || 0; stats[f.style].down += f.down || 0; }
  const beta = (a, b) => { const g = (k) => { let x = 0; for (let i = 0; i < k; i++) x -= Math.log(rng()); return x; }; const x = g(a); return x / (x + g(b)); };
  let best = 'wonder'; let bv = -1;
  for (const [s, v] of Object.entries(stats)) { const d = beta(1 + Math.min(50, v.up), 1 + Math.min(50, v.down)); if (d > bv) { bv = d; best = s; } }
  return best;
}

async function feedback() {
  try { const r = await fetch(`${PUBLIC}/documentaries/feedback.json`); return r.ok ? r.json() : {}; } catch { return {}; }
}

function publish(id) {
  // worker → this machine → web host (tar pipe), then rebuild the manifest on the web host
  execFileSync('bash', ['-c', `set -o pipefail; ssh -o BatchMode=yes ${WORKER} 'tar -C ${W_OUT} -cf - ${id}' | ssh -o BatchMode=yes ${WEB} 'mkdir -p ${WEB_DIR} && tar -C ${WEB_DIR} -xf - && chown -R 1000:1000 ${WEB_DIR}/${id}'`], { stdio: 'inherit', timeout: 3600e3 });
  sh(WEB, `cd ${WEB_DIR} && node -e 'const fs=require("fs");const films=[];for(const d of fs.readdirSync(".")){try{const f=JSON.parse(fs.readFileSync(d+"/film.json","utf8"));const {recipe,...rest}=f;films.push(rest)}catch{}}films.sort((a,b)=>(b.made||0)-(a.made||0));fs.writeFileSync("manifest.json",JSON.stringify({updated:Date.now(),films}))' && chown 1000:1000 manifest.json`);
}

export async function makeFilm({ topic, minutes = 10, style, reuseOnly = true }) {
  if (!TOPICS[topic]) throw new Error(`unknown topic ${topic}`);
  fs.mkdirSync(LOCAL, { recursive: true });
  const t0 = Date.now();
  const id = minutes === 10 ? topic : `${topic}-${minutes}`;
  const st = style || chooseStyle(await feedback());
  // 1. shot plan on the LLM host (the pipeline files must be there: see README)
  sh(LLM, `cd ${LLM_DIR} && set -a && . ${LLM_ENV} && set +a && GROQ_MODEL=\${GROQ_MODEL:-openai/gpt-oss-120b} node integrations/documentary/run.mjs shotplan --topic ${topic} --style ${st} --minutes ${minutes} --out ${LLM_DIR}/${id}.plan.json`);
  const planFile = path.join(LOCAL, `${id}.plan.json`);
  scpFrom(LLM, `${LLM_DIR}/${id}.plan.json`, planFile);
  // 2. board (reuse-only first wave) against the worker's parts index
  const idx = path.join(LOCAL, 'assets.json');
  sh(WORKER, `cd ${W_DIR} && ${W_PY} index_assets.py --out assets.json >/dev/null`);
  scpFrom(WORKER, `${W_DIR}/assets.json`, idx);
  const plan = JSON.parse(fs.readFileSync(planFile, 'utf8'));
  const board = buildBoard({ ...plan, topic }, JSON.parse(fs.readFileSync(idx, 'utf8')), { renderBudget: reuseOnly ? 0 : (RENDER_CAP[minutes] || 25) });
  board.id = id;
  if (board.anachronisms && board.anachronisms.length) throw new Error(`board has ${board.anachronisms.length} anachronisms: ${JSON.stringify(board.anachronisms).slice(0, 200)}`);
  const boardFile = path.join(LOCAL, `${id}.board.json`);
  fs.writeFileSync(boardFile, JSON.stringify(board));
  scpTo(boardFile, WORKER, `${W_DIR}/${id}.board.json`);
  // 3. render (blocking) on the worker
  const tr = Date.now();
  sh(WORKER, `cd ${W_DIR} && nice -n 15 ${W_PY} render_wordless.py ${id}.board.json --out ${W_OUT}/${id} > render_${id}.log 2>&1; tail -1 render_${id}.log`);
  const renderSec = Math.round((Date.now() - tr) / 1000);
  // 4. publish
  publish(id);
  const line = { at: new Date().toISOString(), id, topic, minutes, style: st, shots: board.shots.length, missing: board.missing.length, renderSec, totalSec: Math.round((Date.now() - t0) / 1000), url: `${PUBLIC}/documentaries/${id}` };
  fs.appendFileSync(path.join(LOCAL, 'batch-log.jsonl'), JSON.stringify(line) + '\n');
  console.log(JSON.stringify(line));
  return line;
}

if (process.argv[1] && process.argv[1].endsWith('batch.mjs')) {
  if (!LLM || !WORKER || !WEB || !LLM_ENV) { console.error('set DOC_LLM_HOST, DOC_WORKER_HOST, DOC_WEB_HOST (SSH aliases) and DOC_LLM_ENVFILE'); process.exit(2); }
  const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
  const minutes = +arg('--minutes', '10');
  const queue = arg('--queue') ? JSON.parse(fs.readFileSync(arg('--queue'), 'utf8')) : String(arg('--topics', '')).split(',').filter(Boolean).map((topic) => ({ topic, minutes }));
  for (const job of queue) {
    try { await makeFilm(job); } catch (e) { console.error(`FAILED ${job.topic}: ${String(e.message || e).slice(0, 300)}`); fs.appendFileSync(path.join(LOCAL, 'batch-log.jsonl'), JSON.stringify({ at: new Date().toISOString(), topic: job.topic, failed: String(e.message || e).slice(0, 300) }) + '\n'); }
  }
}
