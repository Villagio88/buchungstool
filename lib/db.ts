import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

/**
 * Die Datenbank: eine SQLite-Datei über das in Node eingebaute `node:sqlite`.
 *
 * Bewusst ohne ORM. Es gibt zwei Tabellen und eine Handvoll Abfragen; ein ORM
 * brächte einen eigenen Migrationsweg, ein Kommandozeilenwerkzeug und eine lange
 * Kette von Abhängigkeiten ins Abbild, die gepflegt und auf Lücken geprüft
 * werden müssen.
 *
 * Zeitpunkte stehen als Millisekunden seit 1970 (UTC) in INTEGER-Spalten.
 * Tabellen- und Spaltennamen entsprechen dem früheren Prisma-Schema, damit eine
 * bestehende Datenbank ohne Umbau weiterläuft.
 */

const SCHEMA = `
CREATE TABLE IF NOT EXISTS "Buchung" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "start" INTEGER NOT NULL,
  "ende" INTEGER NOT NULL,
  "minuten" INTEGER NOT NULL,
  "bereich" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "anliegen" TEXT,
  "ip" TEXT,
  "erstellt" INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS "Buchung_start_idx" ON "Buchung"("start");
CREATE INDEX IF NOT EXISTS "Buchung_email_erstellt_idx" ON "Buchung"("email", "erstellt");
CREATE INDEX IF NOT EXISTS "Buchung_ip_erstellt_idx" ON "Buchung"("ip", "erstellt");

-- Jede angefangene Fünf-Minuten-Einheit einer Buchung. Das ist die eigentliche
-- Sperre gegen Überschneidungen: 10:00 bis 11:00 und 10:30 bis 11:30 haben
-- verschiedene Starts, kollidieren aber in den Einheiten. Weil "einheit" der
-- Primärschlüssel ist, lässt die Datenbank zwei überlappende Buchungen gar nicht
-- erst zu, auch nicht bei zwei gleichzeitigen Anfragen.
CREATE TABLE IF NOT EXISTS "Belegung" (
  "einheit" INTEGER NOT NULL PRIMARY KEY,
  "buchungId" TEXT NOT NULL REFERENCES "Buchung"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "Belegung_buchungId_idx" ON "Belegung"("buchungId");
`;

/**
 * Spalten, die nach der ersten Fassung dazugekommen sind. Nur ergänzen, nie
 * umbenennen oder entfernen: zweimal laufen lassen ändert nichts.
 */
const NACHTRAEGE: [spalte: string, typ: string][] = [
  ["token", "TEXT"],
  ["tokenInhaber", "TEXT"],
  ["storniert", "INTEGER"],
  ["storniertVon", "TEXT"],
  ["ort", "TEXT"],
];

export type BuchungsZeile = {
  id: string;
  start: Date;
  ende: Date;
  minuten: number;
  bereich: string;
  name: string;
  email: string;
  anliegen: string | null;
  ort: string | null;
  ip: string | null;
  erstellt: Date;
  token: string | null;
  tokenInhaber: string | null;
  storniert: Date | null;
  storniertVon: string | null;
};

type Roh = Record<string, unknown>;

function datum(wert: unknown): Date {
  return new Date(Number(wert));
}

function zeile(r: Roh): BuchungsZeile {
  return {
    id: String(r.id),
    start: datum(r.start),
    ende: datum(r.ende),
    minuten: Number(r.minuten),
    bereich: String(r.bereich),
    name: String(r.name),
    email: String(r.email),
    anliegen: (r.anliegen as string | null) ?? null,
    ort: (r.ort as string | null) ?? null,
    ip: (r.ip as string | null) ?? null,
    erstellt: datum(r.erstellt),
    token: (r.token as string | null) ?? null,
    tokenInhaber: (r.tokenInhaber as string | null) ?? null,
    storniert: r.storniert == null ? null : datum(r.storniert),
    storniertVon: (r.storniertVon as string | null) ?? null,
  };
}

export type NeueBuchung = {
  start: Date;
  ende: Date;
  minuten: number;
  bereich: string;
  name: string;
  email: string;
  anliegen: string | null;
  ort: string | null;
  ip: string | null;
  token: string;
  tokenInhaber: string;
};

/** Wird geworfen, wenn eine Einheit schon vergeben ist. */
export class UeberschneidungsFehler extends Error {
  constructor() {
    super("Die Zeit überschneidet sich mit einer bestehenden Buchung.");
  }
}

export class Datenbank {
  private readonly d: DatabaseSync;

  constructor(pfad: string) {
    if (pfad !== ":memory:") mkdirSync(dirname(pfad), { recursive: true });
    this.d = new DatabaseSync(pfad);
    // WAL erlaubt Lesen während eines Schreibvorgangs; busy_timeout lässt eine
    // zweite gleichzeitige Buchung kurz warten, statt sofort zu scheitern.
    this.d.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;");
    this.d.exec(SCHEMA);
    this.nachtragen();
  }

  private nachtragen(): void {
    const vorhanden = new Set(
      (this.d.prepare(`PRAGMA table_info("Buchung")`).all() as Roh[]).map((s) => String(s.name)),
    );
    for (const [spalte, typ] of NACHTRAEGE) {
      if (!vorhanden.has(spalte)) this.d.exec(`ALTER TABLE "Buchung" ADD COLUMN "${spalte}" ${typ}`);
    }
    this.d.exec(`CREATE UNIQUE INDEX IF NOT EXISTS "Buchung_token_key" ON "Buchung"("token")`);
    this.d.exec(
      `CREATE UNIQUE INDEX IF NOT EXISTS "Buchung_tokenInhaber_key" ON "Buchung"("tokenInhaber")`,
    );
  }

  /** Aktive Buchungen, die das Fenster berühren. */
  aktiveImFenster(von: Date, bis: Date): { start: Date; ende: Date }[] {
    const rows = this.d
      .prepare(
        `SELECT "start", "ende" FROM "Buchung"
         WHERE "ende" >= ? AND "start" <= ? AND "storniert" IS NULL`,
      )
      .all(von.getTime(), bis.getTime()) as Roh[];
    return rows.map((r) => ({ start: datum(r.start), ende: datum(r.ende) }));
  }

  /** Wie viele Buchungen seit `seit` von dieser Adresse beziehungsweise IP kamen. */
  anzahlSeit(feld: "email" | "ip", wert: string, seit: Date): number {
    const r = this.d
      .prepare(`SELECT COUNT(*) AS n FROM "Buchung" WHERE "${feld}" = ? AND "erstellt" >= ?`)
      .get(wert, seit.getTime()) as Roh;
    return Number(r.n);
  }

  /**
   * Legt eine Buchung samt Belegungseinheiten in einer Transaktion an.
   * Wirft UeberschneidungsFehler, wenn eine Einheit schon vergeben ist; dann
   * bleibt nichts zurück.
   */
  anlegen(b: NeueBuchung, einheiten: Date[]): string {
    const id = randomUUID();
    this.d.exec("BEGIN IMMEDIATE");
    try {
      this.d
        .prepare(
          `INSERT INTO "Buchung" ("id","start","ende","minuten","bereich","name","email",
            "anliegen","ort","ip","erstellt","token","tokenInhaber")
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .run(
          id, b.start.getTime(), b.ende.getTime(), b.minuten, b.bereich, b.name, b.email,
          b.anliegen, b.ort, b.ip, Date.now(), b.token, b.tokenInhaber,
        );
      const einfuegen = this.d.prepare(`INSERT INTO "Belegung" ("einheit","buchungId") VALUES (?,?)`);
      for (const e of einheiten) einfuegen.run(e.getTime(), id);
      this.d.exec("COMMIT");
      return id;
    } catch (e) {
      this.d.exec("ROLLBACK");
      if (e instanceof Error && /UNIQUE|PRIMARY KEY/i.test(e.message)) {
        throw new UeberschneidungsFehler();
      }
      throw e;
    }
  }

  lesen(id: string): BuchungsZeile | null {
    const r = this.d.prepare(`SELECT * FROM "Buchung" WHERE "id" = ?`).get(id) as Roh | undefined;
    return r ? zeile(r) : null;
  }

  /** Markiert eine Buchung als abgesagt und gibt ihre Einheiten frei. */
  stornieren(id: string, von: "gast" | "inhaber"): void {
    this.d.exec("BEGIN IMMEDIATE");
    try {
      this.d
        .prepare(`UPDATE "Buchung" SET "storniert" = ?, "storniertVon" = ? WHERE "id" = ?`)
        .run(Date.now(), von, id);
      this.d.prepare(`DELETE FROM "Belegung" WHERE "buchungId" = ?`).run(id);
      this.d.exec("COMMIT");
    } catch (e) {
      this.d.exec("ROLLBACK");
      throw e;
    }
  }

  /**
   * Datensparsamkeit: IP-Adressen werden nach `ipTage` Tagen entfernt, Name,
   * Mailadresse, Anliegen und Ort `personenTage` Tage nach dem Termin. Die Zeile
   * bleibt als anonymer Verlauf stehen, die Absage-Links werden ungültig.
   * Gibt die Zahl der bereinigten Einträge zurück.
   */
  aufraeumen(jetzt: Date, ipTage: number, personenTage: number): { ip: number; personen: number } {
    const tag = 86_400_000;
    const ip = this.d
      .prepare(`UPDATE "Buchung" SET "ip" = NULL WHERE "ip" IS NOT NULL AND "erstellt" < ?`)
      .run(jetzt.getTime() - ipTage * tag);
    const personen = this.d
      .prepare(
        `UPDATE "Buchung"
         SET "name" = '', "email" = '', "anliegen" = NULL, "ort" = NULL, "ip" = NULL,
             "token" = NULL, "tokenInhaber" = NULL
         WHERE "email" <> '' AND "ende" < ?`,
      )
      .run(jetzt.getTime() - personenTage * tag);
    return { ip: Number(ip.changes), personen: Number(personen.changes) };
  }

  anzahl(): number {
    return Number((this.d.prepare(`SELECT COUNT(*) AS n FROM "Buchung"`).get() as Roh).n);
  }

  schliessen(): void {
    this.d.close();
  }
}

/** Pfad aus DATENBANK_PFAD, ersatzweise aus dem früheren DATABASE_URL=file:... */
function standardPfad(): string {
  const direkt = process.env.DATENBANK_PFAD?.trim();
  if (direkt) return direkt;
  const url = process.env.DATABASE_URL?.trim();
  if (url?.startsWith("file:")) return url.slice("file:".length);
  return "./data/buchung.db";
}

/**
 * Eine einzige Verbindung je Prozess, erst beim ersten Gebrauch geöffnet. Im
 * Entwicklungsmodus am globalen Objekt gehalten, sonst öffnet jeder Hot-Reload
 * eine neue.
 */
const global_ = globalThis as unknown as { buchungDb?: Datenbank };

export function db(): Datenbank {
  global_.buchungDb ??= new Datenbank(standardPfad());
  return global_.buchungDb;
}
