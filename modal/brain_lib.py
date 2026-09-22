# brain_lib.py — PURE logic for the MELEK private brain (no modal / no vllm / no torch imports).
#
# WHY THIS FILE EXISTS SEPARATELY. app.py can only be imported where the `modal` and `vllm`
# packages are installed (i.e. on Modal, or a dev box with them). But the request/response
# contract, the bearer-auth check, message assembly, and the clamps are ordinary Python that the
# repo must be able to verify OFFLINE — the same house rule the .mjs stack lives by (injectable,
# no-network, soft-fail). So every decision that does NOT need a GPU lives here, and
# `smoke_test.py` exercises it with the stdlib alone. app.py imports from here; Modal mounts this
# module automatically because app.py imports it.
#
# This module is the single source of truth for the ENDPOINT CONTRACT. The .mjs `modal-client.mjs`
# (built separately) must match `parse_chat_request` / `shape_response` exactly. See README.md.
from __future__ import annotations

# ── model / infra defaults (overridable by env in app.py) ───────────────────────────────────────
DEFAULT_MODEL = "Qwen/Qwen2.5-7B-Instruct"
DEFAULT_GPU = "A10"            # 24 GB; a 7B in bf16 is ~15 GB with headroom for KV cache
DEFAULT_SCALEDOWN = 300        # seconds of silence before the GPU container dies (idle → $0)
DEFAULT_MAX_MODEL_LEN = 16384

# ── generation clamps (the endpoint and the batch both go through these) ─────────────────────────
MAX_TOKENS_CEILING = 4096
MAX_TOKENS_DEFAULT = 512
TEMPERATURE_DEFAULT = 0.7
MAX_MESSAGES = 64
MAX_CONTENT_CHARS = 60_000     # per-message guard so one caller can't wedge the context window

# ── the 2×/day batch schedule ────────────────────────────────────────────────────────────────────
# "before noon and before midnight" (operator spec). Fire 30 min ahead so the synthesis/grades are
# already written when the noon / midnight 12-and-12 assembles — same offset soapy.py uses.
# 11:30 and 23:30 America/Chicago.  crontab.guru: minute hour day month weekday
BATCH_CRON = "30 11,23 * * *"
BATCH_TZ = "America/Chicago"


def _clampi(v, lo, hi, default):
    try:
        n = int(v)
    except (TypeError, ValueError):
        return default
    return max(lo, min(hi, n))


def _clampf(v, lo, hi, default):
    try:
        n = float(v)
    except (TypeError, ValueError):
        return default
    return max(lo, min(hi, n))


def normalize_messages(messages, system=None):
    """Coerce arbitrary caller input into a clean [{role, content}] list the model can consume.

    - a leading `system` string (or a system message already in `messages`) becomes the first
      system turn;
    - only 'system' / 'user' / 'assistant' roles survive; anything else is treated as 'user';
    - empty-content turns are dropped; content is stringified and length-guarded.
    Never raises — bad input yields a best-effort list (possibly just the system turn).
    """
    out = []
    sys_text = "" if system is None else str(system).strip()
    if sys_text:
        out.append({"role": "system", "content": sys_text[:MAX_CONTENT_CHARS]})
    if isinstance(messages, list):
        for m in messages[:MAX_MESSAGES]:
            if not isinstance(m, dict):
                continue
            role = str(m.get("role", "user")).strip().lower()
            if role not in ("system", "user", "assistant"):
                role = "user"
            content = m.get("content", "")
            if content is None:
                continue
            content = str(content).strip()
            if not content:
                continue
            # a system turn inside messages is honoured; but avoid two systems in a row
            if role == "system" and out and out[0]["role"] == "system":
                out[0]["content"] = (out[0]["content"] + "\n\n" + content)[:MAX_CONTENT_CHARS]
                continue
            out.append({"role": role, "content": content[:MAX_CONTENT_CHARS]})
    return out


def parse_chat_request(payload):
    """The REQUEST half of the contract. Returns a dict the caller of the model can trust.

    Input  (JSON body): {messages: [{role, content}...], system?: str, max_tokens?: int,
                         temperature?: float, warmup?: bool}
    Output (validated) : {messages, max_tokens, temperature, warmup, ok, error}

    - `warmup: true` (or an empty messages list) is a legitimate request: it wakes the container so
      the first real message doesn't pay the cold start. It carries no generation.
    - Never raises; a malformed body comes back with ok=False + error and empty messages.
    """
    if not isinstance(payload, dict):
        return {"ok": False, "error": "body must be a JSON object", "messages": [],
                "max_tokens": MAX_TOKENS_DEFAULT, "temperature": TEMPERATURE_DEFAULT, "warmup": False}
    warmup = bool(payload.get("warmup", False))
    messages = normalize_messages(payload.get("messages"), payload.get("system"))
    max_tokens = _clampi(payload.get("max_tokens"), 1, MAX_TOKENS_CEILING, MAX_TOKENS_DEFAULT)
    temperature = _clampf(payload.get("temperature"), 0.0, 2.0, TEMPERATURE_DEFAULT)
    # a request with nothing to say (no user/assistant turn) is only valid as a warmup
    has_turn = any(m["role"] in ("user", "assistant") for m in messages)
    if not warmup and not has_turn:
        return {"ok": False, "error": "no user message", "messages": messages,
                "max_tokens": max_tokens, "temperature": temperature, "warmup": False}
    return {"ok": True, "error": "", "messages": messages,
            "max_tokens": max_tokens, "temperature": temperature, "warmup": warmup}


def shape_response(text, model=DEFAULT_MODEL, usage=None, warmup=False):
    """The RESPONSE half of the contract: {ok, text, model, warmup, usage}."""
    return {
        "ok": True,
        "text": "" if text is None else str(text),
        "model": model,
        "warmup": bool(warmup),
        "usage": usage or {},
    }


def error_response(message, code="error"):
    """Uniform error envelope. The endpoint returns this with an HTTP status; the client keys on ok."""
    return {"ok": False, "text": "", "error": str(message), "code": str(code)}


def bearer_from_header(authorization):
    """Extract the token from an 'Authorization: Bearer <t>' header value. '' if absent/malformed."""
    if not authorization:
        return ""
    s = str(authorization).strip()
    if s.lower().startswith("bearer "):
        return s[7:].strip()
    return ""


def check_bearer(presented, expected):
    """Constant-time-ish shared-bearer check.

    - if `expected` is empty (no token configured) the gate is OPEN — a local dev run needs no
      ceremony, exactly like soapy-conference.mjs's createServer();
    - otherwise the presented token must match exactly.
    `presented` may be a raw token or a full 'Bearer x' header value.
    """
    expected = "" if expected is None else str(expected)
    if not expected:
        return True
    tok = str(presented or "")
    if tok.lower().startswith("bearer "):
        tok = tok[7:].strip()
    if len(tok) != len(expected):
        return False
    mismatch = 0
    for a, b in zip(tok, expected):
        mismatch |= ord(a) ^ ord(b)
    return mismatch == 0
