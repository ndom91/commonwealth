ARG LLAMA_CPP_IMAGE=ghcr.io/ggml-org/llama.cpp:server@sha256:100de626bdc5b7df898c12561eefaf557019d2746d5fc8d3f4d7fd24e15ad384
FROM ${LLAMA_CPP_IMAGE}

COPY entrypoint.sh /usr/local/bin/commonwealth-inference
RUN chmod 755 /usr/local/bin/commonwealth-inference

ENTRYPOINT ["/usr/local/bin/commonwealth-inference"]
