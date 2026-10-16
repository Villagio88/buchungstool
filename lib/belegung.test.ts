import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Datenbank, UeberschneidungsFehler, type NeueBuchung } from "./db";
import { einheitenVon } from "./buchung";

/**
 * Prüft die Sperre gegen überlappende Buchungen an einer echten Datenbank.
 *
 * Seit die Dauer frei wählbar ist, reicht ein eindeutiger Index auf dem
 * Startzeitpunkt nicht mehr. Die Sperre hängt an den Fünf-Minuten-Einheiten,
 * und ob die wirklich greift, zeigt nur die Datenbank selbst.
 */

let db: Datenbank;
let zaehler = 0;

before(() => {
  db = new Datenbank(join(mkdtempSync(join(tmpdir(), "buchungstool-")), "test.db"));
});

after(() => {
  db.schliessen();
});

function daten(start: Date, minuten: number, email = "test@example.com"): NeueBuchung {
  zaehler += 1;
  return {
    start,
    ende: new Date(start.getTime() + minuten * 60_000),
    minuten,
    bereich: "beratung",
    name: "Test",
    email,
    anliegen: "Test",
    ort: "Online",
    ip: "192.0.2.1",
    token: `gast-${zaehler}`,
    tokenInhaber: `inhaber-${zaehler}`,
  };
}

function anlegen(start: Date, minuten: number): string {
  const b = daten(start, minuten);
  return db.anlegen(b, einheitenVon(b.start, b.ende));
}

const T = (h: number, m = 0) => new Date(2026, 8, 15, h, m, 0, 0);

test("einheitenVon deckt den Termin ab, ohne das Ende zu belegen", () => {
  const e = einheitenVon(T(10), T(10, 30));
  assert.equal(e.length, 6);
  assert.equal(e[0].getMinutes(), 0);
  assert.equal(e[5].getMinutes(), 25);
});

test("eine Dauer in Fünf-Minuten-Schritten ergibt genau so viele Einheiten", () => {
  assert.equal(einheitenVon(T(9), T(9, 25)).length, 5);
  assert.equal(einheitenVon(T(9), T(11)).length, 24);
});

test("eine Buchung lässt sich anlegen und wieder lesen", () => {
  const id = anlegen(T(10), 60);
  const b = db.lesen(id);
  assert.equal(b?.start.getTime(), T(10).getTime());
  assert.equal(b?.minuten, 60);
  assert.equal(db.anzahl(), 1);
});

test("eine überlappende Buchung wird abgewiesen und hinterlässt nichts", () => {
  // 10:00 bis 11:00 steht bereits. 10:30 bis 11:30 überlappt um 30 Minuten,
  // hat aber einen anderen Startzeitpunkt: genau der Fall, den ein Index auf
  // `start` durchgelassen hätte.
  assert.throws(() => anlegen(T(10, 30), 60), UeberschneidungsFehler);
  assert.equal(db.anzahl(), 1, "die abgewiesene Buchung darf keine Zeile hinterlassen");
});

test("eine Buchung, die genau anschliesst, wird angenommen", () => {
  assert.ok(anlegen(T(11), 30));
  assert.equal(db.anzahl(), 2);
});

test("auch eine Überlappung von nur fünf Minuten wird erkannt", () => {
  // 11:00 bis 11:30 steht. 11:25 bis 11:55 überlappt um fünf Minuten.
  assert.throws(() => anlegen(T(11, 25), 30), UeberschneidungsFehler);
  assert.equal(db.anzahl(), 2);
});

test("eine Buchung, die eine bestehende vollständig umschliesst, wird abgewiesen", () => {
  assert.throws(() => anlegen(T(9), 240), UeberschneidungsFehler);
  assert.equal(db.anzahl(), 2);
});

test("zwei Verbindungen auf dieselbe Datei: nur eine Buchung gewinnt", () => {
  // Zwei Prozesse oder Server-Instanzen teilen sich die Datei. Die Sperre muss
  // in der Datenbank greifen, nicht im Speicher eines Prozesses.
  const pfad = join(mkdtempSync(join(tmpdir(), "buchungstool-")), "zwei.db");
  const a = new Datenbank(pfad);
  const b = new Datenbank(pfad);
  const d = daten(T(14), 60);
  a.anlegen(d, einheitenVon(d.start, d.ende));
  const e = daten(T(14), 60);
  assert.throws(() => b.anlegen(e, einheitenVon(e.start, e.ende)), UeberschneidungsFehler);
  assert.equal(a.anzahl(), 1);
  a.schliessen();
  b.schliessen();
});

test("eine Absage gibt die Zeit wieder frei", () => {
  const id = anlegen(T(15), 30);
  assert.throws(() => anlegen(T(15), 30), UeberschneidungsFehler);
  db.stornieren(id, "inhaber");
  assert.equal(db.lesen(id)?.storniertVon, "inhaber");
  assert.ok(db.lesen(id)?.storniert);
  assert.ok(anlegen(T(15), 30), "nach der Absage ist die Zeit wieder buchbar");
  const imFenster = db.aktiveImFenster(T(14, 59), T(15, 31));
  assert.equal(imFenster.length, 1, "die abgesagte Buchung zählt nicht mehr");
});

test("die Missbrauchsgrenze zählt Buchungen je Adresse und IP", () => {
  const seit = new Date(Date.now() - 86_400_000);
  assert.ok(db.anzahlSeit("email", "test@example.com", seit) >= 3);
  assert.equal(db.anzahlSeit("email", "niemand@example.com", seit), 0);
  assert.ok(db.anzahlSeit("ip", "192.0.2.1", seit) >= 3);
});

test("das Aufräumen entfernt Personendaten nach Ablauf, die Zeile bleibt", () => {
  const vorher = db.anzahl();
  // Alle Testtermine liegen im September 2026. Ein Stichtag weit danach macht
  // sie alle «alt»; ipTage 0 und personenTage 30 greifen dann für alle.
  const ergebnis = db.aufraeumen(new Date(2027, 0, 1), 0, 30);
  assert.ok(ergebnis.personen >= 1);
  assert.equal(db.anzahl(), vorher, "Zeilen bleiben als anonymer Verlauf");
  const alle = db.aktiveImFenster(T(0), T(23));
  assert.ok(alle.length >= 1, "die Belegung bleibt erhalten");
  assert.equal(db.anzahlSeit("email", "test@example.com", new Date(0)), 0);
  assert.equal(db.anzahlSeit("ip", "192.0.2.1", new Date(0)), 0);
});

test("eine bestehende Datenbank der früheren Fassung wird ergänzt, nicht ersetzt", () => {
  const pfad = join(mkdtempSync(join(tmpdir(), "buchungstool-")), "alt.db");
  const roh = new DatabaseSync(pfad);
  roh.exec(`CREATE TABLE "Buchung" ("id" TEXT NOT NULL PRIMARY KEY, "start" DATETIME NOT NULL,
    "ende" DATETIME NOT NULL, "minuten" INTEGER NOT NULL, "bereich" TEXT NOT NULL,
    "name" TEXT NOT NULL, "email" TEXT NOT NULL, "anliegen" TEXT, "ip" TEXT,
    "erstellt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP);
    INSERT INTO "Buchung" VALUES ('alt', 1790577000000, 1790582400000, 90, 'beratung',
      'Alt', 'alt@example.com', 'x', NULL, 1789983961231);`);
  roh.close();
  const neu = new Datenbank(pfad);
  const b = neu.lesen("alt");
  assert.equal(b?.start.getTime(), 1790577000000);
  assert.equal(b?.token, null);
  assert.equal(b?.storniert, null);
  neu.schliessen();
});
