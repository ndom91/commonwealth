FROM node:24-alpine AS dependencies
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY admin/package.json admin/package.json
# Manifest only — admin depends on the pipeline with `workspace:*`, which
# `--frozen-lockfile` must be able to resolve before any source is present.
COPY packages/pipeline/package.json packages/pipeline/package.json
COPY packages/corpus/package.json packages/corpus/package.json
RUN corepack enable && pnpm install --frozen-lockfile

FROM node:24-alpine AS build
WORKDIR /app
COPY --from=dependencies /app/node_modules ./node_modules
COPY --from=dependencies /app/admin/node_modules ./admin/node_modules
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# The package exports TypeScript source, so Vite needs the real files here to
# bundle them into .output — the manifest copied in the previous stage is not
# enough to build against.
COPY packages ./packages
COPY admin ./admin
RUN corepack enable && pnpm --filter @commonwealth/admin build

FROM node:24-alpine
WORKDIR /app
RUN apk add --no-cache git
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/admin ./admin
# Vite bundles the pipeline into .output, so nothing at runtime imports it — but
# node_modules carries a symlink to it, and a dangling one is a trap for the
# next person who runs a script in this image.
COPY --from=build /app/packages ./packages
# The workspace manifests let `pnpm migrate` resolve inside the image, so the
# container and a developer's shell run the same script rather than two
# separately maintained invocations.
COPY package.json pnpm-workspace.yaml ./
RUN corepack enable
CMD ["node", "admin/.output/server/index.mjs"]
