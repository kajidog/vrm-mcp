FROM node:22-slim AS base

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

RUN corepack enable && corepack prepare pnpm@10.29.3 --activate

WORKDIR /app

FROM base AS deps

COPY pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/mcp-vrm-player/package.json apps/mcp-vrm-player/package.json
COPY apps/web-auth/package.json apps/web-auth/package.json
COPY packages/mcp-core/package.json packages/mcp-core/package.json
COPY packages/player-ui/package.json packages/player-ui/package.json
COPY packages/tts-client/package.json packages/tts-client/package.json

RUN pnpm install --frozen-lockfile --ignore-scripts

FROM deps AS dev

COPY . .

FROM deps AS build

COPY . .

RUN pnpm --filter @kajidog/player-ui build
RUN pnpm --filter @kajidog/mcp-core build
RUN pnpm --filter @kajidog/tts-client build
RUN pnpm --filter @kajidog/mcp-vrm-player build

FROM base AS runtime

ENV NODE_ENV=production
ENV MCP_HTTP_MODE=true
ENV MCP_HTTP_HOST=0.0.0.0
ENV MCP_HTTP_PORT=3000
ENV TTS_PLAYER_CACHE_DIR=/data/cache
ENV TTS_PLAYER_EXPORT_DIR=/data/exports

COPY pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/mcp-vrm-player/package.json apps/mcp-vrm-player/package.json
COPY apps/web-auth/package.json apps/web-auth/package.json
COPY packages/mcp-core/package.json packages/mcp-core/package.json
COPY packages/player-ui/package.json packages/player-ui/package.json
COPY packages/tts-client/package.json packages/tts-client/package.json

RUN pnpm install --prod --frozen-lockfile --ignore-scripts --filter @kajidog/mcp-vrm-player...

COPY --from=build /app/apps/mcp-vrm-player/dist apps/mcp-vrm-player/dist
COPY --from=build /app/packages/tts-client/dist packages/tts-client/dist

RUN mkdir -p /data/cache /data/exports && chown -R node:node /data

USER node

EXPOSE 3000

CMD ["node", "apps/mcp-vrm-player/dist/index.js"]
