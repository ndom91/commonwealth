FROM node:24-alpine AS dependencies
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY mcp-server/package.json mcp-server/package.json
COPY web/package.json web/package.json
# The MCP server depends on shared workspace packages. Copying manifests first
# keeps the install layer cached when implementation source changes.
COPY packages/pipeline/package.json packages/pipeline/package.json
COPY packages/corpus/package.json packages/corpus/package.json
RUN corepack enable && pnpm install --frozen-lockfile

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
RUN apk add --no-cache git
RUN corepack enable
COPY --from=dependencies /app/node_modules ./node_modules
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json ./
COPY mcp-server/package.json mcp-server/package.json
COPY mcp-server/tsconfig.json mcp-server/tsconfig.json
COPY web/package.json web/package.json
COPY mcp-server/db ./mcp-server/db
# node_modules/@commonwealth/pipeline is a symlink to ../../packages/pipeline, so
# the target has to exist at the same relative path or the import dangles.
COPY packages ./packages
COPY mcp-server/src ./mcp-server/src
CMD ["pnpm", "--filter", "@commonwealth/mcp-server", "start"]
