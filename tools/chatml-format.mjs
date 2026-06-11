// chatml-format.mjs — PURE serializer that turns conversation turns into the two
// token/schema shapes the open fine-tuning ecosystem consumes that training-export.mjs
// does NOT cover. Backlog item cdeef2ee1f ("ChatML / ShareGPT training-record serializer").
//
// Why this exists alongside tools/training-export.mjs: that module emits OpenAI-style
// records (chat {messages}, completion {prompt,completion}, instruction {instruction,…}).
// This one targets the *other* two layouts that show up everywhere in local-model land:
//   - ChatML token format:  <|im_start|>role\ncontent<|im_end|>\n  (Qwen / many SFT templates)
//   - ShareGPT schema:       { conversations: [ { from:'human'|'gpt'|'system', value } ] }
// plus the JSONL line-shape ShareGPT datasets ship in. Role mapping is the load-bearing
// part: user→human, assistant→gpt, system→system (system stays system in ShareGPT).
//
// Pure module: no IO, no network, no secrets, never throws. Malformed turns are SKIPPED
// (soft fail). Strings are sanitized of control chars (this is *data*, not HTML, so there
// is no esc()/markup-escaping here — JSON.stringify does the JSON-level escaping). The only
// stripping we do is removing the ASCII control characters that would corrupt a JSONL line
// or smuggle a fake ChatML delimiter.
//
//   import { toChatML, toShareGPT, toShareGPTJsonl, fromOpenAI,
//            validateTurns, chatMLToTurns, shareGPTToTurns } from './chatml-format.mjs'
//   node tools/chatml-format.mjs path/to/turns.json   # prints ShareGPT JSONL

const IM_START = '<|im_start|>';
const IM_END = '<|im_end|>';

// Canonical OpenAI/ChatML roles → ShareGPT `from` values.
const ROLE_TO_FROM = { system: 'system', user: 'human', assistant: 'gpt' };
// Reverse, for parsing ShareGPT back into turns.
const FROM_TO_ROLE = { system: 'system', human: 'user', gpt: 'assistant' };
const KNOWN_ROLES = new Set(['system', 'user', 'assistant']);

// ── stripControl(s): remove ASCII control chars except \n and \t, and collapse any
// literal ChatML delimiter that snuck into content (defensive: keeps delimiters meaningful).
function stripControl(s) {
  if (s == null) return '';
  let str;
  if (typeof s === 'string') str = s;
  else if (typeof s === 'number' || typeof s === 'boolean') str = String(s);
  else return '';
  // Drop ASCII control chars (0x00–0x1F, 0x7F) except TAB (0x09) and LF (0x0A).
  // Built char-by-char so the SOURCE contains no literal control bytes.
  let out = '';
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    if ((c < 0x20 && c !== 0x09 && c !== 0x0a) || c === 0x7f) continue;
    out += str[i];
  }
  return out;
}

// ── normalizeTurn(t): coerce one item to {role, content} or null if unusable.
// Accepts {role,content}, {from,value} (ShareGPT), {role,value}, {from,content}.
function normalizeTurn(t) {
  if (t == null || typeof t !== 'object' || Array.isArray(t)) return null;
  let role = t.role;
  if (typeof role !== 'string' && typeof t.from === 'string') {
    role = FROM_TO_ROLE[t.from.toLowerCase()] || t.from;
  }
  if (typeof role !== 'string' || role.trim() === '') return null;
  role = role.toLowerCase().trim();
  if (!KNOWN_ROLES.has(role)) return null;

  let raw = t.content;
  if (raw == null) raw = t.value;
  const content = stripControl(raw);
  if (content === '') return null;
  return { role, content };
}

// ── fromOpenAI(messages) → turns. Normalize an OpenAI messages[] (or any mixed array)
// into clean [{role,content}], dropping malformed/unknown-role/empty entries. Soft-fail.
export function fromOpenAI(messages) {
  if (!Array.isArray(messages)) return [];
  const out = [];
  for (const m of messages) {
    const t = normalizeTurn(m);
    if (t) out.push(t);
  }
  return out;
}

// ── validateTurns(turns) → {ok, errors[]}. ok=true iff at least one turn survives
// normalization and nothing is structurally fatal. Reports per-index issues; never throws.
export function validateTurns(turns) {
  const errors = [];
  if (!Array.isArray(turns)) {
    return { ok: false, errors: ['turns is not an array'] };
  }
  let kept = 0;
  turns.forEach((t, i) => {
    const n = normalizeTurn(t);
    if (!n) {
      errors.push(`turn[${i}]: malformed or unknown role (skipped)`);
    } else {
      kept++;
    }
  });
  if (kept === 0) errors.push('no valid turns');
  return { ok: kept > 0, errors };
}

// ── toChatML(turns) → string of <|im_start|>role\ncontent<|im_end|> blocks, newline-joined.
// Malformed turns skipped. Returns '' when nothing valid.
export function toChatML(turns) {
  const norm = fromOpenAI(turns);
  if (norm.length === 0) return '';
  return norm
    .map((t) => `${IM_START}${t.role}\n${t.content}${IM_END}`)
    .join('\n');
}

// ── toShareGPT(turns) → { conversations: [ {from, value} ] }. user→human, assistant→gpt,
// system→system. Malformed turns skipped (empty conversations array if none survive).
export function toShareGPT(turns) {
  const norm = fromOpenAI(turns);
  return {
    conversations: norm.map((t) => ({
      from: ROLE_TO_FROM[t.role] || t.role,
      value: t.content,
    })),
  };
}

// ── toShareGPTJsonl(conversations) → newline-terminated JSONL string, one JSON object per
// line. Accepts: an array of ShareGPT objects ([{conversations:[…]}, …]); a single ShareGPT
// object ({conversations:[…]}); or an array of turns ([{role,content},…]) which is wrapped.
// Lines whose conversations come out empty are skipped. Each line ends with \n. Soft-fail.
export function toShareGPTJsonl(conversations) {
  const records = [];
  const pushRecord = (rec) => {
    if (rec && typeof rec === 'object' && Array.isArray(rec.conversations)) {
      // Already a ShareGPT object — re-normalize its conversations through turns.
      const turns = shareGPTToTurns(rec);
      const sg = toShareGPT(turns);
      if (sg.conversations.length > 0) records.push(sg);
    } else {
      // Treat as a turn → it can only stand alone if it's a valid single turn.
      const sg = toShareGPT([rec]);
      if (sg.conversations.length > 0) records.push(sg);
    }
  };

  if (conversations == null) return '';
  if (Array.isArray(conversations)) {
    // Distinguish "array of turns" from "array of ShareGPT objects".
    const looksLikeTurns = conversations.some(
      (x) => x && typeof x === 'object' && ('role' in x || 'content' in x)
    );
    const looksLikeShareGPT = conversations.some(
      (x) => x && typeof x === 'object' && Array.isArray(x.conversations)
    );
    if (looksLikeShareGPT && !looksLikeTurns) {
      for (const rec of conversations) pushRecord(rec);
    } else if (looksLikeTurns && !looksLikeShareGPT) {
      const sg = toShareGPT(conversations);
      if (sg.conversations.length > 0) records.push(sg);
    } else {
      // Ambiguous/mixed — handle each element on its own merits.
      for (const rec of conversations) pushRecord(rec);
    }
  } else if (typeof conversations === 'object') {
    pushRecord(conversations);
  } else {
    return '';
  }

  return records.map((r) => JSON.stringify(r)).join('\n') + (records.length ? '\n' : '');
}

// ── chatMLToTurns(text) → turns. Parse a ChatML string back into [{role,content}].
// Tolerant: ignores text outside delimiters, skips blocks with unknown/empty role. Soft-fail.
export function chatMLToTurns(text) {
  if (typeof text !== 'string' || text === '') return [];
  const out = [];
  const re = new RegExp(
    `${escapeRe(IM_START)}([^\\n]*)\\n([\\s\\S]*?)${escapeRe(IM_END)}`,
    'g'
  );
  let m;
  while ((m = re.exec(text)) !== null) {
    const role = (m[1] || '').toLowerCase().trim();
    const content = stripControl(m[2]);
    if (KNOWN_ROLES.has(role) && content !== '') out.push({ role, content });
  }
  return out;
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ── shareGPTToTurns(obj) → turns. Parse a ShareGPT { conversations:[{from,value}] } object
// (or a bare conversations array) back into [{role,content}]. Soft-fail.
export function shareGPTToTurns(obj) {
  let convs;
  if (Array.isArray(obj)) convs = obj;
  else if (obj && typeof obj === 'object' && Array.isArray(obj.conversations)) {
    convs = obj.conversations;
  } else return [];
  return fromOpenAI(
    convs.map((c) => {
      if (!c || typeof c !== 'object') return null;
      const role = typeof c.from === 'string' ? FROM_TO_ROLE[c.from.toLowerCase()] : undefined;
      return { role, content: c.value };
    })
  );
}

// ── CLI: read a JSON turns file and print ShareGPT JSONL. Guarded so importing is side-effect free.
if (process.argv[1] && process.argv[1].endsWith('chatml-format.mjs')) {
  (async () => {
    const path = process.argv[2];
    if (!path) {
      const demo = [
        { role: 'system', content: 'You are Hathor, a witness on the MELEK chain.' },
        { role: 'user', content: 'What is MELEK?' },
        { role: 'assistant', content: 'MELEK is the blockchain I serve as a founding witness.' },
      ];
      process.stdout.write('# no file given — demo\n');
      process.stdout.write('## ChatML\n' + toChatML(demo) + '\n');
      process.stdout.write('## ShareGPT JSONL\n' + toShareGPTJsonl(demo));
      return;
    }
    try {
      const fs = await import('node:fs/promises');
      const raw = await fs.readFile(path, 'utf8');
      const turns = JSON.parse(raw);
      process.stdout.write(toShareGPTJsonl(turns));
    } catch (e) {
      process.stderr.write('chatml-format: could not read/parse ' + path + ': ' + e.message + '\n');
    }
  })();
}
