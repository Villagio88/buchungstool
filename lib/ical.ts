/**
 * Erzeugt die Kalendereinladung, die der Inhaber per Mail annehmen kann.
 *
 * Erfahrungen mit echten Postfächern:
 * - Outlook und Microsoft 365 tragen die Einladung sofort als vorläufig ein und
 *   blockieren die Zeit nach der Annahme.
 * - Manche Exchange-Umgebungen ersetzen den Titel durch den Mail-Betreff und
 *   stellen etwa "Extern" voran. Deshalb lautet der Betreff bereits wie ein
 *   Termintitel und enthält keine Zusatzinformation, die im Kalender stört.
 * - Proton legt eingehende Einladungen immer im Standardkalender ab, unabhängig
 *   von der Empfängeradresse. Für die Verfügbarkeit ist das folgenlos, solange
 *   dieser Kalender ebenfalls eingebunden ist.
 */

/**
 * Sonderzeichen nach RFC 5545 maskieren. Ohne das zerlegt ein Komma im Namen den
 * Wert in zwei Felder und die Einladung wird unbrauchbar.
 */
function maskieren(wert: string): string {
  return wert
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    // Auch ein einzelnes CR: manche Parser behandeln es als Zeilenende.
    .replace(/\r\n|\r|\n/g, "\\n");
}

/**
 * Wert für einen Parameter wie CN. Dort hilft Backslash-Maskierung nicht: RFC 5545
 * verlangt Anführungszeichen, und innerhalb davon sind `"` nicht erlaubt. Zeichen,
 * die einen Parameter beenden könnten (`;`, `:`, `,`), werden zur Sicherheit
 * ebenfalls ersetzt, damit auch nachlässige Parser nichts Neues herauslesen.
 */
function paramWert(wert: string): string {
  const sauber = wert.replace(/[\u0000-\u001f\u007f";:,]/g, " ").replace(/\s{2,}/g, " ").trim();
  return `"${sauber}"`;
}

/**
 * Zeilen auf 75 Oktetts umbrechen, Folgezeilen mit einem Leerzeichen einleiten.
 * Gezählt wird in Bytes, nicht in Zeichen: Umlaute belegen in UTF-8 zwei Bytes,
 * und ein Umbruch mitten in einem Zeichen macht die Datei kaputt.
 */
function falten(zeile: string): string {
  const bytes = Buffer.from(zeile, "utf8");
  if (bytes.length <= 75) return zeile;

  const teile: string[] = [];
  let rest = zeile;
  let grenze = 75;

  while (Buffer.from(rest, "utf8").length > grenze) {
    let schnitt = grenze;
    while (schnitt > 0 && Buffer.from(rest.slice(0, schnitt), "utf8").length > grenze) {
      schnitt -= 1;
    }
    teile.push(rest.slice(0, schnitt));
    rest = rest.slice(schnitt);
    grenze = 74; // Folgezeilen tragen ein führendes Leerzeichen
  }
  teile.push(rest);
  return teile.join("\r\n ");
}

function utcStempel(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function ortszeit(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
    `T${p(d.getHours())}${p(d.getMinutes())}00`
  );
}

const VTIMEZONE = [
  "BEGIN:VTIMEZONE",
  "TZID:Europe/Zurich",
  "BEGIN:DAYLIGHT",
  "TZOFFSETFROM:+0100",
  "TZOFFSETTO:+0200",
  "TZNAME:CEST",
  "DTSTART:19700329T020000",
  "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU",
  "END:DAYLIGHT",
  "BEGIN:STANDARD",
  "TZOFFSETFROM:+0200",
  "TZOFFSETTO:+0100",
  "TZNAME:CET",
  "DTSTART:19701025T030000",
  "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU",
  "END:STANDARD",
  "END:VTIMEZONE",
];

export type EinladungDaten = {
  uid: string;
  start: Date;
  ende: Date;
  titel: string;
  beschreibung: string;
  /** Absenderadresse des Mailkontos, tritt als Organisator auf. */
  organisator: string;
  /** Name des Inhabers, wie er in der Einladung erscheint. */
  inhaberName: string;
  /** Zieladresse des Inhabers, bestimmt den Kalender. */
  inhaberMail: string;
  gastName: string;
  gastMail: string;
  /** Wo der Termin stattfindet. Landet als LOCATION im Kalender. */
  ort?: string | null;
};

export function baueEinladung(d: EinladungDaten, absage = false): string {
  const zeilen = [
    "BEGIN:VCALENDAR",
    "PRODID:-//Buchungstool//Terminbuchung//DE",
    "VERSION:2.0",
    "CALSCALE:GREGORIAN",
    // Bei einer Absage nimmt der Kalender den Termin selbst wieder heraus. Die
    // hochgezählte SEQUENCE ist dafür Pflicht, sonst ignorieren Outlook und
    // Proton die Nachricht als veraltet.
    absage ? "METHOD:CANCEL" : "METHOD:REQUEST",
    ...VTIMEZONE,
    "BEGIN:VEVENT",
    `UID:${d.uid}`,
    `DTSTAMP:${utcStempel(new Date())}`,
    `DTSTART;TZID=Europe/Zurich:${ortszeit(d.start)}`,
    `DTEND;TZID=Europe/Zurich:${ortszeit(d.ende)}`,
    `SUMMARY:${maskieren(d.titel)}`,
    ...(d.ort ? [`LOCATION:${maskieren(d.ort)}`] : []),
    `DESCRIPTION:${maskieren(d.beschreibung)}`,
    `ORGANIZER;CN=Terminbuchung:mailto:${d.organisator}`,
    `ATTENDEE;CN=${paramWert(d.inhaberName || d.inhaberMail)};ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:${d.inhaberMail}`,
    `ATTENDEE;CN=${paramWert(d.gastName)};ROLE=REQ-PARTICIPANT;PARTSTAT=ACCEPTED;RSVP=FALSE:mailto:${d.gastMail}`,
    absage ? "SEQUENCE:1" : "SEQUENCE:0",
    absage ? "STATUS:CANCELLED" : "STATUS:CONFIRMED",
    "TRANSP:OPAQUE",
    "END:VEVENT",
    "END:VCALENDAR",
  ];

  return zeilen.map(falten).join("\r\n");
}
