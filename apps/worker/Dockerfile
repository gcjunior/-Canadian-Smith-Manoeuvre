# syntax=docker/dockerfile:1.7
ARG NODE_IMAGE=node:20.19.3-alpine3.21
FROM ${NODE_IMAGE} AS base
RUN corepack enable && corepack prepare pnpm@10.33.4 --activate
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages ./packages
COPY apps ./apps
COPY tsconfig.base.json tsconfig.json ./
RUN pnpm install --frozen-lockfile

FROM deps AS build
RUN pnpm --filter @csm/contracts build \
 && pnpm --filter @csm/observability build \
 && pnpm --filter @csm/domain build \
 && pnpm --filter @csm/database generate \
 && pnpm --filter @csm/database build \
 && pnpm --filter @csm/bank-client build \
 && pnpm --filter @csm/brokerage-client build \
 && pnpm --filter @csm/temporal-workflows build \
 && pnpm --filter @csm/temporal-activities build \
 && pnpm --filter @csm/worker build

FROM ${NODE_IMAGE} AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV HEALTH_PORT=3100
RUN addgroup -S csm && adduser -S csm -G csm \
 && corepack enable && corepack prepare pnpm@10.33.4 --activate
COPY --from=build /app /app
USER csm
EXPOSE 3100
CMD ["node", "apps/worker/dist/main.js"]
