// training-export.mjs — PURE serializer that turns curated knowledge records into the JSONL shapes
// AI training pipelines actually consume. Backlog item 974141a3e9 / Itinerary item 243 ("Exports to
// JSON/JSONL for AI training").
//
// Why this exists alongside the two adjacent tools: integrations/jsonl.mjs is a *generic* JSONL
// parse/stringify/dedupe helper (it knows nothing about training shapes), and tools/dataset-curate.mjs
// decides KEEP/SKIP per document but does not emit a training format. This module is the missing piece:
// given curated {q,a}-ish records, it emits the three standard fine-tuning layouts —
//   - chat:        {messages:[{role:"system"?},{role:"user"},{role:"assistant"}]}   (OpenAI/most SFT)
//   - completion:  {prompt, completion}                                              (legacy/base)
//   - instruction: {instruction, input, output}                                      (Alpaca-style)
//
// Pure module: no IO, no network, no secrets, never throws. Invalid/empty records are SKIPPED (soft
// fail) — the emit functions return a string and stash a skip count you can read via lastStats(). Each
// emitted line ends with \n; embedded newlines in field values are escaped solely by JSON.stringify
// (JSON is the escaping — no esc()/HTML here, this is data not markup).
//
//   import { toChatJsonl, toCompletionJsonl, toInstructionJsonl, fromConversation,
//            validateRecord, lineCount } from './training-export.mjs'
//   node tools/training-export.mjs        # prints a tiny inline-sample demo in all three formats

// ── Field coercion. Records arrive in many shapes; normalize to a canonical {prompt, completion}. ──
// Accepted prompt-side keys (first non-empty wins): q, question, prompt, instruction, input, user.
// Accepted completion-side keys: a, answer, completion, output, response, assistant.
const PROMPT_KEYS = ['q', 'question', 'prompt', 'instruction', 'input', 'user'];
const COMPLETION_KEYS = ['a', 'answer', 'completion', 'output', 'response', 'assistant'];

function firstString(rec, keys) {
  if (!rec || typeof rec !== 'object') return '';
  for (const k of keys) {
    const v = rec[k];
    if (typeof v === 'string' && v.trim() !== '') return v;
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  }
  return '';
}

// coerce(rec) → { prompt, completion } with trimmed strings (empty string when absent).
export function coerce(rec) {
  return {
    prompt: firstString(rec, PROMPT_KEYS).trim(),
    completion: firstString(rec, COMPLETION_KEYS).trim(),
  };
}

// ── validateRecord(rec, format) → { ok, errors[] }. A record is valid for *any* training format when
// it coerces to a non-empty prompt AND a non-empty completion. `format` is accepted for caller clarity
// / future per-format rules but the core requirement is the same across all three. ──
export function validateRecord(rec, format = 'chat') {
  const errors = [];
  if (rec == null || typeof rec !== 'object' || Array.isArray(rec)) {
    errors.push('record is not an object');
    return { ok: false, errors };
  }
  const { prompt, completion } = coerce(rec);
  if (prompt === '') errors.push('missing prompt/question/instruction');
  if (completion === '') errors.push('missing completion/answer/output');
  if (typeof format !== 'string' || !FORMATS.has(format)) {
    errors.push(`unknown format: ${String(format)}`);
  }
  return { ok: errors.length === 0, errors };
}

const FORMATS = new Set(['chat', 'completion', 'instruction']);

// ── Stats: emit functions are pure (same input → same output) but also record how many records were
// kept vs skipped on the *last* call, so callers/tests can assert soft-fail behaviour without parsing. ──
let _lastStats = { kept: 0, skipped: 0 };
export function lastStats() {
  return { ..._lastStats };
}

// emit(): shared driver. mapFn(canonical, raw) → the per-line training object, or null to skip.
function emit(records, format, mapFn) {
  _lastStats = { kept: 0, skipped: 0 };
  if (!Array.isArray(records)) return '';
  const lines = [];
  for (const rec of records) {
    const v = validateRecord(rec, format);
    if (!v.ok) { _lastStats.skipped++; continue; }
    let obj;
    try {
      obj = mapFn(coerce(rec), rec);
    } catch {
      _lastStats.skipped++; // mapFn blew up on a weird record: skip, never throw.
      continue;
    }
    if (obj == null) { _lastStats.skipped++; continue; }
    let s;
    try {
      s = JSON.stringify(obj);
    } catch {
      _lastStats.skipped++; // circular / BigInt etc.
      continue;
    }
    if (s === undefined) { _lastStats.skipped++; continue; }
    lines.push(s + '\n'); // each line ends with \n; JSON.stringify is the only escaping.
    _lastStats.kept++;
  }
  return lines.join('');
}

// ── toChatJsonl(records, {system}) → chat-format JSONL. Each line:
//   {"messages":[{"role":"system","content":...}?,{"role":"user",...},{"role":"assistant",...}]}
// A non-empty `system` string prepends a system turn to every record. ──
export function toChatJsonl(records, opts = {}) {
  const system = opts && typeof opts.system === 'string' && opts.system.trim() !== ''
    ? opts.system.trim()
    : null;
  return emit(records, 'chat', ({ prompt, completion }) => {
    const messages = [];
    if (system) messages.push({ role: 'system', content: system });
    messages.push({ role: 'user', content: prompt });
    messages.push({ role: 'assistant', content: completion });
    return { messages };
  });
}

// ── toCompletionJsonl(records) → {"prompt":...,"completion":...} per line. ──
export function toCompletionJsonl(records) {
  return emit(records, 'completion', ({ prompt, completion }) => ({ prompt, completion }));
}

// ── toInstructionJsonl(records) → Alpaca-style {"instruction":...,"input":...,"output":...}.
// `instruction` is the coerced prompt; `output` the coerced completion; `input` is the record's own
// optional `input`/`context` field (empty string when absent — the Alpaca convention). ──
export function toInstructionJsonl(records) {
  return emit(records, 'instruction', ({ prompt, completion }, raw) => {
    let input = '';
    if (raw && typeof raw === 'object') {
      const cand = raw.input ?? raw.context;
      if (typeof cand === 'string') input = cand.trim();
      else if (typeof cand === 'number' || typeof cand === 'boolean') input = String(cand);
    }
    // If `input` was used as the prompt-source (no other prompt key matched), don't duplicate it.
    if (input !== '' && input === prompt) input = '';
    return { instruction: prompt, input, output: completion };
  });
}

// ── fromConversation(turns) → normalized {prompt, completion} records. Pairs each user/human turn with
// the assistant/bot turn that follows it. Turns are { role, content } (role aliases: user≈human,
// assistant≈bot≈hathor; system turns are ignored for pairing). Unmatched user turns are dropped. ──
const USER_ROLES = new Set(['user', 'human', 'questioner', 'q']);
const ASSISTANT_ROLES = new Set(['assistant', 'bot', 'hathor', 'ai', 'a']);

function turnContent(t) {
  if (t == null) return '';
  if (typeof t === 'string') return t;
  if (typeof t.content === 'string') return t.content;
  if (typeof t.text === 'string') return t.text;
  if (typeof t.message === 'string') return t.message;
  return '';
}
function turnRole(t) {
  if (t && typeof t === 'object' && typeof t.role === 'string') return t.role.toLowerCase().trim();
  return '';
}

export function fromConversation(turns) {
  if (!Array.isArray(turns)) return [];
  const records = [];
  let pendingPrompt = null;
  for (const t of turns) {
    const role = turnRole(t);
    const content = turnContent(t).trim();
    if (content === '') continue;
    if (USER_ROLES.has(role) || (role === '' && pendingPrompt === null)) {
      // a user turn (or a bare/role-less turn taken as the prompt) opens a pair.
      pendingPrompt = content;
    } else if (ASSISTANT_ROLES.has(role) || (role === '' && pendingPrompt !== null)) {
      if (pendingPrompt !== null) {
        records.push({ prompt: pendingPrompt, completion: content });
        pendingPrompt = null;
      }
    }
    // system / unknown roles are skipped.
  }
  return records;
}

// ── lineCount(jsonlString) → number of non-empty lines (the count of emitted training rows). ──
export function lineCount(jsonlString) {
  if (typeof jsonlString !== 'string' || jsonlString === '') return 0;
  let n = 0;
  for (const line of jsonlString.split('\n')) {
    if (line.trim() !== '') n++;
  }
  return n;
}

// ── CLI demo: tiny inline sample, all three formats. Offline, no IO beyond stdout. ──
if (process.argv[1] && process.argv[1].endsWith('training-export.mjs')) {
  const sample = [
    { q: 'What is MELEK?', a: 'MELEK is the blockchain the witness Hathor serves.' },
    { question: 'Who is Hathor?', answer: 'A founding witness account on the MELEK chain.' },
    { prompt: 'Name a corpus document.', completion: 'The Phoenix Protocol.' },
    { instruction: 'Define an egregore.', input: 'one sentence', output: 'A collectively-held thought-form.' },
    { q: '', a: 'orphan — no prompt, should be skipped' }, // invalid → soft-skipped
  ];
  const sys = 'You are Hathor, a witness on the MELEK chain.';
  const chat = toChatJsonl(sample, { system: sys });
  const comp = toCompletionJsonl(sample);
  const inst = toInstructionJsonl(sample);
  console.log('# chat (' + lineCount(chat) + ' rows, ' + lastStats().skipped + ' skipped on last call)');
  process.stdout.write(toChatJsonl(sample, { system: sys }));
  console.log('# completion (' + lineCount(comp) + ' rows)');
  process.stdout.write(comp);
  console.log('# instruction (' + lineCount(inst) + ' rows)');
  process.stdout.write(inst);
  const conv = fromConversation([
    { role: 'system', content: sys },
    { role: 'user', content: 'Hello?' },
    { role: 'assistant', content: 'Peace be with you.' },
  ]);
  console.log('# fromConversation → ' + conv.length + ' record(s)');
}
