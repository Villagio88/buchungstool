# syntax=docker/dockerfile:1.7
# Node 24 bringt node:sqlite mit; weitere native Module braucht es nicht.
FROM node:24-bookworm-slim AS base

# --- Abhängigkeiten ---
FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# --- Bauen ---
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# --- Laufzeit ---
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    DATENBANK_PFAD=/data/buchung.db
# Der Code gehört root und ist für node nur lesbar; schreiben darf node nur in
# den Zwischenspeicher von Next.js und ins Datenverzeichnis.
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
COPY docker-start.sh ./docker-start.sh
RUN mkdir -p /data .next/cache && chown node:node /data .next/cache && chmod 755 ./docker-start.sh
VOLUME ["/data"]
EXPOSE 3000
# Der erste Abruf der Kalender kann einige Sekunden dauern, daher der grosszügige
# Zeitrahmen.
HEALTHCHECK --interval=60s --timeout=30s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/gesund').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# Startet als root, übergibt /data an node und läuft dann als node weiter.
CMD ["./docker-start.sh"]
