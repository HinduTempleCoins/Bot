// wash-transcript.mjs — turn a raw Claude Code session transcript into a WASHED one the brain can keep.
//
// Why this exists: Server 4 runs the whole Briefs/Annals pipeline on a timer — reconcile.mjs mines
// operator asks out of `/var/melek-bot/brain/transcripts/*.jsonl`, mom-synth distills those into
// Decisions + Action Items, and brief-builder folds them into the hourly FOR-RYAN brief. That
// pipeline has been running over an EMPTY directory: nothing ever shipped the transcripts to it, so
// the briefs have been quoting asks from July.
//
// A raw transcript cannot be the thing we ship. It is ~100 MB per session, most of it tool output,
// and it carries credentials, private keys and server IPs that would land in a durable, append-only
// store forever. So we wash first:
//   - keep the operator's words verbatim (that is the precedent the briefs are built on)
//   - keep a short digest of each assistant turn (what was decided/done)
//   - DROP every tool_use input and tool_result payload — that is both the bulk and the risk
//   - redact secret-SHAPED tokens and every non-loopback IPv4 before a byte is written
//
// Over-redacting a random long token beats leaking a real one in a store that is never wiped.
import { createReadStream, createWriteStream, mkdirSync, statSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { basename, dirname } from 'node:path';

const ASSISTANT_DIGEST = 1200;   // chars of each assistant turn to retain

// --- the wash ------------------------------------------------------------------------------------
// Ordered most-specific first: an OpenSSH key block would otherwise be eaten piecemeal by the
// generic high-entropy rule and leave recognizable fragments behind.
export function wash(text) {
  if (typeof text !== 'string' || !text) return text;
  return text
    .replace(/-----BEGIN [^-]+-----[\s\S]*?-----END [^-]+-----/g, '[REDACTED:key-block]')
    // The JSON-escaped form, where the newlines are literal backslash-n inside a quoted string.
    // A service-account JSON pasted into chat looks like this, and the plain rule above misses it.
    .replace(/-----BEGIN [^-]+-----(?:\\n|[^"])*?-----END [^-]+-----/g, '[REDACTED:key-block]')
    // A key block that something upstream already chewed on is the worst case: it reads as redacted
    // while real key lines survive, because the generic token rule below does not match base64
    // containing "/" or "+". Catch any BEGIN marker that no longer has its END.
    .replace(/-----BEGIN [^-]+-----[\s\S]{0,4000}/g, '[REDACTED:key-block]')
    // Cloud service-account identities travel with the key and name the billed project.
    // Match the domain itself, not an address pattern. My own summary of a leak wrote the identity as
    // "melek-198@…iam.gserviceaccount.com" — the ellipsis fell outside the address character class, so
    // a careful mask in prose defeated the redaction. Anchor on the part that cannot be elided.
    .replace(/[^\s"'`]*iam\.gserviceaccount\.com/g, '[REDACTED:service-account]')
    // GCP project ids identify the billed project even with the key gone.
    .replace(/\b[a-z][a-z0-9-]*-client-\d{6,}\b/g, '[REDACTED:gcp-project]')
    // The marker itself, wherever it appears — including in prose describing a leak.
    .replace(/-{0,5}BEGIN [A-Z ]*PRIVATE KEY-{0,5}/g, '[REDACTED:key-block]')
    .replace(/"private_key_id"\s*:\s*"[^"]*"/g, '"private_key_id": "[REDACTED]"')
    .replace(/\b[a-z]{4}\s+[a-z]{4}\s+[a-z]{4}\s+[a-z]{4}\b/g, '[REDACTED:app-password]')
    .replace(/\b5[HJK][1-9A-HJ-NP-Za-km-z]{49}\b/g, '[REDACTED:wif-key]')
    .replace(/\b(?:STM|MLK|TST|PRA)[1-9A-HJ-NP-Za-km-z]{30,}\b/g, '[REDACTED:graphene-key]')
    .replace(/\b0x[0-9a-fA-F]{64}\b/g, '[REDACTED:evm-key]')
    .replace(/\b[0-9a-fA-F]{64}\b/g, '[REDACTED:hex-secret]')
    .replace(/\b(?=[A-Za-z0-9_-]*[A-Za-z])(?=[A-Za-z0-9_-]*[0-9])[A-Za-z0-9_-]{32,}\b/g, '[REDACTED:api-key]')
    // Base64 key material, which the token rule above skips because it contains "/" and "+". This is
    // the exact gap that left a real service-account key half-intact in a store that is never wiped:
    // the shredded result READ as redacted. Requires a "/" or "+", or mixed case plus a digit, so an
    // ordinary long word is not swallowed.
    .replace(/\b(?:[A-Za-z0-9+/]{40,}={0,2})\b/g, (m) =>
      (/[+/]/.test(m) || (/[a-z]/.test(m) && /[A-Z]/.test(m) && /[0-9]/.test(m))) ? '[REDACTED:b64]' : m)
    // Every non-loopback IPv4. Operator rule: server IPs never appear in anything durable.
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, (m) =>
      (m === '127.0.0.1' || m === '0.0.0.0' || m.startsWith('0.')) ? m : '[REDACTED:ip]');
}

// Pull the plain text out of a message content field, which is either a string or a block array.
// Tool blocks are dropped on the floor — they are the bulk and they are where secrets live.
function plainText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.filter((b) => b && b.type === 'text').map((b) => b.text || '').join('\n').trim();
}

// Not every "user" entry is the operator. The harness injects tool results, compaction summaries,
// subagent hand-backs, task notifications and system reminders through the same channel. Those are
// machine text, and downstream reconcile.mjs files whatever it finds here as "the operator's own
// words" in a store that is never wiped — so a subagent's report would become precedent it is not.
const SYNTHETIC = [
  /^Another Claude session sent a message:/,
  /^\[Subagent hand-back\]/,
  /^This session is being continued from a previous conversation/,
  /^\[SYSTEM NOTIFICATION/,
  /^<(system-reminder|task-notification|local-command|command-name|command-message)/,
  /^Caveat: The messages below were generated/,
  /^\[Request interrupted/,
  /^The user sent a new message while you were working:/,
];
export function isSynthetic(text) {
  const t = (text || '').trimStart();
  return SYNTHETIC.some((re) => re.test(t));
}

// A "user" entry in the transcript is either the operator typing or the harness handing back a tool
// result. Only the former is precedent; the latter is machine noise that would pollute the asks file.
function isRealOperatorTurn(entry) {
  const c = entry?.message?.content;
  if (typeof c === 'string') return c.trim().length > 0;
  if (!Array.isArray(c)) return false;
  return c.some((b) => b?.type === 'text') && !c.some((b) => b?.type === 'tool_result');
}

export async function washFile(inPath, outPath, { digest = ASSISTANT_DIGEST } = {}) {
  mkdirSync(dirname(outPath), { recursive: true });
  const out = createWriteStream(outPath);
  const rl = createInterface({ input: createReadStream(inPath), crlfDelay: Infinity });

  const stats = { lines: 0, operator: 0, assistant: 0, dropped: 0, synthetic: 0 };
  for await (const line of rl) {
    stats.lines++;
    let e; try { e = JSON.parse(line); } catch { continue; }

    if (e.type === 'user' && isRealOperatorTurn(e) && !e.isSidechain) {
      const text = wash(plainText(e.message.content));
      if (!text || isSynthetic(text)) { stats.dropped++; stats.synthetic += text ? 1 : 0; continue; }
      out.write(JSON.stringify({
        type: 'user', timestamp: e.timestamp, uuid: e.uuid,
        message: { role: 'user', content: text },
      }) + '\n');
      stats.operator++;
    } else if (e.type === 'assistant') {
      const text = wash(plainText(e.message?.content));
      if (!text) { stats.dropped++; continue; }
      out.write(JSON.stringify({
        type: 'assistant', timestamp: e.timestamp, uuid: e.uuid,
        message: { role: 'assistant', content: text.slice(0, digest) },
      }) + '\n');
      stats.assistant++;
    } else {
      stats.dropped++;
    }
  }
  await new Promise((r) => out.end(r));
  stats.inBytes = statSync(inPath).size;
  stats.outBytes = statSync(outPath).size;
  return stats;
}

if (process.argv[1] && import.meta.url.endsWith(basename(process.argv[1]))) {
  const [inPath, outPath] = process.argv.slice(2);
  if (!inPath || !outPath) { console.error('usage: wash-transcript.mjs <in.jsonl> <out.jsonl>'); process.exit(1); }
  const s = await washFile(inPath, outPath);
  const mb = (n) => (n / 1048576).toFixed(1) + ' MB';
  console.log(`[wash] ${basename(inPath)}: ${s.lines} lines -> ${s.operator} operator + ${s.assistant} assistant (${s.dropped} dropped, ${s.synthetic} harness-injected)`);
  console.log(`[wash] ${mb(s.inBytes)} -> ${mb(s.outBytes)}`);
}
