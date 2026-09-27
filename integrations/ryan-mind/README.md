# ryan-mind — the operator's own material → Hathor's positions

`ryan-mind` turns the operator's dated writing, chats, emails and forum threads into **claims**. It
checks each new claim against the ones already stored (the "bounce"), writes every judgement to an
append-only **annal**, and rolls the annals up into per-category **position** documents. From those it
exports RAG rows, Hathor training pairs and eval candidates. The operator does not pick claims by hand.
All the reasoning happens inside the engine's data, not in a chat window. The engine records its own
results, so it can extend itself. It never makes a decision that belongs to the operator.

```
sources (dated) ──ingest──▶ claims.jsonl ──reconcile──▶ annals.jsonl + review_queue.jsonl
                                  │                            │
                         taxonomy.json (grows)         positions/<category>.json|.md
                                                               │
                                                  exports/ rag · train · eval-candidates
```

## Sources, in the order the mind learns them

| stage | kind | input | whose words count as his |
|---|---|---|---|
| 0 | `writing` | `.md` / `.json` papers. Demo layer: `knowledge/scripture`, `synthesis`, `vankush`, `ai_technology/angelic_lineages_phoenix_protocol_synthesis.json` | all of it |
| 1 | `chat` | Claude.ai export (`.zip` or `conversations.json`: `conversations[].chat_messages[] {sender, text, created_at}`) | `sender: "human"` only. The assistant side is skipped unless you pass `--include-assistant`, and even then it is never his |
| 2 | `email` | Gmail-shaped JSON: `{threads:[{id, messages:[{id, date\|internalDate, subject, from, body}]}]}` or `{messages:[…]}` | `from` ∈ `config.self_emails`. Quoted replies and signatures are stripped |
| 3 | `thread` | `{title, url, posts:[{author, date, body}]}` | `author` ∈ `config.self_handles` |

Emails are read **against the chats**. `ingest --kind email` is refused until a chat export has been
ingested (override with `--force`). During reconcile, an email claim is compared with chat-derived
claims first.

Every source is dated, and the record says how the date was found (`date_basis`): `metadata:date`,
`metadata:compiled`, `index:received_at` (the scripture `_index.json`), `git:first-add`, `mtime`, or
`explicit`. Chats, emails and posts carry the **exact timestamp** of each message in `claim.at`.
The mind orders claims by `at`, falling back to `date`.

## Data model

- **source** `{id, kind, date, date_basis, title, path, privacy: public|private, stage, author, content_hash}`
- **claim** `{id, text, quote (a verbatim span of the source), source_id, date, at, category, confidence, speaker, own, can_supersede, class, context, locator, extractor, correction_marker}`.
  Claim records are **immutable**. Status and class are *derived* from the annals and the operator's rulings.
  - `class` ∈ `position` (a held divergence from consensus) | `slip_candidate` (flagged for his review) | `neutral`
- **annal** `{ts, claim_a, claim_b, relation, reason, model, similarity?, rule?, consensus?, review_id?}`
  - `relation` ∈ `supports | refines | contradicts | supersedes | unrelated | self_corrected | diverges_from_consensus`
- **review item** (`review_queue.jsonl`) `{id, type: slip|inconsistency, claim_ids, said, elsewhere, tradition_says, question}`.
  An operator ruling is appended to the same file as a `{type:"decision", review_id, decision, keep}` row.

## The operator's rules (enforced in `reconcile.mjs`, covered by tests)

1. **Only the operator corrects the operator.** A later claim of his (from a writing, chat or email) can
   supersede an earlier claim of his. The annal records this as `self_corrected`. The earlier claim is
   kept, marked superseded, and linked to the claim that replaced it.
2. **Consensus and third parties never overwrite him.** A forum poster, the assistant side of a chat, or a
   checker can disagree with him. That disagreement is recorded as `contradicts` (`rule: external-never-supersedes`)
   or as context, and nothing about his claim changes.
3. **Original positions ≠ slips.**
   - An identification that tradition does not make is recorded as `diverges_from_consensus`, with the
     mainstream view stored alongside it as context. The claim becomes a `position`. Example: *Wadjet = Theia*,
     where tradition, after Herodotus, pairs Wadjet/Buto with Leto.
   - A simple fact stated differently from tradition is a **probable slip**, e.g. *Zeus born on Malta* where
     tradition says Crete. It only goes into `review_queue.jsonl`, phrased as "you said X here, Y elsewhere;
     tradition says Y". Nothing changes until he rules.
4. **Automatic self-correction needs correction wording.** The later claim must actually disagree with the
   earlier one *and* read as a correction ("correction", "I was wrong", "misidentified", "previously said"…),
   or `config.auto_self_correct` must be set to `"later"`. Any other contradiction between two of his own
   claims becomes an `inconsistency` review item.
5. **His ruling closes a review item.** Rulings are made with `review <id> --decide slip_confirmed|hold|keep|both [--keep <claim>]`.
   `keep` writes a `self_corrected` annal with `model: "operator"`.

## Checkers (`checker.mjs`)

A checker is a plug-in with the interface `{name, check(claim) → {ok, stance: agrees|differs|none, kind: fact|identification, mainstream[], tradition_says?, elsewhere?}}`.
`hierophantChecker()` is the default adapter over the Hierophant's own data:

- the pantheon modules (`knowledge/*-pantheon.mjs`) plus the interpretatio identifications (Herodotus etc.)
- a small, editable table of consensus facts
- `integrations/corpus-rag.mjs` retrieval over his own corpus, used to find where else he stated a fact the
  traditional way

Every input can be injected, so the tests run on fixtures.

## Models: local only

`adapters.mjs` provides two injectable seams: `llm(prompt) → string` and `embed(text) → number[]`.
The defaults are a **local** Ollama (`RYAN_MIND_OLLAMA_URL`, default `http://127.0.0.1:11434`;
`RYAN_MIND_MODEL`, default `llama3.2:1b`; `RYAN_MIND_EMBED_MODEL`, default `nomic-embed-text`).
A non-loopback / non-private URL is refused, so private material cannot reach an external API. Every
model step has a deterministic fallback:

- extraction: sentence split, then an assertion filter, then the keyword categoriser
- judging: lexical overlap plus genuine polarity/figure conflict. Rhetorical "not X but Y" is treated as an affirmation.
- positions: the top-ranked verbatim claims

A model's extracted quote is kept only if it appears **verbatim** in the chunk. A model's position summary
is kept only if it cites the claim ids it summarises.

## Categories are data

`taxonomy.json` is seeded from the corpus structure: the `knowledge/` folders,
`KNOWLEDGE_BASE_ARCHITECTURE.json` (descriptions + `primary_keywords_by_folder`) and `_library_catalog.json`
(per-folder keywords). After each ingest, `suggestCategories` proposes new categories from the proper nouns
and bigrams that uncategorised claims share across sources. The proposals are written with
`status: "proposed"` and logged to `taxonomy-log.jsonl`. Claims that now fit are re-assigned through
`recategorized.jsonl`, and the claim records themselves are never edited. The operator can rename, merge or
retire any category (`status: "retired"`) by editing the JSON.

## CLI

```
node integrations/ryan-mind/mind.mjs ingest <path...> [--kind writing|chat|email|thread] [--date D] [--privacy public|private] [--max N] [--force]
node integrations/ryan-mind/mind.mjs reconcile [--limit N] [--k N] [--embed] [--no-checker]
node integrations/ryan-mind/mind.mjs positions [--full]
node integrations/ryan-mind/mind.mjs export [--public-only]
node integrations/ryan-mind/mind.mjs review [<id> --decide slip_confirmed|hold|keep|both [--keep <claim-id>] [--note "..."]]
node integrations/ryan-mind/mind.mjs status
  common: --data DIR · --dry-run (writes nothing; prints what it would write) · --llm [--model M] [--ollama URL]
```

## Data dir: private, outside git

The data dir is taken from `--data`, then `RYAN_MIND_DIR` (on the server: a private path outside the checkout),
then `<repo>/.local/ryan-mind`. A data dir inside the repo but not under `.local/` is refused. Each export
row carries its source's `privacy`. `export --public-only` writes `*.public.jsonl` files that exclude
anything from a private source.

`config.json` in the data dir: `{"self_emails": [...], "self_handles": [...], "auto_self_correct": "marked"|"later"}`.

## Exports

- `rag.jsonl`: claims with derived status/class and full source citation, plus position rows.
- `train.jsonl`: chat-format pairs, weighted, with provenance. They cover verbatim operator quotes (active
  claims only, never superseded claims or open slip candidates), positions, his self-corrections ("has your
  view changed?") and held divergences ("tradition says X; I hold Y, deliberately").
- `eval-candidates.jsonl`: rows in the `integrations/hathor-eval` item shape
  `{id, question, ryan_answer, topic, lang, kind: "known", must_include, source, status: "pending-operator"}`.
  They are candidates until he confirms them.
- `review-open.jsonl`: the open review queue.

## Tests

`node --test integrations/ryan-mind/`. The tests are fully offline: the model adapters use a fake fetch,
the checker uses fixtures, and the stores are in-memory dry-run stores or temp dirs.
