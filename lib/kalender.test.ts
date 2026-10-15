import { test } from "node:test";
import assert from "node:assert/strict";
import { belegtAusIcs } from "./kalender";

/**
 * Tests des ICS-Parsers: was blockiert, was nicht, und mit welchem Abstand.
 */

function ics(...eintraege: string[]): string {
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Test//DE",
    ...eintraege,
    "END:VCALENDAR",
  ].join("\r\n");
}

function event(titel: string, von: string, bis: string, extra: string[] = []): string {
  return [
    "BEGIN:VEVENT",
    `UID:${titel.replace(/\W/g, "")}@test`,
    `SUMMARY:${titel}`,
    `DTSTART;TZID=Europe/Zurich:${von}`,
    `DTEND;TZID=Europe/Zurich:${bis}`,
    "STATUS:CONFIRMED",
    ...extra,
    "END:VEVENT",
  ].join("\r\n");
}

const VON = new Date(2026, 8, 1, 0, 0, 0);
const BIS = new Date(2026, 8, 30, 23, 59, 59);

test("ein normaler Termin blockiert und trägt den Puffer der Quelle", () => {
  const z = belegtAusIcs(ics(event("Besprechung", "20260907T100000", "20260907T110000")), VON, BIS, 0, 30);
  assert.equal(z.length, 1);
  assert.equal(z[0].puffer, 30, "der Puffer kommt vom Kalender, nicht vom Termin");
});

test("ein Titel auf der Ignorierliste blockiert nicht", () => {
  const inhalt = ics(
    event("Erinnerung Zahnarzt", "20260910T080000", "20260910T160000"),
    event("Besprechung", "20260910T170000", "20260910T180000"),
  );
  const ohne = belegtAusIcs(inhalt, VON, BIS, 0, 30);
  assert.equal(ohne.length, 2, "ohne Liste blockieren beide");

  const mit = belegtAusIcs(inhalt, VON, BIS, 0, 30, ["erinnerung"]);
  assert.equal(mit.length, 1, "die Erinnerung fällt weg");
  assert.equal(mit[0].start.getHours(), 17);
});

test("die Ignorierliste trifft Teilstücke und ignoriert Gross- und Kleinschreibung", () => {
  const inhalt = ics(event("ERINNERUNG an den Geburtstag", "20260910T080000", "20260910T160000"));
  assert.equal(belegtAusIcs(inhalt, VON, BIS, 0, 30, ["erinnerung"]).length, 0);
});

test("ein als frei markierter Termin blockiert nicht", () => {
  const frei = belegtAusIcs(
    ics(event("Info", "20260907T100000", "20260907T110000", ["TRANSP:TRANSPARENT"])),
    VON, BIS, 0, 30,
  );
  assert.equal(frei.length, 0);

  const outlookFrei = belegtAusIcs(
    ics(event("Info", "20260907T100000", "20260907T110000", ["X-MICROSOFT-CDO-BUSYSTATUS:FREE"])),
    VON, BIS, 0, 30,
  );
  assert.equal(outlookFrei.length, 0);
});

test("abgesagte Termine blockieren nicht", () => {
  const z = belegtAusIcs(
    ics(event("Abgesagt: Besprechung", "20260907T100000", "20260907T110000")),
    VON, BIS, 0, 30,
  );
  assert.equal(z.length, 0);
});

test("die Obergrenze blendet überlange Einträge aus, wenn sie gesetzt ist", () => {
  const inhalt = ics(event("Arbeitsblock", "20260907T070000", "20260907T180000"));
  assert.equal(belegtAusIcs(inhalt, VON, BIS, 0, 30).length, 1, "ohne Grenze blockiert er");
  assert.equal(belegtAusIcs(inhalt, VON, BIS, 4, 30).length, 0, "mit Grenze von vier Stunden nicht");
});

test("ein ganztägiger Eintrag blockiert standardmässig", () => {
  const ganztags = [
    "BEGIN:VEVENT",
    "UID:ferien@test",
    "SUMMARY:Herbstferien",
    "DTSTART;VALUE=DATE:20260912",
    "DTEND;VALUE=DATE:20260926",
    "STATUS:CONFIRMED",
    "END:VEVENT",
  ].join("\r\n");
  assert.equal(belegtAusIcs(ics(ganztags), VON, BIS, 0, 30).length, 1);
});

test("mit GANZTAGS_BLOCKIERT=0 blockiert er nicht mehr", () => {
  const vorher = process.env.GANZTAGS_BLOCKIERT;
  process.env.GANZTAGS_BLOCKIERT = "0";
  try {
    const ganztags = [
      "BEGIN:VEVENT",
      "UID:ferien2@test",
      "SUMMARY:Herbstferien",
      "DTSTART;VALUE=DATE:20260912",
      "DTEND;VALUE=DATE:20260926",
      "STATUS:CONFIRMED",
      "END:VEVENT",
    ].join("\r\n");
    assert.equal(belegtAusIcs(ics(ganztags), VON, BIS, 0, 30).length, 0);
  } finally {
    if (vorher === undefined) delete process.env.GANZTAGS_BLOCKIERT;
    else process.env.GANZTAGS_BLOCKIERT = vorher;
  }
});

test("ein Termin mit Uhrzeit blockiert weiterhin", () => {
  const mitZeit = belegtAusIcs(
    ics(event("Besprechung", "20260910T100000", "20260910T110000")),
    VON, BIS, 0, 30,
  );
  assert.equal(mitZeit.length, 1);
});

test("ein ganztägiger Eintrag auf der Ignorierliste blockiert nicht", () => {
  // So werden Ferien behandelt: namentlich ausgenommen, statt alle
  // Ganztagestermine durchzulassen.
  const ferien = [
    "BEGIN:VEVENT",
    "UID:hf@test",
    "SUMMARY:Herbstferien",
    "DTSTART;VALUE=DATE:20260912",
    "DTEND;VALUE=DATE:20260926",
    "STATUS:CONFIRMED",
    "END:VEVENT",
  ].join("\r\n");
  assert.equal(belegtAusIcs(ics(ferien), VON, BIS, 0, 30).length, 1, "ohne Liste blockiert er");
  assert.equal(belegtAusIcs(ics(ferien), VON, BIS, 0, 30, ["ferien"]).length, 0);
});

test("eine ganztägige Konferenz blockiert weiterhin", () => {
  const konferenz = [
    "BEGIN:VEVENT",
    "UID:zh@test",
    "SUMMARY:Konferenz",
    "DTSTART;VALUE=DATE:20260911",
    "DTEND;VALUE=DATE:20260912",
    "STATUS:CONFIRMED",
    "END:VEVENT",
  ].join("\r\n");
  assert.equal(belegtAusIcs(ics(konferenz), VON, BIS, 0, 30, ["ferien", "erinnerung"]).length, 1);
});
