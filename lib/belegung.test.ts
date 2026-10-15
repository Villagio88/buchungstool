import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { unlinkSync, existsSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { einheitenVon } from "./buchung";

/**
 * Prüft die Sperre gegen überlappende Buchungen an einer echten Datenbank.
 *
 * Seit die Dauer frei wählbar ist, reicht ein eindeutiger Index auf dem
 * Startzeitpunkt nicht mehr. Die Sperre hängt an den Fünf-Minuten-Einheiten,
 * und ob die wirklich greift, zeigt nur die Datenbank selbst.
 */

const DB_PFAD = "/tmp/buchung-test.db";
let db: PrismaClient;

before(() => {
  if (existsSync(DB_PFAD)) unlinkSync(DB_PFAD);
  execSync("npx prisma db push --skip-generate --accept-data-loss", {
    env: { ...process.env, DATABASE_URL: `file:${DB_PFAD}` },
    stdio: "pipe",
  });
  db = new PrismaClient({ datasources: { db: { url: `file:${DB_PFAD}` } } });
});

after(async () => {
  await db.$disconnect();
});

async function anlegen(start: Date, minuten: number) {
  const ende = new Date(start.getTime() + minuten * 60_000);
  return db.$transaction(async (tx) => {
    const b = await tx.buchung.create({
      data: {
        start,
        ende,
        minuten,
        bereich: "beratung",
        name: "Test",
        email: "test@example.com",
      },
      select: { id: true },
    });
    await tx.belegung.createMany({
      data: einheitenVon(start, ende).map((einheit) => ({ einheit, buchungId: b.id })),
    });
    return b.id;
  });
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

test("eine Buchung lässt sich anlegen", async () => {
  const id = await anlegen(T(10), 60);
  assert.ok(id);
  assert.equal(await db.buchung.count(), 1);
});

test("eine überlappende Buchung wird abgewiesen und hinterlässt nichts", async () => {
  // 10:00 bis 11:00 steht bereits. 10:30 bis 11:30 überlappt um 30 Minuten,
  // hat aber einen anderen Startzeitpunkt: genau der Fall, den ein Index auf
  // `start` durchgelassen hätte.
  await assert.rejects(() => anlegen(T(10, 30), 60));
  assert.equal(await db.buchung.count(), 1, "die abgewiesene Buchung darf keine Zeile hinterlassen");
});

test("eine Buchung, die genau anschliesst, wird angenommen", async () => {
  const id = await anlegen(T(11), 30);
  assert.ok(id);
  assert.equal(await db.buchung.count(), 2);
});

test("auch eine Überlappung von nur fünf Minuten wird erkannt", async () => {
  // 11:00 bis 11:30 steht. 11:25 bis 11:55 überlappt um fünf Minuten.
  await assert.rejects(() => anlegen(T(11, 25), 30));
  assert.equal(await db.buchung.count(), 2);
});

test("eine Buchung, die eine bestehende vollständig umschliesst, wird abgewiesen", async () => {
  await assert.rejects(() => anlegen(T(9), 240));
  assert.equal(await db.buchung.count(), 2);
});

test("zwei gleichzeitige Anfragen auf denselben Slot: nur eine gewinnt", async () => {
  const ergebnisse = await Promise.allSettled([anlegen(T(14), 60), anlegen(T(14), 60)]);
  const erfolge = ergebnisse.filter((r) => r.status === "fulfilled").length;
  assert.equal(erfolge, 1, "genau eine der beiden gleichzeitigen Buchungen darf durchkommen");
});
