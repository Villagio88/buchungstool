# syntax=docker/dockerfile:1.7
FROM node:22-bookworm-slim AS base
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && apt-get clean

# --- Abhängigkeiten ---
FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci

# --- Bauen ---
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Das Schema wird hier auf eine leere Vorlage angewandt und diese ins Image
# gelegt. Zur Laufzeit braucht es damit kein Prisma-CLI mehr: im schlanken
# standalone-Image fehlen dessen Abhängigkeiten.
ENV DATABASE_URL="file:/app/prisma/vorlage.db"
RUN npx prisma generate && npx prisma db push --accept-data-loss --skip-generate
RUN npm run build

# --- Laufzeit ---
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
# Prisma-Client und Engine für SQLite zur Laufzeit
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder /app/prisma/vorlage.db ./prisma/vorlage.db
COPY --from=builder /app/scripts/migrate.mjs ./scripts/migrate.mjs
COPY docker-start.sh ./docker-start.sh
RUN chmod +x ./docker-start.sh
EXPOSE 3000
CMD ["./docker-start.sh"]
