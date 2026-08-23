# Implementation Notes

The approved high-level plan is tracked in the planning session. This document
records the first technical decision made during implementation.

## Default local embeddings

Use llama.cpp with the pinned `Qwen3-Embedding-0.6B-Q8_0.gguf` artifact as the
initial local baseline. It is Apache-2.0 licensed, has a small local footprint,
and exposes an OpenAI-compatible embeddings API. The choice is deliberately
replaceable.

Before treating a model as a release default, benchmark it on representative
product documents and questions. Measure Recall@5, MRR, indexing throughput,
query latency, RAM usage, image size, and cold-start time on CPU-only hardware.

Do not mix embeddings from different models in the same index. Reindex all
chunks when changing the configured model or vector dimension.
