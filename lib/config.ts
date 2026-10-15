/**
 * Alle Stellschrauben der Buchungsseite an einem Ort.
 *
 * Jeder Wert lässt sich über eine Umgebungsvariable übersteuern. Zeiten, Dauer
 * und Bereiche lassen sich so ändern, ohne dass das Abbild neu gebaut wird: ein
 * Neustart des Containers genügt. Eine kommentierte Vorlage aller Variablen
 * steht in `buchung.env.example`.
 */

function zahl(name: string, standard: number): number {
  const roh = process.env[name];
  if (!roh) return standard;
  const wert = Number(roh);
  return Number.isFinite(wert) ? wert : standard;
}

function text(name: string, standard: string): string {
  return process.env[name]?.trim() || standard;
}

/** Name der Person, mit der Termine gebucht werden. Erscheint im Titel und in den Mails. */
export const INHABER_NAME = text("INHABER_NAME", "");

export const KONFIG = {
  /**
   * Raster der möglichen Startzeiten in Minuten. Nicht die Termindauer: die
   * bestimmt der Gast selbst, anders als bei Diensten mit fest vordefinierten
   * Terminarten.
   */
  startRasterMinuten: zahl("START_RASTER_MINUTEN", 15),
  /** Grenzen der frei wählbaren Dauer. */
  dauerMinMinuten: zahl("DAUER_MIN_MINUTEN", 15),
  dauerMaxMinuten: zahl("DAUER_MAX_MINUTEN", 240),
  /**
   * Schrittweite der Dauer. Auf eine Minute gesetzt, damit im Endzeit-Feld jede
   * Uhrzeit eingegeben werden kann. Das Raster der Startzeiten ist davon
   * unabhängig (START_RASTER_MINUTEN).
   */
  dauerSchrittMinuten: zahl("DAUER_SCHRITT_MINUTEN", 1),
  /** Vorbelegte Dauer beim Öffnen der Seite. */
  dauerStandardMinuten: zahl("DAUER_STANDARD_MINUTEN", 60),
  /**
   * Der Mindestabstand zu fremden Terminen hängt am Kalender und steht deshalb
   * in lib/kalender.ts (KALENDER_<NAME>_PUFFER).
   */
  /**
   * Wie kurzfristig darf gebucht werden. Zusammen mit heuteBuchbar: der heutige
   * Tag fällt standardmässig ohnehin weg, der Vorlauf greift zusätzlich am Abend.
   */
  vorlaufStunden: zahl("VORLAUF_STUNDEN", 12),
  /** Darf noch für heute gebucht werden? Standard nein. */
  heuteBuchbar: text("HEUTE_BUCHBAR", "0") === "1",
  /** Wie weit in die Zukunft darf gebucht werden. Standard vier Monate. */
  vorausTage: zahl("VORAUS_TAGE", 120),
  /** Wochentage, an denen überhaupt Termine möglich sind (1 = Montag, 7 = Sonntag). */
  arbeitstage: text("ARBEITSTAGE", "1,2,3,4,5")
    .split(",")
    .map((t) => Number(t.trim()))
    .filter((t) => t >= 1 && t <= 7),
  /** Bürozeit in lokaler Zeit. */
  vonUhr: text("VON_UHR", "08:00"),
  bisUhr: text("BIS_UHR", "17:00"),
  /**
   * Randzeiten, die nur auf ausdrückliche Anfrage buchbar sind, etwa eine
   * Sitzung um 19 Uhr. Der Gast schaltet sie über `?anfrage=1` ein, und in der
   * Mail steht, dass der Termin ausserhalb der Bürozeit liegt.
   */
  anfrageVonUhr: text("ANFRAGE_VON_UHR", "07:00"),
  anfrageBisUhr: text("ANFRAGE_BIS_UHR", "20:00"),
  /** Abstand zu Terminen, die bereits über diese Seite gebucht wurden. */
  pufferEigene: zahl("PUFFER_EIGENE", 15),
  /** Höchstzahl Buchungen je Absender und Tag, gegen Missbrauch. */
  maxProMailUndTag: zahl("MAX_PRO_MAIL_TAG", 3),
  maxProIpUndTag: zahl("MAX_PRO_IP_TAG", 5),
  /**
   * Angaben für Impressum und Datenschutz. Bewusst leer vorbelegt: lieber ein
   * sichtbarer Hinweis auf der Seite als erfundene Angaben.
   */
  impressum: {
    name: text("IMPRESSUM_NAME", ""),
    adresse: text("IMPRESSUM_ADRESSE", ""),
    mail: text("IMPRESSUM_MAIL", ""),
    telefon: text("IMPRESSUM_TELEFON", ""),
    /** Wer die Mails versendet, etwa «Gmail (Google Ireland Limited)». */
    mailDienst: text("DATENSCHUTZ_MAILDIENST", ""),
    /** Wo der Server steht, etwa «der Schweiz» oder «der Europäischen Union». */
    serverOrt: text("DATENSCHUTZ_SERVERORT", ""),
  },
  /** Anzeigename und Titel der Seite. */
  titel: text("SEITEN_TITEL", INHABER_NAME ? `Termin mit ${INHABER_NAME} buchen` : "Termin buchen"),
} as const;

export type BereichKey = string;

export type Bereich = {
  key: BereichKey;
  label: string;
  /** Adresse, an die die Einladung geht. Bestimmt, in welchem Kalender der Termin landet. */
  mail: string;
  hinweis: string;
};

/** Liste aus einer Umgebungsvariablen, durch Komma getrennt, ohne leere Teile. */
function liste(name: string, standard = ""): string[] {
  return text(name, standard)
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

/** Schlüssel eines Bereichs als Teil eines Variablennamens: `beratung` wird `BERATUNG`. */
function envTeil(key: string): string {
  return key.toUpperCase().replace(/[^A-Z0-9]/g, "_");
}

/**
 * Die Bereiche, für die Termine gebucht werden können.
 *
 * Ein Bereich ist eine Rolle mit eigener Zieladresse, etwa «Beratung» an die
 * Geschäftsadresse und «Privat» an die private. Die Einladung geht an diese
 * Adresse, damit der Termin im passenden Kalender landet.
 *
 * Konfiguration über die Umgebung:
 *
 *     BEREICHE=beratung,privat
 *     BEREICH_BERATUNG_NAME=Beratung
 *     BEREICH_BERATUNG_MAIL=hallo@example.com
 *     BEREICH_BERATUNG_HINWEIS=Projekte und Zusammenarbeit
 *
 * Der Schlüssel ist zugleich der kurze Pfad: /beratung zeigt nur diesen Bereich.
 */
/** Pfade, die die Seite selbst belegt und die deshalb kein Bereich heissen darf. */
const RESERVIERT = new Set(["impressum", "absagen", "marke", "api", "_next"]);
const SCHLUESSEL = /^[a-z0-9-]+$/;
/**
 * Gültige Mailadresse, ohne Zeichen, die in Mail-Kopfzeilen oder iCalendar eine
 * Bedeutung haben, und ohne unsichtbare Steuer- und Formatzeichen. Gilt für die
 * Zieladressen der Bereiche und für die Adresse der Gäste.
 */
export function istMailadresse(wert: string): boolean {
  return ADRESSE.test(wert) && !/\p{C}/u.test(wert);
}
const ADRESSE = /^[^\s@;:,"<>()[\]\\]+@[^\s@;:,"<>()[\]\\]+\.[^\s@;:,"<>()[\]\\]{2,}$/;

/**
 * Bereiche mit ungültigem Schlüssel oder ohne gültige Zieladresse werden nicht
 * angeboten. Ohne Adresse wäre die Buchung zwar gespeichert, aber die
 * Einladung käme nirgends an; der Gast hielte den Termin für bestätigt.
 */
export const BEREICHE: Bereich[] = liste("BEREICHE", "termin")
  .map((key) => {
    const k = envTeil(key);
    return {
      key,
      label: text(`BEREICH_${k}_NAME`, key.charAt(0).toUpperCase() + key.slice(1)),
      mail: text(`BEREICH_${k}_MAIL`, text("INHABER_MAIL", "")),
      hinweis: text(`BEREICH_${k}_HINWEIS`, ""),
    };
  })
  .filter((b) => {
    if (!SCHLUESSEL.test(b.key) || RESERVIERT.has(b.key)) {
      console.warn(`[konfig] Bereich «${b.key}» übersprungen: nur Kleinbuchstaben, Ziffern und Bindestrich, nicht ${[...RESERVIERT].join(", ")}.`);
      return false;
    }
    if (!istMailadresse(b.mail)) {
      console.warn(`[konfig] Bereich «${b.key}» übersprungen: BEREICH_${envTeil(b.key)}_MAIL (oder INHABER_MAIL) fehlt oder ist ungültig.`);
      return false;
    }
    return true;
  });

export function bereichAus(key: string): Bereich | null {
  return BEREICHE.find((b) => b.key === key) ?? null;
}

/**
 * Welche Bereiche ein Besucher zur Auswahl bekommt.
 *
 * Ohne Angabe nur die in BEREICHE_OEFFENTLICH genannten (Standard: alle). So
 * bleibt etwa ein privater Bereich unsichtbar und ist nur über seinen eigenen
 * Link erreichbar, zum Beispiel /privat.
 */
export function sichtbareBereiche(fuer?: string): Bereich[] {
  if (fuer) {
    const einer = bereichAus(fuer);
    if (einer) return [einer];
  }
  const offen = liste("BEREICHE_OEFFENTLICH", BEREICHE.map((b) => b.key).join(","));
  return BEREICHE.filter((b) => offen.includes(b.key));
}

export function dauerGueltig(minuten: number): boolean {
  return (
    Number.isInteger(minuten) &&
    minuten >= KONFIG.dauerMinMinuten &&
    minuten <= KONFIG.dauerMaxMinuten &&
    (minuten - KONFIG.dauerMinMinuten) % KONFIG.dauerSchrittMinuten === 0
  );
}

/** Dauer als lesbarer Text, etwa «1 Std 30 Min». */
export function dauerText(minuten: number): string {
  const std = Math.floor(minuten / 60);
  const min = minuten % 60;
  if (std === 0) return `${min} Min`;
  if (min === 0) return `${std} Std`;
  return `${std} Std ${min} Min`;
}

/**
 * Wochenmuster je Bereich: Zeiten, zu denen Termine besonders gut passen.
 *
 * Termine passen am besten in Blöcke, die ohnehin dem jeweiligen Bereich
 * gehören, statt einen anderen Tag zu unterbrechen. Solche Tage sind im
 * Monatskalender markiert. Gesperrt wird nichts, es ist nur eine Empfehlung.
 *
 * Schreibweise: `BEREICH_<NAME>_WUNSCHZEITEN=mo,di-vormittag,mi-nachmittag`. Ohne
 * Zusatz gilt der ganze Tag. Ist für einen Bereich nichts gesetzt, ist jeder Tag
 * gleich gut.
 */
export type Wunschzeit = { wochentag: number; haelfte: "vormittag" | "nachmittag" | "ganz" };

const WOCHENTAGE: Record<string, number> = {
  mo: 1, di: 2, mi: 3, do: 4, fr: 5, sa: 6, so: 7,
};

/** Grenze zwischen Vormittag und Nachmittag, in Minuten seit Mitternacht. */
export const MITTAGSGRENZE = 12 * 60;

function wunschzeitenAus(roh: string): Wunschzeit[] {
  return roh
    .split(",")
    .map((teil) => teil.trim().toLowerCase())
    .filter(Boolean)
    .map((teil) => {
      const [tag, haelfte] = teil.split("-");
      const wochentag = WOCHENTAGE[tag];
      if (!wochentag) return null;
      return {
        wochentag,
        haelfte:
          haelfte === "vormittag" || haelfte === "nachmittag" ? haelfte : ("ganz" as const),
      };
    })
    .filter((w): w is Wunschzeit => w !== null);
}

export function wunschzeiten(bereich: BereichKey): Wunschzeit[] {
  return wunschzeitenAus(text(`BEREICH_${envTeil(bereich)}_WUNSCHZEITEN`, ""));
}

/** Passt dieser Zeitpunkt ins Wochenmuster des Bereichs? */
export function istWunschzeit(d: Date, bereich: BereichKey): boolean {
  const liste = wunschzeiten(bereich);
  if (liste.length === 0) return false;
  const wochentag = d.getDay() === 0 ? 7 : d.getDay();
  const minute = d.getHours() * 60 + d.getMinutes();
  return liste.some(
    (w) =>
      w.wochentag === wochentag &&
      (w.haelfte === "ganz" ||
        (w.haelfte === "vormittag" ? minute < MITTAGSGRENZE : minute >= MITTAGSGRENZE)),
  );
}

/** Gibt es an diesem Tag überhaupt eine Wunschzeit für den Bereich? */
export function istWunschtag(tag: string, bereich: BereichKey): boolean {
  const [j, m, t] = tag.split("-").map(Number);
  const d = new Date(j, m - 1, t);
  const wochentag = d.getDay() === 0 ? 7 : d.getDay();
  return wunschzeiten(bereich).some((w) => w.wochentag === wochentag);
}

/** Wie das Wochenmuster eines Bereichs in Worten heisst, für den Hinweis auf der Seite. */
export function wunschzeitText(bereich: BereichKey): string | null {
  const liste = wunschzeiten(bereich);
  if (liste.length === 0) return null;
  const namen = ["", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"];
  return liste
    .map((w) => {
      const tag = namen[w.wochentag];
      if (w.haelfte === "ganz") return tag;
      return `${tag} ${w.haelfte === "vormittag" ? "vormittags" : "nachmittags"}`;
    })
    .join(", ");
}

/**
 * Ferien und andere besondere Zeiträume.
 *
 * Sie sperren nichts: gebucht werden kann weiter. Sie sind nur eine Markierung
 * im Kalender, damit ein Gast sieht, dass er einen Termin in eine Ferienwoche
 * legt. Wer in den Ferien nicht buchbar sein will, trägt sie in seinen Kalender
 * ein; dann blockieren sie wie jeder andere Eintrag.
 *
 * Schreibweise in der Umgebung, mehrere durch Komma getrennt:
 * `2027-04-10:2027-04-25:Frühlingsferien,2027-12-20:2028-01-02:Weihnachtsferien`
 */
export type Ferienzeit = { von: string; bis: string; name: string };

export function ferienzeiten(): Ferienzeit[] {
  return text("FERIEN", "")
    .split(",")
    .map((teil) => teil.trim())
    .filter(Boolean)
    .map((teil) => {
      const [von, bis, ...rest] = teil.split(":");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(von ?? "") || !/^\d{4}-\d{2}-\d{2}$/.test(bis ?? "")) {
        return null;
      }
      return { von, bis, name: rest.join(":").trim() || "Ferien" };
    })
    .filter((f): f is Ferienzeit => f !== null);
}

/**
 * Für welche Bereiche werden Ferien überhaupt angezeigt?
 *
 * Über FERIEN_BEREICHE (Komma getrennt), Standard: alle. Was für einen Bereich
 * wichtig ist, ist für einen anderen oft nur Ablenkung.
 */
export function zeigtFerien(bereich: BereichKey | null | undefined): boolean {
  if (!bereich) return false;
  const roh = text("FERIEN_BEREICHE", "");
  if (!roh) return true;
  return liste("FERIEN_BEREICHE").includes(bereich);
}

/** In welche Ferienzeit fällt dieser Tag, falls überhaupt? */
export function ferienAm(tag: string): Ferienzeit | null {
  return ferienzeiten().find((f) => tag >= f.von && tag <= f.bis) ?? null;
}

/** Alle Tage eines Monats, die in eine Ferienzeit fallen, mit ihrem Namen. */
export function ferientageIm(jahr: number, monat: number): Record<string, string> {
  const tage: Record<string, string> = {};
  const anzahl = new Date(jahr, monat, 0).getDate();
  for (let t = 1; t <= anzahl; t++) {
    const tag = `${jahr}-${String(monat).padStart(2, "0")}-${String(t).padStart(2, "0")}`;
    const f = ferienAm(tag);
    if (f) tage[tag] = f.name;
  }
  return tage;
}

/**
 * Zeigt dieser Bereich empfohlene Zeiten, oder sind alle freien Zeiten gleichwertig?
 *
 * Empfohlen werden Zeiten, die den Tag nicht zerstückeln (Tagesbeginn,
 * Anschluss an bestehende Termine, Tagesende). Mit
 * `BEREICH_<NAME>_EMPFEHLUNGEN=0` stehen alle freien Zeiten gleichwertig in einer
 * Liste, etwa für einen Bereich, in dem jeder Termin willkommen ist.
 */
export function zeigtEmpfehlungen(bereich: BereichKey): boolean {
  const roh = process.env[`BEREICH_${envTeil(bereich)}_EMPFEHLUNGEN`];
  if (roh === undefined || roh === "") return true;
  return roh !== "0" && roh.toLowerCase() !== "aus" && roh.toLowerCase() !== "nein";
}

/**
 * Auftritt je Bereich: Logo und Akzentfarbe.
 *
 *     BEREICH_BERATUNG_AKZENT=#0f766e
 *     BEREICH_BERATUNG_LOGO=/marke/firma.png   (Datei in public/marke/)
 *     BEREICH_BERATUNG_LOGO_ALT=Firma AG
 */
export type Marke = {
  logo: string | null;
  logoAlt: string;
  /** Akzent als CSS-Farbe. Flächen und Rahmen leitet die Seite daraus ab. */
  akzent: string;
};

const STANDARD_AKZENT = "#3b82f6";

/** Nur Hex-Farben, damit aus der Umgebung kein beliebiges CSS in die Seite gelangt. */
function farbe(roh: string): string {
  return /^#[0-9a-fA-F]{3,8}$/.test(roh) ? roh : STANDARD_AKZENT;
}

export function marke(bereich: BereichKey | null | undefined): Marke {
  if (!bereich) return { logo: null, logoAlt: "", akzent: STANDARD_AKZENT };
  const k = envTeil(bereich);
  const logo = text(`BEREICH_${k}_LOGO`, "");
  return {
    // Nur Pfade auf der eigenen Seite, passend zur Content-Security-Policy.
    logo: logo.startsWith("/") && !logo.startsWith("//") ? logo : null,
    logoAlt: text(`BEREICH_${k}_LOGO_ALT`, ""),
    akzent: farbe(text(`BEREICH_${k}_AKZENT`, STANDARD_AKZENT)),
  };
}
