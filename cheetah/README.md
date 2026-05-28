# cheetah/ — CheetahAdvanced

Sibling bot to Hathor on the MELEK chain. **Credit-first, discovery-first librarian.** Not the punitive 2017-era Steem Cheetah. See `../CHEETAH_ADVANCED.md` for the full spec; this module is the implementation of build order steps 1-3 (Phase 2 deterministic — no LLM in the detection path).

## What's here vs what's coming

Step 1 — **text detection** (this module). Match a post body against prior on-chain posts and (eventually) web search. Returns `{match, source, confidence}`. Deterministic similarity (shingle-hash + Jaccard), not generative.

Step 2 — **comment compose** (this module). Crediting-note / discovery-note templates with the self-ID footer. Template pool, deterministic pick from `sha256(account+post_id) % N` per the welcomer pattern.

Step 3 — **shared store** (this module). Evidenced whitelist/blacklist + findings log. JSON-backed. Hathor reads from this when handling resolution conversations.

Steps 4-6 (resolution flow / discovery mode / image detection) are **NOT** in this module — they gate on Phase 3 / external services.

## Module layout

| file | purpose |
|---|---|
| `text-detection.js` | shingle / Jaccard similarity; pluggable on-chain + web search backends |
| `compose.js` | template-based comment generation (crediting / discovery / footer) |
| `store.js` | evidenced whitelist/blacklist + findings log; file-backed |
| `config.js` | env loading + tuning knobs (similarity threshold, frequency cap) |
| `index.js` | orchestrator + CLI (`--dry-run`, `--scan-recent`) |
| `*.test.js` | tests (currently for text-detection + compose) |

## Design constraints (from CHEETAH_ADVANCED.md)

- **State facts, not accusations.** Cheetah says "this also appears here: [link]" — never "this is plagiarized." Intent is resolved by Hathor in conversation, not by Cheetah.
- **Credit first, escalate last.** First contact is friendly + crediting + self-ID footer. Enforcement only after repeated pass-off and the Hathor-resolution path.
- **Detection is not an LLM.** Generative models hallucinate sources. Detection here is similarity-matching (shingle-hash + Jaccard). LLMs may write the friendly comment AFTER a match is found.
- **Always link the source.** Whether crediting outward or surfacing similar internal content, the URL is the point.
- **Self-identify on every comment.** Footer with what Cheetah is, why it commented, opt-out link.
- **Earn unsolicited appearances.** Relevance threshold + frequency cap + per-author opt-out. (Bot-culture norm; the reason WikiTextBot eventually got rate-limited.)
- **Discovery biases inward.** "Similar content" should point to other MELEK creators when possible; attribution points outward.

## Voice (lifted from spec §6)

> Cheetah: quick, factual, linky, frequent-ish. The librarian who points you to the right shelf. Short comments, always with source link + self-ID footer.
>
> Hathor: the conversational one — resolution conversations, teaching, the relationship map. People should never be confused about which they're talking to.

## Status

Built 2026-05-28 — operator priority after the Hathor-on-Discord brief queue.

- ✅ text-detection.js — shingle + Jaccard core; stubs for chain query + web search
- ✅ compose.js — crediting + discovery + footer templates
- ✅ store.js — evidenced whitelist/blacklist with reasoned entries
- ✅ config.js — tunable knobs
- ⏳ index.js — orchestrator (next)
- ⏳ live wiring to Hathor chain client (gated on MELEK chain RPC values landing)
- ⏳ web search backend selection (Google Custom Search / Serper / DDG — operator decision)
- ⏳ Hathor's resolution flow (Phase 3 work)
