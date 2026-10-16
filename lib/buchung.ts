import { randomUUID } from "node:crypto";
import { db, UeberschneidungsFehler } from "./db";
import { getBelegteZeiten, type Belegt } from "./kalender";
import {
  berechneSlots,
  istBuchbar,
  tagesStartzeiten,
  tagText,
  type SlotOptionen,
} from "./slots";
import {
  KONFIG,
  bereichAus,
  dauerGueltig,
  istWunschzeit,
  istWunschtag,
  istMailadresse,
  type BereichKey,
} from "./config";

/**
 * Die Serverseite der Buchung: Verfügbarkeit ermitteln und einen Termin annehmen.
 *
 * Grundsatz: Was das Browserfenster anzeigt, ist ein Vorschlag. Verbindlich ist
 * ausschliesslich die Prüfung hier, unmittelbar vor dem Schreiben.
 */

export const OPTIONEN: SlotOptionen = {
  startRasterMinuten: KONFIG.startRasterMinuten,
  vorlaufStunden: KONFIG.vorlaufStunden,
  heuteBuchbar: KONFIG.heuteBuchbar,
  vorausTage: KONFIG.vorausTage,
  arbeitstage: [...KONFIG.arbeitstage],
  vonUhr: KONFIG.vonUhr,
  bisUhr: KONFIG.bisUhr,
  anfrageVonUhr: KONFIG.anfrageVonUhr,
  anfrageBisUhr: KONFIG.anfrageBisUhr,
};

/** Eigene Buchungen als belegte Zeiten, damit ein Slot sofort gesperrt ist. */
async function eigeneBuchungen(von: Date, bis: Date): Promise<Belegt[]> {
  const rows = db().aktiveImFenster(von, bis);
  // Auch zu einem selbst gebuchten Termin gilt ein Abstand (PUFFER_EIGENE),
  // sonst klebt die nächste Buchung direkt daran.
  return rows.map((r) => ({ start: r.start, ende: r.ende, puffer: KONFIG.pufferEigene }));
}

/**
 * Löscht abgelaufene Personendaten, höchstens einmal pro Stunde. Läuft bei
 * normalen Seitenaufrufen mit, damit es keinen eigenen Zeitplaner braucht.
 */
let letztesAufraeumen = 0;
function aufraeumenWennFaellig(): void {
  const jetzt = Date.now();
  if (jetzt - letztesAufraeumen < 3_600_000) return;
  letztesAufraeumen = jetzt;
  try {
    const r = db().aufraeumen(
      new Date(jetzt),
      KONFIG.loeschenIpNachTagen,
      KONFIG.loeschenPersonendatenNachTagen,
    );
    if (r.ip || r.personen) {
      console.log(`[datenschutz] bereinigt: ${r.ip} IP-Adressen, ${r.personen} Buchungen`);
    }
  } catch (e) {
    console.error("[datenschutz] Aufräumen fehlgeschlagen:", e);
  }
}

export type MonatsStand = {
  /** Tage im Format JJJJ-MM-TT, an denen mindestens eine Zeit frei ist. */
  freieTage: string[];
  /** Davon jene, die ins Wochenmuster des Bereichs passen. */
  wunschTage: string[];
  /** Ausgefallene Kalenderquellen. Ist das nicht leer, wird nicht gebucht. */
  fehler: string[];
};

/** Erster und letzter Tag eines Monats, jeweils voll. */
function monatsRand(jahr: number, monat: number): { von: Date; bis: Date } {
  const von = new Date(jahr, monat - 1, 1, 0, 0, 0, 0);
  const bis = new Date(jahr, monat, 0, 23, 59, 59, 999);
  return { von, bis };
}

/**
 * Welche Tage eines Monats haben überhaupt eine freie Zeit?
 *
 * Erster Schritt der Buchung: der Gast sieht einen Monatskalender und kann nur
 * Tage anklicken, an denen wirklich etwas geht. Gerechnet wird mit der kürzest
 * möglichen Dauer, sonst verschwände ein Tag mit einer freien Viertelstunde.
 */
export async function getMonat(
  jahr: number,
  monat: number,
  mitAnfrage = false,
  bereich?: BereichKey,
): Promise<MonatsStand> {
  aufraeumenWennFaellig();
  const { von, bis } = monatsRand(jahr, monat);
  const jetzt = new Date();

  // Nichts vor heute laden, das spart einen guten Teil der Rechnung.
  const abHeute = von < jetzt ? new Date(jetzt.getFullYear(), jetzt.getMonth(), jetzt.getDate()) : von;
  if (abHeute > bis) return { freieTage: [], wunschTage: [], fehler: [] };

  const ladeVon = new Date(abHeute.getTime() - 86_400_000);
  const ladeBis = new Date(bis.getTime() + 86_400_000);

  const [stand, eigene] = await Promise.all([
    getBelegteZeiten(ladeVon, ladeBis),
    eigeneBuchungen(ladeVon, ladeBis),
  ]);
  const belegt = [...stand.zeiten, ...eigene];

  const slots = berechneSlots({
    vonTag: tagText(abHeute),
    bisTag: tagText(bis),
    dauerMinuten: KONFIG.dauerMinMinuten,
    belegt,
    jetzt,
    optionen: OPTIONEN,
    mitAnfrage,
  });

  const freie = new Set<string>();
  for (const s of slots) if (s.frei) freie.add(tagText(s.start));

  const freieTage = [...freie].sort();
  const wunschTage = bereich ? freieTage.filter((t) => istWunschtag(t, bereich)) : [];

  return { freieTage, wunschTage, fehler: stand.fehler };
}

export type TagesStand = {
  zeiten: {
    startIso: string;
    maxDauer: number;
    aufAnfrage: boolean;
    /** Randzeit, die keinen Arbeitsblock zerschneidet. */
    empfehlung: import("./slots").Empfehlung;
    /** Liegt im Wochenmuster des gewählten Bereichs. */
    wunschzeit: boolean;
  }[];
  fehler: string[];
};

/**
 * Die freien Startzeiten eines Tages, mit der jeweils möglichen Höchstdauer.
 *
 * Zweiter und dritter Schritt in einem Zug: der Gast wählt eine Zeit und sieht
 * dann nur die Dauern, die dort auch hineinpassen.
 */
export async function getTag(
  tag: string,
  mitAnfrage = false,
  bereich?: BereichKey,
): Promise<TagesStand> {
  const [j, m, t] = tag.split("-").map(Number);
  const von = new Date(j, m - 1, t, 0, 0, 0, 0);
  const bis = new Date(j, m - 1, t, 23, 59, 59, 999);

  const [stand, eigene] = await Promise.all([
    getBelegteZeiten(new Date(von.getTime() - 86_400_000), new Date(bis.getTime() + 86_400_000)),
    eigeneBuchungen(new Date(von.getTime() - 86_400_000), new Date(bis.getTime() + 86_400_000)),
  ]);

  const zeiten = tagesStartzeiten(
    tag,
    [...stand.zeiten, ...eigene],
    new Date(),
    OPTIONEN,
    KONFIG.dauerMinMinuten,
    KONFIG.dauerMaxMinuten,
    mitAnfrage,
  );

  return {
    zeiten: zeiten.map((z) => ({
      startIso: z.start.toISOString(),
      maxDauer: z.maxDauer,
      aufAnfrage: z.aufAnfrage,
      empfehlung: z.empfehlung,
      wunschzeit: bereich ? istWunschzeit(z.start, bereich) : false,
    })),
    fehler: stand.fehler,
  };
}

export type BuchungsEingabe = {
  startIso: string;
  dauerMinuten: number;
  /** Der Gast hat Randzeiten ausserhalb der Bürozeit zugelassen. */
  mitAnfrage: boolean;
  bereich: string;
  name: string;
  email: string;
  anliegen: string;
  ort: string;
  /** Verstecktes Feld, das nur ein Bot ausfüllt. */
  falle: string;
  ip: string | null;
};

export type BuchungsErgebnis =
  | {
      ok: true;
      id: string;
      start: Date;
      ende: Date;
      minuten: number;
      bereichLabel: string;
      mailAnGast: boolean;
      /** Liegt ausserhalb der Bürozeit und ist damit eine Anfrage. */
      aufAnfrage: boolean;
    }
  | { ok: false; grund: string };


/**
 * Entfernt Steuerzeichen aus Freitext.
 *
 * Name und Ort landen im Mail-Betreff und im Termintitel. Ein Zeilenumbruch dort
 * ist der klassische Weg, in einer Mail eigene Kopfzeilen unterzubringen.
 * Nodemailer wehrt das ab, aber die Eingabe gehört schon vorher sauber.
 */
function ohneSteuerzeichen(text: string): string {
  return text.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s{2,}/g, " ").trim();
}

/**
 * Raster der Belegungseinheiten. Jede angefangene Einheit zählt als belegt; bei
 * feineren Dauerschritten sperrt das im Zweifel etwas zu viel, nie zu wenig.
 */
const EINHEIT_MINUTEN = 5;

/**
 * Alle angefangenen Fünf-Minuten-Einheiten zwischen Start und Ende.
 *
 * Das Ende selbst gehört nicht dazu: ein Termin bis 10:30 lässt die Einheit
 * 10:30 frei, sonst könnte niemand direkt anschliessen.
 */
export function einheitenVon(start: Date, ende: Date): Date[] {
  const schritt = EINHEIT_MINUTEN * 60_000;
  // Abrunden, damit auch eine krumme Startzeit sauber auf dem Raster liegt.
  const erste = Math.floor(start.getTime() / schritt) * schritt;
  const einheiten: Date[] = [];
  for (let t = erste; t < ende.getTime(); t += schritt) einheiten.push(new Date(t));
  return einheiten;
}

export async function buchen(eingabe: BuchungsEingabe): Promise<BuchungsErgebnis> {
  aufraeumenWennFaellig();
  // Bot-Falle: ein unsichtbares Feld, das ein Mensch nie sieht und nie ausfüllt.
  // Stillschweigend abweisen, damit ein Bot nicht lernt, woran es lag.
  if (eingabe.falle.trim() !== "") {
    return { ok: false, grund: "Die Anfrage konnte nicht verarbeitet werden." };
  }

  const name = ohneSteuerzeichen(eingabe.name);
  const email = eingabe.email.trim().toLowerCase();
  // Das Anliegen darf Zeilenumbrüche behalten, es steht nur im Mailtext.
  const anliegen = eingabe.anliegen.replace(/\r/g, "").trim();
  const ort = ohneSteuerzeichen(eingabe.ort);

  if (name.length < 2 || name.length > 80) return { ok: false, grund: "Bitte gib deinen Namen an." };
  if (!istMailadresse(email) || email.length > 120) {
    return { ok: false, grund: "Diese Mailadresse sieht nicht gültig aus." };
  }
  if (anliegen.length < 3) {
    return { ok: false, grund: "Bitte schreib kurz, worum es geht." };
  }
  if (anliegen.length > 1000) {
    return { ok: false, grund: "Das Anliegen ist zu lang (höchstens 1000 Zeichen)." };
  }
  if (ort.length < 2 || ort.length > 120) {
    return { ok: false, grund: "Bitte gib an, wo der Termin stattfinden soll." };
  }

  const bereich = bereichAus(eingabe.bereich);
  if (!bereich) return { ok: false, grund: "Bitte wähle aus, worum es geht." };

  const dauer = eingabe.dauerMinuten;
  if (!dauerGueltig(dauer)) {
    const g = `${KONFIG.dauerMinMinuten} bis ${KONFIG.dauerMaxMinuten} Minuten`;
    return {
      ok: false,
      grund: `Die Dauer muss ${g} betragen, in Schritten von ${KONFIG.dauerSchrittMinuten} Minuten.`,
    };
  }

  const start = new Date(eingabe.startIso);
  if (Number.isNaN(start.getTime())) {
    return { ok: false, grund: "Der gewählte Zeitpunkt ist ungültig." };
  }
  const ende = new Date(start.getTime() + dauer * 60_000);

  // Missbrauchsbremse, bevor irgendetwas Teures passiert.
  const seit = new Date(Date.now() - 86_400_000);
  const proMail = db().anzahlSeit("email", email, seit);
  const proIp = eingabe.ip ? db().anzahlSeit("ip", eingabe.ip, seit) : 0;
  if (proMail >= KONFIG.maxProMailUndTag || proIp >= KONFIG.maxProIpUndTag) {
    return { ok: false, grund: "Es sind schon mehrere Termine offen. Bitte melde dich direkt per Mail." };
  }

  // Verfügbarkeit frisch prüfen; ein Tag Rand deckt den Puffer ab.
  const stand = await getBelegteZeiten(
    new Date(start.getTime() - 86_400_000),
    new Date(ende.getTime() + 86_400_000),
  );

  // Ist eine Quelle ausgefallen, ist der Kalender nicht vollständig bekannt.
  // Dann lieber nicht buchen als doppelt buchen.
  if (stand.fehler.length > 0) {
    return {
      ok: false,
      grund: "Der Kalender ist gerade nicht erreichbar. Bitte versuch es in ein paar Minuten nochmals.",
    };
  }

  // Auch der Abstand zu bereits gebuchten Terminen gilt (PUFFER_EIGENE), nicht
  // nur in der Anzeige. Gegen echte Überlappung schützen zusätzlich die
  // Belegungseinheiten in der Datenbank.
  const eigene = await eigeneBuchungen(
    new Date(start.getTime() - 86_400_000),
    new Date(ende.getTime() + 86_400_000),
  );
  const pruefung = istBuchbar(
    start,
    dauer,
    [...stand.zeiten, ...eigene],
    new Date(),
    OPTIONEN,
    eingabe.mitAnfrage,
  );
  if (!pruefung.ok) return { ok: false, grund: pruefung.grund };
  const aufAnfrage = pruefung.aufAnfrage;

  // Geheimnis für den Absage-Link. Steckt nur in den Mails, nirgends im HTML.
  const token = randomUUID();
  const tokenInhaber = randomUUID();

  let id: string;
  try {
    id = db().anlegen(
      {
        start,
        ende,
        minuten: dauer,
        bereich: bereich.key,
        name,
        email,
        anliegen,
        ort,
        ip: eingabe.ip,
        token,
        tokenInhaber,
      },
      einheitenVon(start, ende),
    );
  } catch (e) {
    // Eine der Fünf-Minuten-Einheiten war schon vergeben: jemand war schneller
    // oder wollte sich überlappend danebenlegen. Die Transaktion ist zurückgerollt.
    if (e instanceof UeberschneidungsFehler) {
      return {
        ok: false,
        grund: "Dieser Termin überschneidet sich mit einer soeben eingegangenen Buchung.",
      };
    }
    throw e;
  }

  // Erst jetzt Mails. Scheitert der Versand, bleibt die Buchung bestehen und
  // ist in der Datenbank sichtbar; ein stiller Verlust wäre schlimmer.
  const { sendeEinladungen } = await import("./mail");
  const versand = await sendeEinladungen({
    id,
    start,
    ende,
    bereich,
    name,
    email,
    anliegen,
    ort,
    aufAnfrage,
    token,
    tokenInhaber,
  });

  return {
    ok: true,
    id,
    start,
    ende,
    minuten: dauer,
    bereichLabel: bereich.label,
    mailAnGast: versand.anGast,
    aufAnfrage,
  };
}

/**
 * Einen gebuchten Termin absagen.
 *
 * Der Token steht im Link der Bestätigungsmail. Wer ihn hat, darf absagen; eine
 * Anmeldung gibt es nicht. Das ist derselbe Weg, den TidyCal und Bookings gehen.
 *
 * Die Buchung selbst bleibt als Verlauf stehen, nur ihre Belegungseinheiten
 * werden entfernt. Genau das gibt den Slot wieder frei, und ohne diesen Schritt
 * bliebe eine abgesagte Zeit für immer blockiert.
 */
/**
 * Wer ist der Absender dieses Links? Der Gast und der Inhaber haben je einen
 * eigenen Token, der Link verrät also, aus welcher Mail er stammt.
 */
function absenderDesLinks(
  b: { token: string | null; tokenInhaber: string | null },
  token: string,
): "gast" | "inhaber" | null {
  if (!token) return null;
  if (b.token && b.token === token) return "gast";
  if (b.tokenInhaber && b.tokenInhaber === token) return "inhaber";
  return null;
}

export async function absagen(
  id: string,
  token: string,
): Promise<{ ok: true; start: Date; name: string } | { ok: false; grund: string }> {
  const b = db().lesen(id);
  const von = b ? absenderDesLinks(b, token) : null;
  if (!b || !von) {
    return { ok: false, grund: "Dieser Absage-Link stimmt nicht." };
  }
  if (b.storniert) return { ok: false, grund: "Dieser Termin ist bereits abgesagt." };

  db().stornieren(id, von);

  const bereich = bereichAus(b.bereich);
  if (bereich) {
    const { sendeAbsage } = await import("./mail");
    await sendeAbsage({
      id: b.id,
      start: b.start,
      ende: b.ende,
      bereich,
      name: b.name,
      email: b.email,
      anliegen: b.anliegen,
      ort: b.ort,
      aufAnfrage: false,
      abgesagtVon: von,
    });
  }

  return { ok: true, start: b.start, name: b.name };
}

/** Die Daten eines Termins für die Absage-Seite. */
export async function terminFuerAbsage(id: string, token: string) {
  const b = db().lesen(id);
  if (!b || !absenderDesLinks(b, token)) return null;
  return {
    start: b.start,
    ende: b.ende,
    minuten: b.minuten,
    name: b.name,
    bereich: bereichAus(b.bereich)?.label ?? b.bereich,
    storniert: b.storniert !== null,
  };
}
