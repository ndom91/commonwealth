FROM node:24-alpine AS dependencies
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY admin/package.json admin/package.json
RUN corepack enable && pnpm install --frozen-lockfile

FROM node:24-alpine AS build
WORKDIR /app
COPY --from=dependencies /app/node_modules ./node_modules
COPY --from=dependencies /app/admin/node_modules ./admin/node_modules
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY admin ./admin
RUN corepack enable && pnpm --filter @llm-team-kb/admin build

FROM node:24-alpine
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/admin ./admin
RUN corepack enable
CMD ["node", "admin/.output/server/index.mjs"]
