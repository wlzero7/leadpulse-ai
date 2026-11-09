# ========================================================
# LeadPulse AI — Multi-Stage Production Dockerfile
# Node.js 24 Runtime otimizado para Render / Cloud Run
# ========================================================

# --- Estágio 1: Build da Aplicação ---
FROM node:24-alpine AS builder

WORKDIR /app

# Ferramentas de compilação para módulos nativos (como argon2)
RUN apk add --no-cache libc6-compat python3 make g++

RUN npm install --global pnpm@11.25.0

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json ./
RUN pnpm install --frozen-lockfile --prod=false

COPY . .
RUN pnpm run build

# --- Estágio 2: Imagem Leve de Execução ---
FROM node:24-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV TURSO_DATABASE_URL=file:/app/data/local.db

# Execução segura sob usuário não-root
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 --ingroup nodejs leadpulse && \
    mkdir /app/data && chown leadpulse:nodejs /app/data

# Copia apenas os artefatos compilados, assets públicos e dependências necessárias
COPY --from=builder --chown=leadpulse:nodejs /app/dist ./dist
COPY --from=builder --chown=leadpulse:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=leadpulse:nodejs /app/public ./public
COPY --from=builder --chown=leadpulse:nodejs /app/db ./db
COPY --from=builder --chown=leadpulse:nodejs /app/package.json ./package.json

USER leadpulse

EXPOSE 3000

CMD ["node", "dist/server.js"]
