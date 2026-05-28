# datasets/ — the resident AI's brain

Operator framing 2026-05-28: "This is going to be their Brain... add AI and Coding information... and that kind of like, becoming a Machine Learning System."

The resident AI (Server A, qwen2.5-coder:1.5b) and the tiny-LLM (tiny-LLM-host, smollm2:360m) consult these datasets when composing briefs and annals. The indexer (`infra/oracle-vm/indexer/`) embeds every markdown file here into Qdrant with priority weighting; the AIs retrieve relevant chunks per query.

## Sources currently staged

| path | source | license | role |
|---|---|---|---|
| `cookbooks/anthropic/` | github.com/anthropics/anthropic-cookbook | MIT | Claude API patterns — tool use, structured output, prompt engineering |
| `cookbooks/openai/` | github.com/openai/openai-cookbook | MIT | LLM patterns generally — embeddings, RAG, agents |
| `cookbooks/langchain/` | github.com/langchain-ai/langchain (docs subset) | MIT | Agent / retrieval / tool patterns; vector store + retriever idioms |
| `chain-libs/dhive/` | github.com/openhive-network/dhive | Apache 2.0 | The chain client this Bot uses (`@hiveio/dhive`) — API surface |
| `hive-devportal/` | gitlab.syncad.com/hive/devportal | MIT | **Most directly relevant to the Bot.** Hive (Graphene-family) JavaScript/PHP tutorials, glossary, node-op docs. Same family as MELEK. |
| `oilahuasca_knowledge.jsonl` | operator | private | Operator's prior knowledge dump |
| `vkbt_cure_knowledge.jsonl` | operator | private | Operator's prior knowledge dump |

## License posture

Everything fetched from third-party repos is openly licensed (MIT or Apache 2.0) and attributable. NO commercial cookbooks (O'Reilly, Manning, Packt etc.) are included, regardless of how findable they may be online. Operator's "if You can find them Online" did NOT override the license boundary — the project doesn't need a copyright headache.

If operator wants additional content:

- **Markdown / source repos with clear OSS licenses** — same approach, parallel `git clone --depth 1` + rsync filter to `.md`/`.mdx`.
- **PDFs operator owns or has license to** — drop them in `datasets/` directly; the indexer doesn't parse PDFs today but could be extended.
- **Operator-authored research papers (Heterosis, Mythology-as-Genealogy etc.)** — drop into `datasets/operator-research/`. These are operator's own work; no licensing concern.

## Format note (JSON vs Markdown)

Operator's instruction included "in JSON form." The cookbooks landed as markdown because that's how the source repos publish them. The indexer treats both equivalently (chunks the text, embeds, stores) — markdown is fine for retrieval.

If a structured JSONL format is wanted later (e.g. `{title, url, content}` per page) we can do a conversion pass — it'd be useful for the tiny-LLM if we want to feed it pre-formatted Q&A pairs for fine-tuning eventually. Not blocking for now.

## How the AIs find this

The indexer scope (after 2026-05-28 expansion) is SKIP-list based — `datasets/` is included by default. Every file here gets embedded. The brief generator's retrieval (`infra/oracle-vm/briefd/retrieval.js`) and the tiny-LLM's annal-writer (`infra/tiny-LLM-host/annal-writer-tiny.py`) can both pull from this corpus.

The per-file archive (`<DATA_DIR>/archive/files/<flat>.json` on Server A) tracks deep-inspection of every indexed file including these — so over time the AIs build a catalog of what's where in `datasets/`.
