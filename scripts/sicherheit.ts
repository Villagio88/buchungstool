/**
 * Prüft, ob Fremdeingaben aus der Kalendereinladung ausbrechen können.
 *
 * Massstab ist nicht, wie die Datei aussieht, sondern was ein echter Parser
 * daraus macht: entsteht ein zusätzliches Feld oder ein zweiter Termin?
 */
import ICAL from "ical.js";
import { baueEinladung } from "../lib/ical";

const basis = {
  uid: "test@x",
  start: new Date(2026, 8, 15, 10, 0),
  ende: new Date(2026, 8, 15, 11, 0),
  beschreibung: "Test",
  organisator: "a@b.ch",
  inhaberName: "Inhaber",
  inhaberMail: "c@d.ch",
  gastMail: "e@f.ch",
};

const angriffe: [string, string][] = [
  ["Parameter im Namen", "Hans;PARTSTAT=DECLINED;CN=X:mailto:boese@example.com;"],
  ["Anführungszeichen im Namen", 'Hans";ROLE=CHAIR;X="'],
  ["Zeilenumbruch LF", "Max\nSUMMARY:Eingeschleust"],
  ["Zeilenumbruch CR", "Max\rSUMMARY:Eingeschleust"],
  ["CRLF", "Max\r\nSUMMARY:Eingeschleust"],
  ["zweiter Termin", "Max\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nSUMMARY:Fremd\r\nEND:VEVENT\r\nBEGIN:VEVENT"],
  ["Doppelpunkt und Semikolon", "Max;X-BOSE=1:hallo"],
];

let luecken = 0;
for (const [name, wert] of angriffe) {
  const ics = baueEinladung({ ...basis, titel: wert, gastName: wert, ort: wert });
  try {
    const comp = new ICAL.Component(ICAL.parse(ics));
    const events = comp.getAllSubcomponents("vevent");
    const ev = events[0];
    const summary = ev?.getFirstPropertyValue("summary");
    const fremd = events.length > 1;
    const zusatz = ev?.getAllProperties().filter((p) => /^x-/i.test(p.name)).length ?? 0;
    // Teilnehmer: genau zwei, mit den erwarteten Adressen und Parametern.
    const teilnehmer = (ev?.getAllProperties("attendee") ?? []).map(
      (a) => `${a.getFirstValue()}|${a.getParameter("partstat")}|${a.getParameter("role")}|${Object.keys(a.toJSON()[1]).sort().join(",")}`,
    );
    const erwartet = [
      "mailto:c@d.ch|NEEDS-ACTION|REQ-PARTICIPANT|cn,partstat,role,rsvp",
      "mailto:e@f.ch|ACCEPTED|REQ-PARTICIPANT|cn,partstat,role,rsvp",
    ];
    const teilnehmerOk = JSON.stringify(teilnehmer) === JSON.stringify(erwartet);
    const sauber = teilnehmerOk && !fremd && zusatz === 0 && String(summary).includes("Eingeschleust") === String(wert).includes("Eingeschleust");
    if (!sauber) luecken++;
    console.log(
      `${sauber ? "dicht " : "LUECKE"}  ${name.padEnd(26)} Termine=${events.length} X-Felder=${zusatz} Teilnehmer=${teilnehmerOk ? "ok" : JSON.stringify(teilnehmer)}`,
    );
    console.log(`         SUMMARY kommt zurück als: ${JSON.stringify(String(summary))}`);
  } catch (e) {
    luecken++;
    console.log(`LUECKE  ${name}: Datei nicht mehr parsbar (${(e as Error).message})`);
  }
}
console.log(luecken === 0 ? "\nKein Ausbruch möglich." : `\n${luecken} Lücken.`);
