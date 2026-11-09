# ========================================================
# LeadPulse AI — Multi-Stage Production Dockerfile
# Node.js 20+ Runtime otimizado para Render / Cloud Run
# ========================================================

# --- Estágio 1: Build da Aplicação ---
FROM node:20-alpine AS builder

WORKDIR /app

# Ferramentas de compilação para módulos nativos (como argon2)
RUN apk add --no-cache libc6-compat python3 make g++

COPY package.json tsconfig.json ./
RUN npm install

COPY . .
RUN npm run build

# --- Estágio 2: Imagem Leve de Execução ---
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=10000

# Execução segura sob usuário não-root
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 leadpulse

# Copia apenas os artefatos compilados, assets públicos e dependências necessárias
COPY --from=builder --chown=leadpulse:nodejs /app/dist ./dist
COPY --from=builder --chown=leadpulse:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=leadpulse:nodejs /app/public ./public
COPY --from=builder --chown=leadpulse:nodejs /app/db ./db
COPY --from=builder --chown=leadpulse:nodejs /app/package.json ./package.json

USER leadpulse

EXPOSE 10000

CMD ["node", "dist/server.js"]
