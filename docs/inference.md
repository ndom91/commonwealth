# Local inference

The Compose `inference` service runs llama.cpp's OpenAI-compatible embedding API.
It downloads the configured GGUF model into the `embedding_models` volume before
starting, verifies `MODEL_SHA256` on every start, and only then becomes healthy.
Set `MODEL_URL`, `MODEL_SHA256`, and `MODEL_FILE` together when replacing the
model. `EMBEDDING_MODEL` is the immutable index identity and must change too.

Qwen3 Embedding uses `--pooling last`. Queries retain the configured
`EMBEDDING_QUERY_INSTRUCTION`; documents are embedded without a prefix.

## Platforms

CPU is the default and works on Linux `amd64` and `arm64`:

```sh
docker compose up --build
```

NVIDIA on Linux requires NVIDIA Container Toolkit. It uses llama.cpp's CUDA image
and offloads the complete embedding model:

```sh
docker compose -f compose.yaml -f compose.cuda.yaml up --build
```

AMD on Linux requires a host ROCm installation compatible with the image. It
passes `/dev/kfd` and `/dev/dri` to llama.cpp:

```sh
docker compose -f compose.yaml -f compose.rocm.yaml up --build
```

Apple Silicon Docker uses the portable Linux CPU image. For Metal acceleration,
run a native llama.cpp `llama-server` with the same GGUF, `--embedding`, and
`--pooling last`; configure host processes with its URL through `EMBEDDING_URL`.
Containers need a reachable host address such as Docker Desktop's
`host.docker.internal`.
