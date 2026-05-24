# ── Stage 1: build ──────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# instala dependências primeiro (cache-friendly)
COPY package.json package-lock.json ./
RUN npm ci --prefer-offline

# copia o resto e gera o bundle de produção
COPY . .
RUN npm run build:production

# ── Stage 2: imagem final ────────────────────────────────────────────────────
FROM jellyfin/jellyfin:latest

# substitui a UI padrão pela MundoZero
COPY --from=builder /app/dist/ /jellyfin/jellyfin-web/

LABEL org.opencontainers.image.title="MundoZero Jellyfin" \
      org.opencontainers.image.description="Jellyfin com interface MundoZero" \
      org.opencontainers.image.source="https://github.com/SEU_USER/mundozero-front"
