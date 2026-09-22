# syntax=docker/dockerfile:1
#
# Образ Numia (веб + BFF). Разворачивается где угодно, где есть Docker.
# Подробности запуска и переменных — docs/bff-deploy.md.
#
# Три стадии, чтобы в финальный образ не попали ни исходники, ни pnpm,
# ни dev-зависимости: наружу едет только .next/standalone.

FROM node:22-alpine AS base
# Next 16 требует Node >= 20.9. Берём 22 LTS.
RUN npm install -g pnpm@10 --no-fund --no-audit
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# ── Зависимости отдельным слоем: пересобирается только при правке лок-файла
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

# ── Сборка
FROM base AS builder

# NEXT_PUBLIC_* впекаются в браузерный бандл на этапе сборки — иначе никак,
# это требование Next. Поэтому образ привязан к конкретному проекту Supabase
# СО СТОРОНЫ ВЕБА. Маршруты BFF (/api/v1) читают SUPABASE_URL и
# SUPABASE_PUBLISHABLE_KEY в рантайме, им это ограничение не мешает.
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
ARG NEXT_PUBLIC_VAPID_PUBLIC_KEY
ARG APP_VERSION=dev
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=$NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY \
    NEXT_PUBLIC_VAPID_PUBLIC_KEY=$NEXT_PUBLIC_VAPID_PUBLIC_KEY

COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm build

# ── Рантайм
FROM node:22-alpine AS runner
WORKDIR /app

ARG APP_VERSION=dev
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    APP_VERSION=$APP_VERSION

# Не от root: если процесс скомпрометируют, у него не будет прав в контейнере.
RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001

# standalone уже содержит нужный срез node_modules и server.js.
# public и .next/static он не копирует сам — переносим руками
# (docs: 01-app/03-api-reference/05-config/01-next-config-js/output.md).
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

USER nextjs
EXPOSE 3000

# fetch есть в Node начиная с 18 — отдельный curl в образ тащить не нужно.
HEALTHCHECK --interval=30s --timeout=3s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
