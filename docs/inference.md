# Local inference

The Compose `inference` service runs llama.cpp's OpenAI-compatible embedding API.
It downloads the configured GGUF model into the `embedding_models` volume before
starting, verifies `MODEL_SHA256` on every start, and only then becomes healthy.
Set `MODEL_URL`, `MODEL_SHA256`, `MODEL_FILE`, and `MODEL_POOLING` together when
replacing the model. `EMBEDDING_MODEL` is the immutable index identity and must
change too.

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
run llama.cpp natively with the same model identity and pooling mode:

```sh
llama-server \
  --model /path/to/Qwen3-Embedding-0.6B-Q8_0.gguf \
  --alias qwen3-embedding-0.6b-q8_0-370f27d \
  --embedding \
  --pooling last \
  --host 0.0.0.0 \
  --port 8080
```

Set `EMBEDDING_URL=http://localhost:8080` for host processes and
`COMPOSE_EMBEDDING_URL=http://host.docker.internal:8080` for containers. Start
Postgres and migrations normally, then omit Compose dependencies so it does not
start the CPU inference container:

```sh
docker compose up -d postgres web-migrate
docker compose up -d --no-deps app web
```
