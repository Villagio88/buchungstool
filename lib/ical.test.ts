import { test } from "node:test";
import assert from "node:assert/strict";
import ICAL from "ical.js";
import { baueEinladung } from "./ical";

/**
 * Rundlauf: was hier gebaut wird, muss von einem echten iCalendar-Parser wieder
 * gelesen werden können. Sonst fällt erst im Postfach auf, dass die Einladung
 * kaputt ist.
 */

const BASIS = {
  uid: "test-1@buchungstool.example",
  start: new Date(2026, 8, 15, 10, 0, 0),
  ende: new Date(2026, 8, 15, 11, 0, 0),
  titel: "Termin mit Max Muster",
  beschreibung: "Anliegen: Beratung",
  organisator: "absender@example.com",
  inhaberName: "Inhaber",
  inhaberMail: "inhaber@example.com",
  gastName: "Max Muster",
  gastMail: "max@example.com",
};

function parse(ics: string) {
  const comp = new ICAL.Component(ICAL.parse(ics));
  for (const vtz of comp.getAllSubcomponents("vtimezone")) {
    const tzid = vtz.getFirstPropertyValue("tzid");
    if (typeof tzid === "string" && !ICAL.TimezoneService.has(tzid)) {
      ICAL.TimezoneService.register(new ICAL.Timezone(vtz), tzid);
    }
  }
  return { comp, event: new ICAL.Event(comp.getFirstSubcomponent("vevent")!) };
}

test("die Einladung ist gültiges iCalendar und trägt METHOD REQUEST", () => {
  const { comp } = parse(baueEinladung(BASIS));
  assert.equal(comp.getFirstPropertyValue("method"), "REQUEST");
  assert.equal(comp.getFirstPropertyValue("version"), "2.0");
});

test("Start und Ende kommen in der richtigen Ortszeit wieder heraus", () => {
  const { event } = parse(baueEinladung(BASIS));
  assert.equal(event.startDate.toJSDate().getTime(), BASIS.start.getTime());
  assert.equal(event.endDate.toJSDate().getTime(), BASIS.ende.getTime());
});

test("Der Inhaber ist Teilnehmer mit offener Antwort, der Gast hat bereits zugesagt", () => {
  const { event } = parse(baueEinladung(BASIS));
  const gaeste = event.attendees.map((a) => ({
    mail: String(a.getFirstValue()).replace("mailto:", ""),
    partstat: a.getParameter("partstat"),
  }));
  const inhaber = gaeste.find((g) => g.mail === BASIS.inhaberMail);
  const gast = gaeste.find((g) => g.mail === BASIS.gastMail);
  assert.equal(inhaber?.partstat, "NEEDS-ACTION");
  assert.equal(gast?.partstat, "ACCEPTED");
});

test("Kommas und Semikolons im Namen zerstören die Datei nicht", () => {
  const { event } = parse(
    baueEinladung({
      ...BASIS,
      titel: "Termin mit Muster, Max; Firma AG",
      beschreibung: "Zeile eins\nZeile zwei, mit Komma",
    }),
  );
  assert.equal(event.summary, "Termin mit Muster, Max; Firma AG");
  assert.ok(event.description.includes("Zeile zwei, mit Komma"));
});

test("Umlaute überleben den Zeilenumbruch bei langen Titeln", () => {
  const langer = "Besprechung über Künstliche Intelligenz für die Schülerschaft der ganzen Region und Umgebung";
  const { event } = parse(baueEinladung({ ...BASIS, titel: langer }));
  assert.equal(event.summary, langer);
});

test("keine Zeile ist länger als 75 Oktetts", () => {
  const ics = baueEinladung({
    ...BASIS,
    titel: "Ein aussergewöhnlich langer Termintitel mit vielen Umlauten: ÄÖÜ äöü und noch mehr Text",
    beschreibung: "Eine ebenfalls sehr lange Beschreibung, die den Zeilenumbruch erzwingt, mit Umlauten wie Grösse und Änderung",
  });
  for (const zeile of ics.split("\r\n")) {
    assert.ok(
      Buffer.from(zeile, "utf8").length <= 75,
      `zu lange Zeile (${Buffer.from(zeile, "utf8").length}): ${zeile.slice(0, 40)}`,
    );
  }
});

// --- Eingaben der Gäste dürfen die Einladung nicht verändern ---

const ANGRIFFE = [
  "Hans;PARTSTAT=DECLINED;CN=X:mailto:boese@example.com;",
  'Hans";ROLE=CHAIR;X="',
  "Hans:mailto:boese@example.com",
  "Hans\\;PARTSTAT=DECLINED",
  "Hans,Fritz;RSVP=FALSE",
];

for (const name of ANGRIFFE) {
  test(`ein Name wie ${JSON.stringify(name)} verändert keinen Teilnehmer`, () => {
    const { event } = parse(baueEinladung({ ...BASIS, gastName: name, titel: `Termin mit ${name}`, ort: name }));
    const teilnehmer = event.attendees.map((a) => ({
      mail: String(a.getFirstValue()),
      partstat: a.getParameter("partstat"),
      role: a.getParameter("role"),
      rsvp: a.getParameter("rsvp"),
      fremd: a.getParameter("x"),
    }));
    assert.equal(teilnehmer.length, 2);
    assert.deepEqual(
      teilnehmer.map((t) => t.mail),
      [`mailto:${BASIS.inhaberMail}`, `mailto:${BASIS.gastMail}`],
    );
    assert.deepEqual(
      teilnehmer.map((t) => [t.partstat, t.role, t.rsvp, t.fremd]),
      [
        ["NEEDS-ACTION", "REQ-PARTICIPANT", "TRUE", undefined],
        ["ACCEPTED", "REQ-PARTICIPANT", "FALSE", undefined],
      ],
    );
    // Titel und Ort kommen unverändert zurück, als reiner Text.
    assert.equal(event.summary, `Termin mit ${name}`);
    assert.equal(event.location, name);
  });
}

test("Start und Ende stehen in UTC, unabhängig von der Zeitzone des Servers", () => {
  const ics = baueEinladung(BASIS);
  assert.match(ics, new RegExp(`DTSTART:${BASIS.start.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "")}\r\n`));
  assert.doesNotMatch(ics, /TZID=/);
});
