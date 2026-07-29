# Implementation Notes

The approved high-level plan is tracked in the planning session. This document
records the first technical decision made during implementation.

## Default local embeddings

Use Ollama with `qwen3-embedding:0.6b` as the initial local baseline. It is
Apache-2.0 licensed, has a small local footprint, and exposes an
OpenAI-compatible embeddings API. The choice is deliberately replaceable.

Before treating a model as a release default, benchmark it on representative
product documents and questions. Measure Recall@5, MRR, indexing throughput,
query latency, RAM usage, image size, and cold-start time on CPU-only hardware.

**Partly done.** `bench/run.ts` (`pnpm bench`) scores Recall@5 and MRR against a
hand-written gold set in `bench/questions.json`, reports indexing throughput in
chunks/sec and query latency at p50 and p95, and prints the model and query-hint
settings alongside them so a number can never be read without knowing what
produced it. It seeds its own `benchmark` workspace from `bench/corpus/` — frozen
copies of this repo's own docs, taken so that editing a doc cannot move the
numbers underneath a comparison — and never touches a live workspace. Misses are
named rather than counted, because a miss is a question to read: either the
retrieval is wrong or the gold label is, and only looking tells you which.

Sentence-style and keyword-style questions are scored on separate lines. A change
that lifts one and sinks the other has to be visible as that, rather than
averaging into "no effect" — which is exactly what happened when the lexical arm
moved to OR semantics.

**Still missing, and still gating the word "default":** RAM, image size, and
CPU cold-start. And the harness has only ever been pointed at one model. It takes
`EMBEDDING_MODEL` from the environment, so a comparison is a config change away,
but none has been run — so what exists measures *the pipeline*, not *the choice of
model*. The corpus is also this project's own documentation, 32 questions over
five files, which is enough to catch a regression and nowhere near enough to
characterise a model.

Do not mix embeddings from different models in the same index. Reindex all
chunks when changing the configured model or vector dimension.
