# syntax=docker/dockerfile:1.7
# Multi-stage build for Nest of Fastify/Node apps in the monorepo.
# Build: docker build -f docker/Dockerfile.app --build-arg APP_NAME=api --build-arg APP_PORT=3001 .
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
ARG APP_NAME
RUN pnpm --filter @csm/contracts build \
 && pnpm --filter @csm/observability build \
 && pnpm --filter @csm/domain build \
 && pnpm --filter @csm/database generate \
 && pnpm --filter @csm/database exec tsc -p tsconfig.build.json \
 && pnpm --filter @csm/bank-client build \
 && pnpm --filter @csm/brokerage-client build \
 && pnpm --filter @csm/temporal-workflows build \
 && pnpm --filter @csm/temporal-activities build \
 && pnpm --filter @csm/${APP_NAME} build

FROM ${NODE_IMAGE} AS runner
ARG APP_NAME
ARG APP_PORT=3000
WORKDIR /app
ENV NODE_ENV=production
ENV APP_NAME=${APP_NAME}
RUN addgroup -S csm && adduser -S csm -G csm \
 && corepack enable && corepack prepare pnpm@10.33.4 --activate
COPY --from=build /app /app
USER csm
EXPOSE ${APP_PORT}
CMD ["sh", "-c", "node apps/${APP_NAME}/dist/main.js"]
