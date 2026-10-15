/**
 * Ergänzt fehlende Spalten in der laufenden Datenbank.
 *
 * Das Abbild enthält kein Prisma-CLI (im standalone-Build fehlen dessen
 * Abhängigkeiten), und die Vorlage wird nur bei einer neuen Datenbank kopiert.
 * Ohne diesen Schritt hätte eine bestehende Datenbank nach einem Schemawechsel
 * fehlende Spalten, und das Buchen würde reihenweise scheitern.
 *
 * Bewusst nur ADD COLUMN: nichts wird umbenannt, nichts entfernt, nichts
 * überschrieben. Zweimal laufen lassen ändert nichts.
 */
import { PrismaClient } from "@prisma/client";

const NEUE_SPALTEN = [
  { tabelle: "Buchung", spalte: "token", typ: "TEXT" },
  { tabelle: "Buchung", spalte: "storniert", typ: "DATETIME" },
  { tabelle: "Buchung", spalte: "storniertVon", typ: "TEXT" },
  { tabelle: "Buchung", spalte: "ort", typ: "TEXT" },
  { tabelle: "Buchung", spalte: "tokenInhaber", typ: "TEXT" },
];

const db = new PrismaClient();

try {
  for (const { tabelle, spalte, typ } of NEUE_SPALTEN) {
    const info = await db.$queryRawUnsafe(`PRAGMA table_info("${tabelle}")`);
    const vorhanden = info.some((s) => s.name === spalte);
    if (vorhanden) continue;
    await db.$executeRawUnsafe(`ALTER TABLE "${tabelle}" ADD COLUMN "${spalte}" ${typ}`);
    console.log(`[migrate] ${tabelle}.${spalte} ergänzt`);
  }

  // Der eindeutige Index auf token, falls er noch fehlt. Mehrere leere Werte
  // sind in SQLite erlaubt, Altbuchungen ohne Token stören also nicht.
  await db.$executeRawUnsafe(
    'CREATE UNIQUE INDEX IF NOT EXISTS "Buchung_token_key" ON "Buchung"("token")',
  );
  await db.$executeRawUnsafe(
    'CREATE UNIQUE INDEX IF NOT EXISTS "Buchung_tokenInhaber_key" ON "Buchung"("tokenInhaber")',
  );
} catch (e) {
  console.error("[migrate] fehlgeschlagen:", e);
  process.exit(1);
} finally {
  await db.$disconnect();
}
