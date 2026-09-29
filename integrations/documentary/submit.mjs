#!/usr/bin/env node
// submit.mjs — Hathor's documentary SUBMITTER. Runs on the posting host (it holds the LLM keys) from a systemd timer:
// keeps a month-long queue (topic-gen.mjs: must-haves, civilizations × facets, themes, remakes groups, animated maps;
// 10 / 30 / 60 minutes), re-prioritises it from viewer votes (/documentaries/feedback.json), turns the next entry into a
// grounded topic definition and a shot plan with the free-first LLM router, and posts it to the Video Studio as a
// production job. The CPU worker pulls it over HTTPS, renders it with the documentary pipeline and publishes it to
// /documentaries; the @shilpa-shastra poster posts it. No SSH between servers; no provider key leaves this host.
//
//   VSTUDIO_BASE=https://<studio> VSTUDIO_PRODUCTION_TOKEN=… node integrations/documentary/submit.mjs [--dry] [--status]
//   env: DOC_STATE_DIR, DOC_MAX_OPEN (default 2), PRODUCTION_PAUSE_FILE (the stop-switch flag; private env file),
//        GROQ_MODEL (openai/gpt-oss-120b — Groq's default model 404s)

import fs from 'node:fs';
import path from 'node:path';
import { TOPICS } from './topics.mjs';
import { chooseStyle } from './batch.mjs';
import { fullPlan } from './run.mjs';
import { buildQueue, prioritise, defineTopic } from './topic-gen.mjs';

const env = (k, d) => process.env[k] || d;
const BASE = env('VSTUDIO_BASE', '').replace(/\/$/, '');
const TOK = env('VSTUDIO_PRODUCTION_TOKEN', '');
const PUBLIC = env('DOC_PUBLIC_URL', BASE);
const STATE_DIR = env('DOC_STATE_DIR', path.join(process.cwd(), '.doc-submit'));
const MAX_OPEN = +env('DOC_MAX_OPEN', '2');
const PAUSE = env('PRODUCTION_PAUSE_FILE', ''); // set in the host's private env file
const RETRY_AFTER_MS = 6 * 3600e3;
const MAX_TRIES = 3;

let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }
async function getJson(u, headers = {}) { try { const r = await _fetch(u, { headers, signal: AbortSignal.timeout(30000) }); return r.ok ? await r.json() : null; } catch { return null; } }

export const docIdOf = ({ topic, minutes = 10 }) => (+minutes === 10 ? topic : `${topic}-${minutes}`);

/** Next entry to make from an already-prioritised list: not open, not retried too often. Pure. */
export function pickNext(ordered, { status = { recent: [] }, state = {}, now = Date.now() } = {}) {
  const open = new Set(status.recent.filter((j) => j.status === 'queued' || j.status === 'rendering').map((j) => j.docId));
  for (const e of ordered) {
    if (open.has(e.docId)) continue;
    const s = state[e.docId];
    if (s && s.tries >= MAX_TRIES) continue;
    if (s && now - s.at < RETRY_AFTER_MS) continue;
    return e;
  }
  return null;
}

let _complete = null;
async function llm(prompt, opts) {
  if (!_complete) _complete = (await import('../llm-router.mjs')).complete;
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = await _complete(prompt, { maxTokens: 3000, temperature: 0.4, ...opts });
    if (r && r.text) return r;
    await new Promise((res) => setTimeout(res, 8000 * (attempt + 1)));
  }
  return { text: '' };
}

async function main() {
  const dry = process.argv.includes('--dry');
  if (!BASE || TOK.length < 24) { console.error('set VSTUDIO_BASE and VSTUDIO_PRODUCTION_TOKEN'); process.exit(2); }
  const auth = { authorization: `Bearer ${TOK}` };
  const paused = !!PAUSE && fs.existsSync(PAUSE);
  fs.mkdirSync(path.join(STATE_DIR, 'topics'), { recursive: true });
  const stateFile = path.join(STATE_DIR, 'state.json');
  let state = {}; try { state = JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch {}
  // the durable month queue: built once, topped up with new remakes groups and maps on every run
  const qFile = path.join(STATE_DIR, 'queue.json');
  const remakes = await getJson(`${PUBLIC}/remakes/manifest.json`);
  const maps = await getJson(`${PUBLIC}/maps/index.json`);
  const fresh = buildQueue({ remakeGroups: [...new Set(((remakes && remakes.scenes) || []).map((s) => s.group).filter(Boolean))], maps: (maps && maps.clips) || [] });
  let queue = []; try { queue = JSON.parse(fs.readFileSync(qFile, 'utf8')); } catch {}
  for (const e of fresh) if (!queue.some((x) => x.docId === e.docId)) queue.push(e);
  fs.writeFileSync(qFile, JSON.stringify(queue, null, 1));
  const manifest = await getJson(`${PUBLIC}/documentaries/manifest.json`);
  const published = new Set(((manifest && manifest.films) || []).map((f) => f.id));
  const feedback = await getJson(`${PUBLIC}/documentaries/feedback.json`) || {};
  const docArms = Object.fromEntries(queue.map((e) => [e.docId, e.arm]));
  const ordered = prioritise(queue, { feedback, published, docArms });
  const status = await getJson(`${BASE}/video-studio/api/production/jobs`, auth);
  const today = new Date().toISOString().slice(0, 10);
  const madeToday = ((manifest && manifest.films) || []).filter((f) => f.made && new Date(f.made > 1e12 ? f.made : f.made * 1000).toISOString().slice(0, 10) === today).length;
  const snapshot = { updated: Date.now(), paused, queue: { total: queue.length, remaining: ordered.length, published: published.size, byLength: Object.fromEntries([10, 30, 60].map((m) => [m, ordered.filter((e) => e.minutes === m).length])) }, madeToday, open: status ? status.open : null, next: ordered.slice(0, 12).map((e) => ({ docId: e.docId, name: e.name, minutes: e.minutes })) };
  if (!dry) await _fetch(`${BASE}/video-studio/api/production/status`, { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify(snapshot), signal: AbortSignal.timeout(30000) }).catch(() => {});
  if (process.argv.includes('--status')) { console.log(JSON.stringify(snapshot, null, 1)); return; }
  if (paused) { console.log('paused (flag file present) — nothing submitted'); return; }
  if (!status) { console.error('production API unreachable'); process.exit(1); }
  if (status.open >= MAX_OPEN) { console.log(`${status.open} production jobs open (max ${MAX_OPEN}) — nothing to submit`); return; }
  const next = pickNext(ordered, { status, state });
  if (!next) { console.log(`nothing to submit (${ordered.length} remaining, ${published.size} published)`); return; }
  // topic: hand-written (topics.mjs) when one exists for this docId, else generated once and cached
  let topicDef = null;
  const handId = next.minutes === 10 ? next.docId : next.docId.replace(/-\d+$/, '');
  if (!TOPICS[handId]) {
    const tf = path.join(STATE_DIR, 'topics', `${next.docId}.json`);
    try { topicDef = JSON.parse(fs.readFileSync(tf, 'utf8')); } catch {}
    if (!topicDef) {
      console.log(`defining topic ${next.docId}: ${next.name}`);
      topicDef = await defineTopic(next, llm);
      if (!topicDef) { state[next.docId] = { at: Date.now(), tries: ((state[next.docId] || {}).tries || 0) + 1, error: 'topic definition failed' }; fs.writeFileSync(stateFile, JSON.stringify(state, null, 1)); console.error(`topic definition failed for ${next.docId}`); process.exit(1); }
      fs.writeFileSync(tf, JSON.stringify(topicDef, null, 1));
    }
  }
  const style = chooseStyle(feedback);
  const planFile = path.join(STATE_DIR, `${next.docId}.plan.json`);
  console.log(`planning ${next.docId} (${next.minutes} min, style ${style})`);
  await fullPlan(topicDef || handId, style, next.minutes, planFile);
  const docPlan = { ...JSON.parse(fs.readFileSync(planFile, 'utf8')), wantAssets: next.assets || [] };
  if (dry) { console.log(`would submit ${next.docId}: ${docPlan.scenes.length} scenes`); return; }
  const r = await _fetch(`${BASE}/video-studio/api/production/jobs`, { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ docId: next.docId, topic: next.name, minutes: next.minutes, style, docPlan }), signal: AbortSignal.timeout(60000) });
  const j = await r.json().catch(() => ({}));
  state[next.docId] = { at: Date.now(), tries: ((state[next.docId] || {}).tries || 0) + 1, job: j.id || '', style };
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 1));
  fs.appendFileSync(path.join(STATE_DIR, 'submit-log.jsonl'), JSON.stringify({ at: new Date().toISOString(), docId: next.docId, minutes: next.minutes, style, scenes: docPlan.scenes.length, job: j.id || '', ok: !!(r.ok && j.ok), error: j.error || '' }) + '\n');
  if (!r.ok || !j.ok) { console.error(`submit failed ${r.status}: ${j.error || ''}`); process.exit(1); }
  console.log(`submitted ${next.docId}: job ${j.id}, ${docPlan.scenes.length} scenes, style ${style}`);
}

if (process.argv[1] && process.argv[1].endsWith('submit.mjs')) await main();
