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
ENV NEXT_TELEMETRY_DISABLED=1
ARG NEXT_PUBLIC_API_BASE_URL=http://localhost:3001
ENV NEXT_PUBLIC_API_BASE_URL=${NEXT_PUBLIC_API_BASE_URL}
RUN pnpm --filter @csm/contracts build \
 && pnpm --filter @csm/observability build \
 && pnpm --filter @csm/web build

FROM ${NODE_IMAGE} AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
RUN addgroup -S csm && adduser -S csm -G csm \
 && corepack enable && corepack prepare pnpm@10.33.4 --activate
COPY --from=build /app /app
USER csm
EXPOSE 3000
CMD ["pnpm", "--filter", "@csm/web", "start"]
