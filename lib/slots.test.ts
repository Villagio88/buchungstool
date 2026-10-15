import { test } from "node:test";
import assert from "node:assert/strict";
import {
  berechneSlots,
  istBuchbar,
  maxDauerAb,
  tagesStartzeiten,
  sperrenBilden,
  freieLuecken,
  type SlotOptionen,
} from "./slots";

/**
 * Tests der Verfügbarkeitsrechnung. Hier entstehen Doppelbuchungen, wenn etwas
 * falsch ist, deshalb ist jeder Fall einzeln geprüft.
 *
 * Alle Zeiten lokal (der Container läuft auf Europe/Zurich).
 */

const D = (s: string) => new Date(s);

const BASIS: SlotOptionen = {
  startRasterMinuten: 15,
  vorlaufStunden: 24,
  vorausTage: 42,
  arbeitstage: [1, 2, 3, 4, 5],
  vonUhr: "07:00",
  bisUhr: "18:00",
  anfrageVonUhr: "07:00",
  anfrageBisUhr: "18:00",
};

/** Bürozeit 07 bis 18 Uhr, dazu Randzeiten 06 bis 21 Uhr auf Anfrage. */
const MIT_RAND: SlotOptionen = { ...BASIS, anfrageVonUhr: "06:00", anfrageBisUhr: "21:00" };

// Montag, 7. September 2026. Der Jetzt-Zeitpunkt liegt weit davor, damit der
// Vorlauf in den Grundfällen nicht mitspielt.
const MONTAG = "2026-09-07";
const JETZT_FRUEH = D("2026-09-01T08:00:00");

/** Belegte Zeit mit Puffer, wie sie aus dem Kalender kommt. */
const belegt = (von: string, bis: string, puffer: number) => ({
  start: D(`${MONTAG}T${von}:00`),
  ende: D(`${MONTAG}T${bis}:00`),
  puffer,
});

const startzeiten = (slots: { start: Date }[]) =>
  slots.map((s) => `${String(s.start.getHours()).padStart(2, "0")}:${String(s.start.getMinutes()).padStart(2, "0")}`);

// --- Puffer je Kalender ---

test("nach einer internen Besprechung mit fünf Minuten Puffer geht es um 12:05 weiter", () => {
  const slots = berechneSlots({
    vonTag: MONTAG,
    bisTag: MONTAG,
    dauerMinuten: 30,
    belegt: [belegt("07:30", "12:00", 5)],
    jetzt: JETZT_FRUEH,
    optionen: BASIS,
  });
  assert.equal(startzeiten(slots)[0], "12:05", "die erste Zeit sitzt direkt hinter dem Puffer");
});

test("nach einem privaten Termin mit dreissig Minuten Puffer erst um 16:45", () => {
  const slots = berechneSlots({
    vonTag: MONTAG,
    bisTag: MONTAG,
    dauerMinuten: 30,
    belegt: [belegt("07:00", "16:15", 30)],
    jetzt: JETZT_FRUEH,
    optionen: BASIS,
  });
  assert.equal(startzeiten(slots)[0], "16:45");
});

test("die Startzeiten laufen ab der Lücke im Raster weiter, nicht ab Tagesbeginn", () => {
  const slots = berechneSlots({
    vonTag: MONTAG,
    bisTag: MONTAG,
    dauerMinuten: 30,
    belegt: [belegt("07:00", "16:15", 30)],
    jetzt: JETZT_FRUEH,
    optionen: BASIS,
  });
  // 16:45 als Lückenbeginn, danach im Viertelstundenraster bis 17:30
  assert.deepEqual(startzeiten(slots), ["16:45", "17:00", "17:15", "17:30"]);
});

test("verschiedene Puffer im selben Tag werden je Termin angewandt", () => {
  const slots = berechneSlots({
    vonTag: MONTAG,
    bisTag: MONTAG,
    dauerMinuten: 15,
    belegt: [belegt("07:00", "10:00", 5), belegt("11:00", "18:00", 30)],
    jetzt: JETZT_FRUEH,
    optionen: BASIS,
  });
  // Frei ist 10:05 (fünf Minuten nach dem ersten) bis 10:30 (dreissig vor dem
  // zweiten). Angeboten wird der Lückenbeginn 10:05 und die runde Zeit 10:15.
  assert.deepEqual(startzeiten(slots), ["10:05", "10:15"]);
});

// --- Sperren und Lücken ---

test("überlappende Sperren werden zusammengefasst", () => {
  const s = sperrenBilden([belegt("09:00", "10:00", 0), belegt("09:30", "11:00", 0)]);
  assert.equal(s.length, 1);
  assert.equal(s[0].start.getHours(), 9);
  assert.equal(s[0].ende.getHours(), 11);
});

test("der Puffer kann zwei getrennte Termine zu einer Sperre verschmelzen", () => {
  // 10:00 bis 10:30 und 11:00 bis 11:30, je 30 Minuten Puffer: die Sperren
  // berühren sich und werden eine einzige von 09:30 bis 12:00.
  const s = sperrenBilden([belegt("10:00", "10:30", 30), belegt("11:00", "11:30", 30)]);
  assert.equal(s.length, 1);
  assert.equal(s[0].start.getHours(), 9);
  assert.equal(s[0].start.getMinutes(), 30);
  assert.equal(s[0].ende.getHours(), 12);
});

test("freieLuecken liefert den Rest zwischen den Sperren", () => {
  const l = freieLuecken(
    D(`${MONTAG}T07:00:00`),
    D(`${MONTAG}T18:00:00`),
    sperrenBilden([belegt("09:00", "10:00", 0)]),
  );
  assert.equal(l.length, 2);
  assert.equal(l[0].ende.getHours(), 9);
  assert.equal(l[1].start.getHours(), 10);
});

// --- Grundfälle ---

test("ein leerer Arbeitstag beginnt um 07:00 und endet rechtzeitig", () => {
  const slots = berechneSlots({
    vonTag: MONTAG,
    bisTag: MONTAG,
    dauerMinuten: 60,
    belegt: [],
    jetzt: JETZT_FRUEH,
    optionen: BASIS,
  });
  const zeiten = startzeiten(slots);
  assert.equal(zeiten[0], "07:00");
  assert.equal(zeiten[zeiten.length - 1], "17:00", "der letzte Stundentermin endet um 18:00");
});

test("ein ganztägiger Termin sperrt den Tag vollständig", () => {
  const slots = berechneSlots({
    vonTag: MONTAG,
    bisTag: MONTAG,
    dauerMinuten: 15,
    belegt: [{ start: D(`${MONTAG}T00:00:00`), ende: D("2026-09-08T00:00:00"), puffer: 0 }],
    jetzt: JETZT_FRUEH,
    optionen: BASIS,
  });
  assert.equal(slots.length, 0);
});

test("Samstag und Sonntag liefern gar keine Slots", () => {
  const slots = berechneSlots({
    vonTag: "2026-09-12",
    bisTag: "2026-09-13",
    dauerMinuten: 60,
    belegt: [],
    jetzt: JETZT_FRUEH,
    optionen: BASIS,
  });
  assert.equal(slots.length, 0);
});

test("der Vorlauf sperrt alles, was zu kurzfristig ist", () => {
  const slots = berechneSlots({
    vonTag: MONTAG,
    bisTag: "2026-09-08",
    dauerMinuten: 60,
    belegt: [],
    jetzt: D(`${MONTAG}T09:00:00`),
    optionen: BASIS,
  });
  const frei = slots.filter((s) => s.frei);
  assert.equal(frei[0].start.getDate(), 8);
  assert.equal(frei[0].start.getHours(), 9);
  assert.ok(slots.filter((s) => s.start.getDate() === 7).every((s) => !s.frei));
});

// --- frei wählbare Dauer ---

test("eine längere Dauer lässt weniger Startzeiten übrig", () => {
  const kurz = berechneSlots({
    vonTag: MONTAG, bisTag: MONTAG, dauerMinuten: 15, belegt: [], jetzt: JETZT_FRUEH, optionen: BASIS,
  }).length;
  const lang = berechneSlots({
    vonTag: MONTAG, bisTag: MONTAG, dauerMinuten: 180, belegt: [], jetzt: JETZT_FRUEH, optionen: BASIS,
  }).length;
  assert.ok(lang < kurz);
});

test("eine Dauer in Fünf-Minuten-Schritten wird korrekt gerechnet", () => {
  const slots = berechneSlots({
    vonTag: MONTAG, bisTag: MONTAG, dauerMinuten: 25, belegt: [], jetzt: JETZT_FRUEH, optionen: BASIS,
  });
  assert.equal(slots[0].ende.getHours(), 7);
  assert.equal(slots[0].ende.getMinutes(), 25);
});

test("passt die Dauer nirgends in den Tag, gibt es keine Slots", () => {
  const slots = berechneSlots({
    vonTag: MONTAG, bisTag: MONTAG, dauerMinuten: 900, belegt: [], jetzt: JETZT_FRUEH, optionen: BASIS,
  });
  assert.equal(slots.length, 0);
});

// --- Randzeiten auf Anfrage ---

test("ohne Anfrageoption endet der Tag an der Bürozeit", () => {
  const slots = berechneSlots({
    vonTag: MONTAG, bisTag: MONTAG, dauerMinuten: 60, belegt: [], jetzt: JETZT_FRUEH, optionen: MIT_RAND,
  });
  const zeiten = startzeiten(slots);
  assert.equal(zeiten[0], "07:00");
  assert.equal(zeiten[zeiten.length - 1], "17:00");
});

test("mit Anfrageoption kommen Randzeiten dazu und sind als solche markiert", () => {
  const slots = berechneSlots({
    vonTag: MONTAG, bisTag: MONTAG, dauerMinuten: 60, belegt: [], jetzt: JETZT_FRUEH,
    optionen: MIT_RAND, mitAnfrage: true,
  });
  const zeiten = startzeiten(slots);
  assert.equal(zeiten[0], "06:00");
  assert.equal(zeiten[zeiten.length - 1], "20:00");

  const abends = slots.find((s) => s.start.getHours() === 19);
  assert.ok(abends?.aufAnfrage, "19 Uhr liegt ausserhalb der Buerozeit");
  const mittags = slots.find((s) => s.start.getHours() === 10);
  assert.equal(mittags?.aufAnfrage, false, "10 Uhr ist normale Buerozeit");
});

test("istBuchbar lehnt eine Randzeit ab, solange sie nicht angefragt wird", () => {
  const ohne = istBuchbar(D(`${MONTAG}T19:00:00`), 60, [], JETZT_FRUEH, MIT_RAND, false);
  assert.equal(ohne.ok, false);
  const mit = istBuchbar(D(`${MONTAG}T19:00:00`), 60, [], JETZT_FRUEH, MIT_RAND, true);
  assert.equal(mit.ok, true);
  if (mit.ok) assert.equal(mit.aufAnfrage, true);
});

// --- Höchstdauer ab einer Startzeit ---

test("ohne fremde Termine reicht die Dauer bis zum Feierabend", () => {
  assert.equal(maxDauerAb(D(`${MONTAG}T16:00:00`), [], JETZT_FRUEH, BASIS, 240), 120);
});

test("ein späterer Termin begrenzt die Dauer, sein Puffer eingerechnet", () => {
  const max = maxDauerAb(D(`${MONTAG}T09:00:00`), [belegt("11:00", "12:00", 30)], JETZT_FRUEH, BASIS, 240);
  assert.equal(max, 90, "09:00 bis 10:30, weil der Puffer den Block auf 10:30 vorzieht");
});

test("die Obergrenze wird nie überschritten", () => {
  assert.equal(maxDauerAb(D(`${MONTAG}T08:00:00`), [], JETZT_FRUEH, BASIS, 60), 60);
});

test("eine belegte Startzeit liefert null", () => {
  assert.equal(maxDauerAb(D(`${MONTAG}T09:00:00`), [belegt("09:00", "10:00", 0)], JETZT_FRUEH, BASIS, 240), 0);
});

test("tagesStartzeiten liefert nur Zeiten mit Platz für die Mindestdauer", () => {
  const zeiten = tagesStartzeiten(MONTAG, [], JETZT_FRUEH, BASIS, 15, 240);
  const letzte = zeiten[zeiten.length - 1];
  assert.equal(letzte.start.getHours(), 17);
  assert.equal(letzte.start.getMinutes(), 45);
  assert.equal(letzte.maxDauer, 15);
});

test("tagesStartzeiten lässt einen komplett belegten Tag leer", () => {
  const ganz = [{ start: D(`${MONTAG}T00:00:00`), ende: D("2026-09-08T00:00:00"), puffer: 0 }];
  assert.equal(tagesStartzeiten(MONTAG, ganz, JETZT_FRUEH, BASIS, 15, 240).length, 0);
});

// --- Empfehlung: welche Zeit zerschneidet den Tag am wenigsten ---

test("am Anfang und am Ende einer Lücke wird empfohlen, in der Mitte nicht", () => {
  const slots = berechneSlots({
    vonTag: MONTAG,
    bisTag: MONTAG,
    dauerMinuten: 60,
    belegt: [],
    jetzt: JETZT_FRUEH,
    optionen: BASIS,
  });
  const erste = slots[0];
  const letzte = slots[slots.length - 1];
  assert.equal(erste.empfehlung, "tagesbeginn", "07:00 ist Tagesbeginn");
  assert.equal(letzte.empfehlung, "tagesende", "17:00 bis 18:00 ist Feierabend");

  const mitten = slots.find((s) => s.start.getHours() === 9 && s.start.getMinutes() === 30);
  assert.equal(mitten?.empfehlung, null, "09:30 zerschneidet den Vormittag");
});

test("ein Beginn über Mittag gilt als Randzeit", () => {
  const slots = berechneSlots({
    vonTag: MONTAG, bisTag: MONTAG, dauerMinuten: 60, belegt: [], jetzt: JETZT_FRUEH, optionen: BASIS,
  });
  const zwoelf = slots.find((s) => s.start.getHours() === 12 && s.start.getMinutes() === 0);
  assert.equal(zwoelf?.empfehlung, "mittag");
});

test("nach einem fremden Termin ist die erste Zeit wieder ein Anfang", () => {
  const slots = berechneSlots({
    vonTag: MONTAG,
    bisTag: MONTAG,
    dauerMinuten: 30,
    belegt: [belegt("07:00", "10:00", 30)],
    jetzt: JETZT_FRUEH,
    optionen: BASIS,
  });
  assert.equal(slots[0].start.getHours(), 10);
  assert.equal(slots[0].start.getMinutes(), 30);
  assert.equal(
    slots[0].empfehlung,
    "anschliessend",
    "der Tag begann mit einem fremden Termin, das hier ist ein Anschluss und kein Tagesbeginn",
  );
});

test("es gibt deutlich weniger empfohlene als mögliche Zeiten", () => {
  const slots = berechneSlots({
    vonTag: MONTAG, bisTag: MONTAG, dauerMinuten: 60, belegt: [], jetzt: JETZT_FRUEH, optionen: BASIS,
  });
  const empfohlen = slots.filter((s) => s.empfehlung !== null).length;
  assert.ok(empfohlen >= 3, "Anfang, Mittag und Ende muessen dabei sein");
  assert.ok(empfohlen < slots.length / 2, "der grosse Rest bleibt zweite Wahl");
});

// --- Vorlauf: heute nie, dazu Stunden  ---

test("am heutigen Tag ist nichts buchbar, auch früh am Morgen nicht", () => {
  // Montag 06:00. Mit zwölf Stunden Vorlauf wäre 18:00 desselben Tages frei,
  // der Tag fällt aber ganz weg.
  const slots = berechneSlots({
    vonTag: MONTAG,
    bisTag: MONTAG,
    dauerMinuten: 30,
    belegt: [],
    jetzt: D(`${MONTAG}T06:00:00`),
    optionen: { ...BASIS, vorlaufStunden: 12 },
  });
  assert.ok(slots.every((s) => !s.frei), "kein Slot am heutigen Tag darf frei sein");
});

test("morgen ist buchbar, sobald der Vorlauf reicht", () => {
  const slots = berechneSlots({
    vonTag: MONTAG,
    bisTag: "2026-09-08",
    dauerMinuten: 30,
    belegt: [],
    jetzt: D(`${MONTAG}T06:00:00`),
    optionen: { ...BASIS, vorlaufStunden: 12 },
  });
  const frei = slots.filter((s) => s.frei);
  assert.equal(frei[0].start.getDate(), 8, "der erste freie Slot liegt am Folgetag");
  assert.equal(frei[0].start.getHours(), 7, "und dort gleich am Morgen, der Vorlauf ist erfuellt");
});

test("spät am Abend schiebt der Vorlauf über die Tagesgrenze hinaus", () => {
  // Montag 22:00 plus zwölf Stunden ergibt Dienstag 10:00; früher geht nicht,
  // obwohl der Dienstag als Tag erlaubt wäre.
  const slots = berechneSlots({
    vonTag: MONTAG,
    bisTag: "2026-09-08",
    dauerMinuten: 30,
    belegt: [],
    jetzt: D(`${MONTAG}T22:00:00`),
    optionen: { ...BASIS, vorlaufStunden: 12 },
  });
  const frei = slots.filter((s) => s.frei);
  assert.equal(frei[0].start.getDate(), 8);
  assert.equal(frei[0].start.getHours(), 10);
});

test("mit heuteBuchbar zählt nur noch der Vorlauf", () => {
  const slots = berechneSlots({
    vonTag: MONTAG,
    bisTag: MONTAG,
    dauerMinuten: 30,
    belegt: [],
    jetzt: D(`${MONTAG}T06:00:00`),
    optionen: { ...BASIS, vorlaufStunden: 2, heuteBuchbar: true },
  });
  const frei = slots.filter((s) => s.frei);
  assert.ok(frei.length > 0);
  assert.equal(frei[0].start.getHours(), 8, "06:00 plus zwei Stunden");
});
