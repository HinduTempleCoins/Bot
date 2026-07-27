// pentecaust/crm/builder.mjs — the LLM surface of the MoneyPrinter/AI-SDR system: the "conversational
// campaign builder". Per the research doc the LLM footprint is SMALL and surgical — (1) goal/website →
// structured ICP + a sequence draft, (2) a per-lead opener grounded in a VERIFIED signal only. Everything
// is guardrailed (facts-only, length caps) and every LLM call has a deterministic template fallback, so
// this module is soft-fail-never-throw and fully offline-testable.
//
// The LLM is INJECTED (like auth.mjs's __setFetch): production wires the guest-proxy/Groq router; tests
// inject a mock; with no LLM set we use the deterministic templates. The LLM only ever emits VALUES into
// the fixed schema in model.mjs — it does not invent the data shape or the sending engine.
//
//   import { buildCampaignPlan, personalizeOpener, renderStep, __setLLM } from './builder.mjs'

import { normalizeICP, normalizeStep } from './model.mjs';

// ── injectable LLM (prompt:string) -> Promise<string>. Null = deterministic templates only. ──────────
let _llm = null;
export function __setLLM(fn) { _llm = typeof fn === 'function' ? fn : null; }
async function ask(prompt) {
  if (!_llm) return null;
  try { const r = await _llm(String(prompt || '')); return r == null ? null : String(r); } catch { return null; }
}

// Pull the first balanced {...} JSON object out of an LLM reply (they wrap JSON in prose/```json fences).
function extractJson(text) {
  if (!text) return null;
  const i = text.indexOf('{');
  const j = text.lastIndexOf('}');
  if (i < 0 || j <= i) return null;
  try { return JSON.parse(text.slice(i, j + 1)); } catch { return null; }
}

// Guardrail: strip the spammy words that tank deliverability (first-touch copy stays plain + factual).
// Tokens with a trailing word char keep \b; punctuation-ending ones (100%, !!!) can't take a trailing \b.
const BANNED = /\b(?:free|guarantee(?:d)?|risk-?free|act ?now|limited ?time|buy ?now|cheap|winner|cash)\b|100%|!{2,}/gi;
const scrub = (s) => String(s || '').replace(BANNED, '').replace(/\s{2,}/g, ' ').trim();
const firstName = (name) => String(name || '').trim().split(/\s+/)[0] || 'there';

// ── the builder: goal/website/value-prop -> { icp, angle, sequence }. LLM if present, else template. ──
export async function buildCampaignPlan({ goal, website, valueProp } = {}) {
  const vp = String(valueProp || goal || '').trim();
  const prompt =
    'You are configuring a B2B outreach campaign. Return ONLY strict JSON with keys: ' +
    'icp {titles[],industries[],keywords[],geo[],size,valueProp}, angle (string), ' +
    'sequence (array of {channel:"email"|"linkedin", delayDays:int, subject, body}). ' +
    'Copy MUST be plain text, no links, and reference {{first_name}} and {{company}} merge fields only. ' +
    'Keep it factual and short. 3 email steps (day 0, 3, 7).\n' +
    `GOAL: ${goal || ''}\nWEBSITE: ${website || ''}\nVALUE PROP: ${vp}`;

  const parsed = extractJson(await ask(prompt));
  if (parsed && (parsed.icp || parsed.sequence)) {
    const icp = normalizeICP({ ...(parsed.icp || {}), valueProp: (parsed.icp && parsed.icp.valueProp) || vp });
    const sequence = Array.isArray(parsed.sequence) && parsed.sequence.length
      ? parsed.sequence.slice(0, 12).map((s) => normalizeStep({ ...s, subject: scrub(s.subject), body: scrub(s.body) }))
      : templateSequence(vp);
    return { icp, angle: scrub(parsed.angle) || defaultAngle(vp), sequence, source: 'llm' };
  }
  // Deterministic fallback — a real, sendable 3-touch plan built from the value prop, no LLM required.
  return { icp: normalizeICP({ valueProp: vp }), angle: defaultAngle(vp), sequence: templateSequence(vp), source: 'template' };
}

const defaultAngle = (vp) => scrub(vp) || 'Reaching out about something relevant to your team.';

function templateSequence(vp) {
  const v = scrub(vp) || 'what we do';
  return [
    normalizeStep({ channel: 'email', delayDays: 0, subject: 'Quick question, {{first_name}}',
      body: `Hi {{first_name}},\n\nI came across {{company}} and thought this might be relevant: ${v}.\n\nWorth a short conversation?\n\n— sent via MELEK` }),
    normalizeStep({ channel: 'email', delayDays: 3, subject: 'Re: Quick question',
      body: `Hi {{first_name}},\n\nFollowing up in case this slipped by. Happy to share how ${v} could fit {{company}}.\n\nOpen to a quick call?` }),
    normalizeStep({ channel: 'email', delayDays: 7, subject: 'Closing the loop',
      body: `Hi {{first_name}},\n\nI'll leave it here for now — if ${v} is ever useful for {{company}}, just reply and I'll follow up.\n\nThanks for your time.` }),
  ];
}

// ── per-lead opener — grounded in the lead's VERIFIED signal ONLY (never fabricates a fact). ──────────
export async function personalizeOpener(lead = {}, { angle } = {}) {
  const fn = firstName(lead.name);
  const signal = String(lead.signal || '').trim();
  if (!signal) return `Hi ${fn}, wanted to reach out about ${scrub(angle) || 'your team'}.`;   // no signal → generic, honest
  const prompt =
    'Write ONE short, factual opening line for a cold email. Use ONLY the given signal as the reason for ' +
    'reaching out — do not invent any other fact. No greeting, no links, under 200 chars.\n' +
    `NAME: ${lead.name || ''}\nCOMPANY: ${lead.company || ''}\nSIGNAL: ${signal}`;
  const line = scrub(await ask(prompt));
  if (line) return line.slice(0, 200);
  return `Hi ${fn}, noticed ${signal} at ${lead.company || 'your company'} — thought it was worth reaching out.`;
}

// ── deterministic merge-field render (substitution happens at SEND, not at draft time). ───────────────
export function renderStep(step = {}, lead = {}) {
  const map = {
    first_name: firstName(lead.name),
    name: lead.name || 'there',
    company: lead.company || 'your company',
    title: lead.title || '',
  };
  const sub = (s) => String(s || '').replace(/\{\{\s*(first_name|name|company|title)\s*\}\}/g, (_, k) => map[k]);
  return { channel: step.channel || 'email', delayDays: step.delayDays || 0, subject: sub(step.subject), body: sub(step.body) };
}
