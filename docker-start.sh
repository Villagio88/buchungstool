#!/bin/sh
# Beim allerersten Start die leere Vorlage an ihren Platz im Datenvolume legen.
# Eine vorhandene Datenbank wird nie ersetzt: Buchungen sollen jeden Neustart und
# jedes neue Abbild überleben.
set -e
if [ ! -f /data/buchung.db ]; then
  echo "[start] lege neue Datenbank aus der Vorlage an"
  cp /app/prisma/vorlage.db /data/buchung.db
fi

# Fehlende Spalten nachziehen. Idempotent, ergänzt nur und entfernt nie.
node /app/scripts/migrate.mjs

exec node server.js
