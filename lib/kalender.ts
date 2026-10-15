import ICAL from "ical.js";

/**
 * Belegte Zeiten aus beliebig vielen abonnierten Kalendern.
 *
 * Jeder Kalender, der sich als ICS-Link freigeben lässt, kann mitreden: Proton,
 * Microsoft 365 und Outlook, Google, iCloud, Nextcloud und andere. So zählt die
 * private Agenda bei einem Anbieter genauso wie die geschäftliche beim anderen.
 *
 * Wichtig: kein Titel, Ort oder Teilnehmer verlässt den Server. Die Seite ist
 * öffentlich; nach aussen geht ausschliesslich, dass eine Zeitspanne belegt ist.
 *
 * Warum ical.js: Outlook-Feeds nennen ihre Zeitzone etwa «W. Europe Standard
 * Time», ein Windows-Name statt einer IANA-Zone. Die Definition liegt als
 * VTIMEZONE in der Datei und muss registriert werden, sonst liegen alle Termine
 * falsch. Dazu kommen Serien, die expandiert werden müssen.
 *
 * Konfiguration über die Umgebung:
 *
 *     KALENDER=arbeit,privat
 *     KALENDER_ARBEIT_URL=https://outlook.office365.com/owa/calendar/.../calendar.ics
 *     KALENDER_ARBEIT_PUFFER=15
 *     KALENDER_PRIVAT_URL=https://calendar.proton.me/api/calendar/v1/url/.../calendar.ics?CacheKey=...&PassphraseKey=...
 *     KALENDER_PRIVAT_PUFFER=30
 */

type QuellenDefinition = {
  key: string;
  label: string;
  url: string;
  /**
   * Obergrenze in Stunden, ab der ein Eintrag dieser Quelle nicht mehr als
   * Termin, sondern als Arbeitszeit-Block gilt und die Zeit nicht blockiert.
   * Standard 0, also aus: im Zweifel blockiert jeder Eintrag.
   */
  maxStunden: number;
  /**
   * Mindestabstand in Minuten zum nächsten buchbaren Termin, je Kalender. Zu
   * Terminen mit Anfahrt braucht es mehr Luft als zu Besprechungen im Haus.
   */
  puffer: number;
};

function zahlAus(name: string, standard: number): number {
  const roh = process.env[name];
  if (roh === undefined || roh.trim() === "") return standard;
  const wert = Number(roh);
  return Number.isFinite(wert) && wert >= 0 ? wert : standard;
}

/** Die konfigurierten Kalender. Ohne URL wird ein Eintrag übersprungen. */
function quellen(): QuellenDefinition[] {
  return (process.env.KALENDER ?? "")
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean)
    .map((key) => {
      const k = key.toUpperCase().replace(/[^A-Z0-9]/g, "_");
      return {
        key,
        label: process.env[`KALENDER_${k}_NAME`]?.trim() || key,
        url: process.env[`KALENDER_${k}_URL`]?.trim() ?? "",
        maxStunden: zahlAus(`KALENDER_${k}_MAX_STUNDEN`, 0),
        puffer: zahlAus(`KALENDER_${k}_PUFFER`, zahlAus("PUFFER_STANDARD", 15)),
      };
    })
    .filter((q) => q.url.length > 0);
}

/**
 * Titel, die nie blockieren, als Liste in KALENDER_IGNORIEREN (durch Komma
 * getrennt, Teiltreffer, Gross- und Kleinschreibung egal).
 *
 * Gedacht für Einträge, die zwar im Kalender stehen, aber nichts über die eigene
 * Verfügbarkeit sagen, etwa eine Erinnerung oder ein Stand-up, über das hinweg
 * gebucht werden darf.
 */
function ignorierteTitel(): string[] {
  return (process.env.KALENDER_IGNORIEREN ?? "")
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t.length > 0);
}

/** Eine belegte Zeitspanne. Bewusst ohne jede inhaltliche Angabe. */
export type Belegt = {
  start: Date;
  ende: Date;
  /** Mindestabstand, den diese Sperre nach beiden Seiten braucht. */
  puffer: number;
};

export type BelegtStand = {
  zeiten: Belegt[];
  /** Quellen, die nicht geladen werden konnten. */
  fehler: string[];
  konfiguriert: number;
};

/**
 * Outlook setzt bei abgesagten Terminen nur den Titel-Präfix und lässt STATUS auf
 * CONFIRMED stehen. Ein abgesagter Termin darf keine Zeit blockieren.
 */
const ABGESAGT = /^\s*(abgesagt|abgelehnt|canceled|cancelled|annulliert|storniert)\s*:/i;

/**
 * Notbremse gegen Serien ohne UNTIL und ohne COUNT. Der Iterator läuft von DTSTART
 * bis ins Fenster; eine Wochenserie von 2018 braucht dafür schon über 400 Schritte.
 * Bewusst weit über allem, was je gebraucht wird: eine zu knappe Grenze würde alte
 * Serien nicht bremsen, sondern still verschwinden lassen.
 */
const MAX_WIEDERHOLUNGEN = 10_000;

/**
 * Blockieren ganztägige Einträge die Zeit?
 *
 * Standard ja, und das ist die sichere Seite. Lässt man sie generell durch, damit
 * etwa Ferien buchbar werden, fällt auch ein ganztägiger Eintrag wie «Konferenz»
 * oder «Reise» weg, und die Seite bietet Zeiten an, an denen niemand erreichbar ist.
 *
 * Ferien und ähnliche Einträge werden stattdessen namentlich ausgenommen, über
 * KALENDER_IGNORIEREN. Das trifft genau die gemeinten Einträge, statt eine ganze
 * Gattung zu entschärfen.
 */
function ganztagsBlockiert(): boolean {
  const roh = process.env.GANZTAGS_BLOCKIERT;
  if (roh === undefined || roh === "") return true;
  return roh !== "0" && roh.toLowerCase() !== "nein";
}

const CACHE_SEKUNDEN = 120;
let warnungOhneKalender = false;
const TIMEOUT_MS = 20_000;

function zeitzonenRegistrieren(comp: ICAL.Component): void {
  for (const vtz of comp.getAllSubcomponents("vtimezone")) {
    const tzid = vtz.getFirstPropertyValue("tzid");
    if (typeof tzid !== "string" || ICAL.TimezoneService.has(tzid)) continue;
    ICAL.TimezoneService.register(new ICAL.Timezone(vtz), tzid);
  }
}

/**
 * Blockiert dieser Termin überhaupt Zeit?
 *
 * Nein bei abgesagten Terminen und bei allem, was der Kalender selbst als «frei»
 * markiert: `TRANSP:TRANSPARENT` im Standard, `X-MICROSOFT-CDO-BUSYSTATUS:FREE`
 * bei Outlook. Ohne diese Prüfung würde jeder als frei markierte Ganztagseintrag
 * einen kompletten Arbeitstag aus dem Buchungsraster nehmen.
 */
function blockiert(event: ICAL.Event, ignorieren: string[]): boolean {
  const titel = (event.summary ?? "").trim();
  if (ABGESAGT.test(titel)) return false;

  // Ausdrücklich ausgenommene Einträge (KALENDER_IGNORIEREN).
  const klein = titel.toLowerCase();
  if (ignorieren.some((i) => klein.includes(i))) return false;

  const status = event.component.getFirstPropertyValue("status");
  if (typeof status === "string" && status.toUpperCase() === "CANCELLED") return false;

  const transp = event.component.getFirstPropertyValue("transp");
  if (typeof transp === "string" && transp.toUpperCase() === "TRANSPARENT") return false;

  const busy = event.component.getFirstPropertyValue("x-microsoft-cdo-busystatus");
  if (typeof busy === "string" && busy.toUpperCase() === "FREE") return false;

  // Ganztägige Einträge sind fast nie ein Termin, sondern eine Information.
  if (event.startDate?.isDate === true && !ganztagsBlockiert()) return false;

  return true;
}

function belegtAusEvent(
  event: ICAL.Event,
  von: Date,
  bis: Date,
  puffer: number,
  ignorieren: string[],
): Belegt[] {
  if (!blockiert(event, ignorieren)) return [];

  const passt = (start: Date, ende: Date): Belegt | null => {
    // Ganztägige Termine haben ein exklusives Ende; für die Überschneidung zählt
    // die letzte tatsächlich belegte Millisekunde.
    const letzterMoment = new Date(Math.max(ende.getTime() - 1, start.getTime()));
    if (letzterMoment < von || start > bis) return null;
    return { start, ende, puffer };
  };

  if (!event.isRecurring()) {
    const start = event.startDate.toJSDate();
    const ende = event.endDate ? event.endDate.toJSDate() : start;
    const treffer = passt(start, ende);
    return treffer ? [treffer] : [];
  }

  const zeiten: Belegt[] = [];
  const iterator = event.iterator();
  let naechste: ICAL.Time | null;
  let zaehler = 0;

  while ((naechste = iterator.next()) && zaehler < MAX_WIEDERHOLUNGEN) {
    zaehler += 1;
    if (naechste.toJSDate() > bis) break;
    const details = event.getOccurrenceDetails(naechste);
    const start = details.startDate.toJSDate();
    const ende = details.endDate ? details.endDate.toJSDate() : start;
    const treffer = passt(start, ende);
    if (treffer) zeiten.push(treffer);
  }

  return zeiten;
}

/**
 * Parst einen ICS-Text zu belegten Zeiten. Getrennt, damit er testbar ist.
 *
 * Die Obergrenze blendet überlange Einträge aus (siehe QuellenDefinition); 0
 * schaltet den Filter ab.
 */
export function belegtAusIcs(
  text: string,
  von: Date,
  bis: Date,
  maxStunden = 0,
  puffer = 0,
  ignorieren: string[] = [],
): Belegt[] {
  const comp = new ICAL.Component(ICAL.parse(text));
  zeitzonenRegistrieren(comp);

  const grenzeMs = maxStunden > 0 ? maxStunden * 3600_000 : Infinity;

  const zeiten: Belegt[] = [];
  for (const vevent of comp.getAllSubcomponents("vevent")) {
    try {
      const gefunden = belegtAusEvent(new ICAL.Event(vevent), von, bis, puffer, ignorieren);
      zeiten.push(...gefunden.filter((z) => z.ende.getTime() - z.start.getTime() <= grenzeMs));
    } catch {
      // Ein kaputter Einzeltermin darf nicht den ganzen Kalender kippen. Er fällt
      // hier lieber weg, als dass die Seite fehlerhafte Verfügbarkeit anzeigt.
      continue;
    }
  }
  return zeiten;
}

async function quelleLaden(quelle: QuellenDefinition, von: Date, bis: Date): Promise<Belegt[]> {
  const res = await fetch(quelle.url, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    next: { revalidate: CACHE_SEKUNDEN },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return belegtAusIcs(
    await res.text(),
    von,
    bis,
    quelle.maxStunden,
    quelle.puffer,
    ignorierteTitel(),
  );
}

/**
 * Alle belegten Zeiten im Fenster.
 *
 * Fällt eine Quelle aus, wird das gemeldet, aber die übrigen werden verwendet.
 * Wichtig: der Aufrufer muss auf `fehler` reagieren. Ein stiller Ausfall würde
 * fremde Termine als frei anzeigen und zu Doppelbuchungen führen.
 */
export async function getBelegteZeiten(von: Date, bis: Date): Promise<BelegtStand> {
  const aktiv = quellen();
  if (aktiv.length === 0 && !warnungOhneKalender) {
    warnungOhneKalender = true;
    console.warn("[kalender] Kein Kalender konfiguriert (KALENDER): jede Zeit gilt als frei.");
  }

  const ergebnisse = await Promise.allSettled(aktiv.map((q) => quelleLaden(q, von, bis)));

  const zeiten: Belegt[] = [];
  const fehler: string[] = [];

  ergebnisse.forEach((r, i) => {
    if (r.status === "fulfilled") zeiten.push(...r.value);
    else fehler.push(aktiv[i].label);
  });

  zeiten.sort((a, b) => a.start.getTime() - b.start.getTime());
  return { zeiten, fehler, konfiguriert: aktiv.length };
}
