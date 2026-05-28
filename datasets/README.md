# datasets/ — the resident AI's brain

Operator framing 2026-05-28: "This is going to be their Brain... add AI and Coding information... and that kind of like, becoming a Machine Learning System."

The resident AI (Server A, qwen2.5-coder:1.5b) and the tiny-LLM (tiny-LLM-host, smollm2:360m) consult these datasets when composing briefs and annals. The indexer (`infra/oracle-vm/indexer/`) embeds every markdown file here into Qdrant with priority weighting; the AIs retrieve relevant chunks per query.

## Sources currently staged

### Cookbooks + library docs
| path | source | license | role |
|---|---|---|---|
| `cookbooks/anthropic/` | github.com/anthropics/anthropic-cookbook | MIT | Claude API patterns — tool use, structured output, prompt engineering |
| `cookbooks/openai/` | github.com/openai/openai-cookbook | MIT | LLM patterns generally — embeddings, RAG, agents |
| `cookbooks/langchain/` | github.com/langchain-ai/langchain (docs subset) | MIT | Agent / retrieval / tool patterns; vector store + retriever idioms |
| `chain-libs/dhive/` | github.com/openhive-network/dhive | Apache 2.0 | The chain client this Bot uses (`@hiveio/dhive`) — API surface |
| `ml-libs/huggingface-transformers-docs-en/` | github.com/huggingface/transformers (`docs/source/en`) | Apache 2.0 | English Transformers library docs — tokenizers, models, training |
| `ml-libs/huggingface-blog/` | github.com/huggingface/blog | Apache 2.0 | HF blog posts — practical NLP / multimodal / RLHF / fine-tuning |

### Hive / MELEK chain
| path | source | license | role |
|---|---|---|---|
| `hive-devportal/` | gitlab.syncad.com/hive/devportal | MIT | **Most directly relevant to the Bot.** Hive (Graphene-family) JavaScript/PHP tutorials, glossary, node-op docs. Same family as MELEK. |

### Crypto protocols
| path | source | license | role |
|---|---|---|---|
| `crypto-protocols/eips/` | github.com/ethereum/EIPs | CC0 | All Ethereum Improvement Proposals — protocol spec corpus |
| `crypto-protocols/bips/` | github.com/bitcoin/bips | public domain (BIPs convention) | Bitcoin Improvement Proposals — protocol spec corpus |
| `crypto-protocols/lightning-bolts/` | github.com/lightning/bolts | CC-BY-4.0 | Lightning Network specifications (BOLT 1-11) |
| `crypto-protocols/devp2p/` | github.com/ethereum/devp2p | CC0 / MIT | Ethereum peer-to-peer protocol specs |
| `crypto-protocols/monero-research/` | github.com/monero-project/research-lab | various open | Monero / CryptoNote research papers |
| `crypto-protocols/cryptonote/` | github.com/cryptonotefoundation/cryptonote | various open | CryptoNote protocol reference (Bytecoin/Monero predecessor) |
| `crypto-protocols/forknote-generator/` | github.com/forknote/cryptonote-generator | MIT | Forknote (CryptoNote fork generator) |

### Crypto books (CC-BY-SA — full books)
| path | source | license | role |
|---|---|---|---|
| `crypto-books/mastering-bitcoin/` | github.com/bitcoinbook/bitcoinbook | CC-BY-SA-4.0 | Andreas Antonopoulos — Mastering Bitcoin (full text) |
| `crypto-books/mastering-ethereum/` | github.com/ethereumbook/ethereumbook | CC-BY-SA-4.0 | Antonopoulos + Wood — Mastering Ethereum (full text) |

### ML / AI courses
| path | source | license | role |
|---|---|---|---|
| `ml-courses/microsoft-ai-for-beginners/` | github.com/microsoft/AI-For-Beginners | MIT | 12-week intro AI curriculum (English only) |
| `ml-courses/microsoft-ml-for-beginners/` | github.com/microsoft/ML-For-Beginners | MIT | 12-week ML fundamentals curriculum (English only) |

### Operator private (gitignored — stay on the operator's machine + Server A)
| path | source | license | role |
|---|---|---|---|
| `oilahuasca_knowledge.jsonl` | operator | private | Operator's prior knowledge dump |
| `vkbt_cure_knowledge.jsonl` | operator | private | Operator's prior knowledge dump |

## Still to fetch / decide

- **BitcoinTalk threads** (Headless Bitcoin Thread, sidechain threads). Live-fetching a forum is doable but ToS-touchy. Better: snapshot specific threads to archive form. Operator framing 2026-05-28 suggests this is wanted; defer to a separate sweep.
- **Substack content** (operator's authors). Article-level IP per author; can't bulk-fetch. Operator would add specific articles they have rights to.
- **Operator's @marsresident / @punicwax Steem/Hive posts** — operator's own writing, fetch via Steem RPC. Defer to a separate pass.
- **Operator's published research papers** (Heterosis paper AJBSR, Mythology-as-Genealogy CAU) — operator's own. Defer until operator drops them in.
- **Forknote / Qora specifics** — Qora GitHub doesn't have an obvious canonical repo at the known URL. Need operator to confirm the source if they want this in.

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
