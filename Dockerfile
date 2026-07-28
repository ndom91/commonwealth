FROM node:24-alpine AS dependencies
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# The manifest alone, before the sources: the root depends on the pipeline with
# `workspace:*`, so `--frozen-lockfile` cannot resolve without it, and copying
# only the manifest keeps this layer cached when pipeline source changes.
COPY packages/pipeline/package.json packages/pipeline/package.json
RUN corepack enable && pnpm install --frozen-lockfile

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable
COPY --from=dependencies /app/node_modules ./node_modules
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json ./
COPY db ./db
# node_modules/@commonwealth/pipeline is a symlink to ../../packages/pipeline, so
# the target has to exist at the same relative path or the import dangles.
COPY packages ./packages
COPY src ./src
CMD ["pnpm", "start"]
