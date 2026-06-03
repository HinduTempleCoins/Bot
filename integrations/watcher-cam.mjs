// watcher-cam.mjs — BYO-camera watcher (queue #172). Pulls a single frame from any IP camera
// (RTSP / ONVIF, via ffmpeg), hands it to a vision LLM (Gemini, BYO key from the vault) for a
// plain-English description + decision, then notifies via SMS / email when something matters.
//
// Hathor-safe by construction: this module ONLY watches, describes, and notifies. It never
// touches the chain, never signs, never moves value. It is an out-of-band senses-and-alert
// surface, the same shape as watcher/ but for a camera instead of the ledger.
//
// Everything that does I/O is INJECTED so the whole flow is testable offline:
//   - frameSource()  → returns a frame (Buffer / base64 / {data,mime}); real impl shells to ffmpeg
//   - analyze(frame) → returns { description: string } (or a bare string); real impl calls Gemini
//   - notify(msg)    → fires the alert (Twilio SMS / email); real impl is injected by the caller
// detectEvents() is PURE — given a description string + rules, it decides whether to alert. The
// real-world adapters (ffmpegFrameSource / geminiAnalyzer) are exported too but are guarded so the
// tests never require ffmpeg or the network.
//
//   import { watchOnce, detectEvents } from './watcher-cam.mjs'
//   node integrations/watcher-cam.mjs --rtsp rtsp://user:pass@cam/stream   # one-shot CLI

// ── default event rules ──────────────────────────────────────────────────────
// Each rule: { event, keywords[], priority }. detectEvents lower-cases the description and looks
// for any keyword as a substring. Keep keywords lower-case. Callers can override / extend.
export const DEFAULT_RULES = [
  { event: 'glass-break', keywords: ['glass break', 'glass breaking', 'broken glass', 'shattered', 'window broken'], priority: 'high' },
  { event: 'person', keywords: ['person', 'people', 'man', 'woman', 'someone', 'intruder', 'figure', 'individual'], priority: 'medium' },
  { event: 'package', keywords: ['package', 'parcel', 'delivery', 'box on', 'box at', 'mail', 'courier'], priority: 'low' },
  { event: 'vehicle', keywords: ['car', 'truck', 'vehicle', 'van', 'motorcycle'], priority: 'low' },
  { event: 'fire', keywords: ['fire', 'smoke', 'flames'], priority: 'high' },
];

// ── detectEvents: PURE keyword → alert decision ───────────────────────────────
// Returns { alert: boolean, matches: [{event, priority, keyword}], priority: highest|null }.
// alert is true when at least one rule's keyword appears in the description.
export function detectEvents(description, rules = DEFAULT_RULES) {
  const text = String(description == null ? '' : description).toLowerCase();
  const list = Array.isArray(rules) ? rules : DEFAULT_RULES;
  const matches = [];
  for (const rule of list) {
    if (!rule || !Array.isArray(rule.keywords)) continue;
    const hit = rule.keywords.find((k) => k && text.includes(String(k).toLowerCase()));
    if (hit) matches.push({ event: rule.event, priority: rule.priority || 'low', keyword: hit });
  }
  const order = { high: 3, medium: 2, low: 1 };
  let priority = null;
  for (const m of matches) {
    if (priority == null || (order[m.priority] || 0) > (order[priority] || 0)) priority = m.priority;
  }
  return { alert: matches.length > 0, matches, priority };
}

// Normalize whatever analyze() returns into a description string.
function describeOf(result) {
  if (result == null) return '';
  if (typeof result === 'string') return result;
  if (typeof result.description === 'string') return result.description;
  if (typeof result.text === 'string') return result.text;
  return String(result);
}

// Build the human-readable alert message from the decision.
function alertMessage(description, decision) {
  const events = decision.matches.map((m) => m.event).join(', ') || 'event';
  const pri = decision.priority ? `[${decision.priority.toUpperCase()}] ` : '';
  return `${pri}Camera alert (${events}): ${description}`;
}

// ── watchOnce: one full cycle frame → analyze → decide → notify ───────────────
// All three collaborators are injected. notify() is called ONLY when detectEvents flags an alert.
// Returns { description, alerted, decision, message }.
export async function watchOnce({ frameSource, analyze, notify, rules = DEFAULT_RULES } = {}) {
  if (typeof frameSource !== 'function') throw new TypeError('watchOnce: frameSource must be a function');
  if (typeof analyze !== 'function') throw new TypeError('watchOnce: analyze must be a function');

  const frame = await frameSource();
  const result = await analyze(frame);
  const description = describeOf(result);

  const decision = detectEvents(description, rules);
  const message = alertMessage(description, decision);

  let alerted = false;
  if (decision.alert && typeof notify === 'function') {
    await notify(message, { description, decision });
    alerted = true;
  }

  return { description, alerted, decision, message };
}

// ── real-world adapters (GUARDED — never required by the tests) ────────────────
//
// ffmpegFrameSource: returns a frameSource() that shells to ffmpeg to grab ONE JPEG frame from an
// RTSP/ONVIF URL and resolves to a Buffer. ffmpeg is loaded lazily so importing this module never
// requires it; only calling the returned fn touches child_process.
export function ffmpegFrameSource({ rtspUrl, ffmpegPath = 'ffmpeg', timeoutMs = 15000 } = {}) {
  if (!rtspUrl) throw new TypeError('ffmpegFrameSource: rtspUrl is required');
  return async function pullFrame() {
    const { execFile } = await import('node:child_process');
    return await new Promise((resolve, reject) => {
      // -frames:v 1 grabs a single frame; pipe JPEG to stdout.
      const args = ['-y', '-rtsp_transport', 'tcp', '-i', rtspUrl, '-frames:v', '1', '-f', 'image2', '-vcodec', 'mjpeg', 'pipe:1'];
      const child = execFile(ffmpegPath, args, { encoding: 'buffer', timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024 }, (err, stdout) => {
        if (err) return reject(err);
        if (!stdout || !stdout.length) return reject(new Error('ffmpeg produced no frame'));
        resolve(stdout);
      });
      child.on('error', reject);
    });
  };
}

// geminiAnalyzer: returns an analyze(frame) that POSTs the frame (base64) to the Gemini vision API
// using a BYO key (pulled by the caller from the vault capability and passed in). fetch is the
// only network dependency and it is only touched when the returned fn is CALLED.
export function geminiAnalyzer({ apiKey, model = 'gemini-1.5-flash', prompt, fetchImpl } = {}) {
  if (!apiKey) throw new TypeError('geminiAnalyzer: apiKey is required (BYO key from vault)');
  const ask = prompt || 'You are a security camera analyst. Describe what you see in one or two sentences. '
    + 'Call out any person, package/delivery, vehicle, fire/smoke, or broken/shattered glass explicitly.';
  return async function analyze(frame) {
    const doFetch = fetchImpl || globalThis.fetch;
    if (typeof doFetch !== 'function') throw new Error('geminiAnalyzer: no fetch available');
    const base64 = toBase64(frame);
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    const body = {
      contents: [{ parts: [{ text: ask }, { inline_data: { mime_type: mimeOf(frame), data: base64 } }] }],
    };
    const res = await doFetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`Gemini API ${res.status}`);
    const json = await res.json();
    const description = json?.candidates?.[0]?.content?.parts?.map((p) => p.text).filter(Boolean).join(' ') || '';
    return { description };
  };
}

function mimeOf(frame) {
  if (frame && typeof frame === 'object' && !Buffer.isBuffer(frame) && frame.mime) return frame.mime;
  return 'image/jpeg';
}

function toBase64(frame) {
  if (frame == null) return '';
  if (Buffer.isBuffer(frame)) return frame.toString('base64');
  if (frame instanceof Uint8Array) return Buffer.from(frame).toString('base64');
  if (typeof frame === 'string') return frame; // assume already base64
  if (typeof frame === 'object' && frame.data != null) return toBase64(frame.data);
  return Buffer.from(String(frame)).toString('base64');
}

// ── CLI (guarded) ─────────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('watcher-cam.mjs')) {
  const args = process.argv.slice(2);
  const getArg = (flag) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const rtspUrl = getArg('--rtsp') || process.env.WATCHER_CAM_RTSP;
  const apiKey = process.env.GEMINI_API_KEY; // BYO key, never hard-coded
  if (!rtspUrl) {
    console.error('usage: node integrations/watcher-cam.mjs --rtsp <rtsp-url>   (needs GEMINI_API_KEY in env)');
    process.exit(2);
  }
  if (!apiKey) {
    console.error('GEMINI_API_KEY not set — refusing to run without a BYO key.');
    process.exit(2);
  }
  const frameSource = ffmpegFrameSource({ rtspUrl });
  const analyze = geminiAnalyzer({ apiKey });
  const notify = async (msg) => console.log(msg); // CLI default: print; wire Twilio/email in prod
  const out = await watchOnce({ frameSource, analyze, notify });
  console.log(JSON.stringify({ description: out.description, alerted: out.alerted, decision: out.decision }, null, 2));
}
