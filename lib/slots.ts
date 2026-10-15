import type { Belegt } from "./kalender";

/**
 * Rechnet aus belegten Zeiten und den Regeln die buchbaren Startzeiten.
 *
 * Diese Datei enthält keine Ein- und Ausgabe, damit sie vollständig testbar ist:
 * hier entstehen Doppelbuchungen, wenn etwas falsch gerechnet wird.
 *
 * Kernidee: die Startzeiten richten sich
 * an den freien Lücken aus, nicht an einem starren Raster ab Tagesbeginn. Endet
 * ein Termin um 16:15 und braucht 30 Minuten Abstand, ist die nächste Startzeit
 * 16:45 und nicht erst 17:00. Mit einem starren Raster fiele eine
 * Dreiviertelstunde einfach weg.
 *
 * Alle Zeiten sind lokale Zeit. Der Container läuft in der Zeitzone aus TZ.
 */

export type SlotOptionen = {
  /** Abstand zwischen zwei Startzeiten innerhalb derselben Lücke. */
  startRasterMinuten: number;
  vorlaufStunden: number;
  /** Darf noch für heute gebucht werden? Standard nein. */
  heuteBuchbar?: boolean;
  vorausTage: number;
  /** 1 = Montag bis 7 = Sonntag. */
  arbeitstage: number[];
  /** Bürozeit. */
  vonUhr: string;
  bisUhr: string;
  /**
   * Erweitertes Fenster, in dem nur auf Anfrage gebucht werden kann (Randzeiten
   * wie eine Sitzung um 19 Uhr). Gleich der Bürozeit heisst: keine Randzeiten.
   */
  anfrageVonUhr: string;
  anfrageBisUhr: string;
};

export type Slot = {
  start: Date;
  ende: Date;
  frei: boolean;
  /** Liegt ausserhalb der Bürozeit und braucht die Zustimmung des Inhabers. */
  aufAnfrage: boolean;
  /**
   * Warum diese Zeit vorgeschlagen wird, oder null für «geht auch, zerschneidet
   * aber einen Arbeitsblock».
   *
   * Hintergrund: ein Termin um 10:00 zerreisst den
   * Vormittag in zwei unbrauchbare Hälften, einer um 07:00 oder direkt vor dem
   * Mittag nicht. Empfohlen wird deshalb, was an einem Rand liegt.
   */
  empfehlung: Empfehlung;
};

/**
 * Warum eine Zeit vorgeschlagen wird. Die Benennung ist keine Kosmetik: «14:30
 * Tagesbeginn» wäre irreführend, gemeint ist dann der Anfang eines Blocks.
 */
export type Empfehlung =
  | "tagesbeginn"
  | "anschliessend"
  | "mittag"
  | "vorpause"
  | "tagesende"
  | null;

export type SlotEingabe = {
  /** Erster Tag, Format JJJJ-MM-TT. */
  vonTag: string;
  /** Letzter Tag, einschliesslich. */
  bisTag: string;
  /** Vom Gast gewählte Länge des Termins in Minuten. */
  dauerMinuten: number;
  belegt: Belegt[];
  jetzt: Date;
  optionen: SlotOptionen;
  /** Randzeiten mitliefern? Ohne das endet der Tag an der Bürozeit. */
  mitAnfrage?: boolean;
};

/** Auf welches Raster die Startzeiten fallen, wenn eine Lücke krumm beginnt. */
const RUNDUNG_MINUTEN = 5;

/**
 * Fenster, in dem ein Terminbeginn als Mittagszeit gilt. Bewusst eng: mit zwei
 * Stunden Fenster und Viertelstundenraster standen sechs fast gleiche Vorschläge
 * nebeneinander, was den Zweck der Auswahl zunichtemacht.
 */
const MITTAG_VON = 11 * 60 + 45;
const MITTAG_BIS = 12 * 60 + 30;

function minutenAusUhrzeit(uhr: string): number {
  const [h, m] = uhr.split(":").map(Number);
  return h * 60 + (m || 0);
}

/** Wochentag als 1 (Montag) bis 7 (Sonntag); getDay() liefert 0 für Sonntag. */
function wochentag(d: Date): number {
  const tag = d.getDay();
  return tag === 0 ? 7 : tag;
}

/**
 * Der früheste buchbare Zeitpunkt.
 *
 * Zwei Bedingungen zugleich: der Vorlauf in Stunden, und der heutige Tag fällt
 * ganz weg (ausser mit HEUTE_BUCHBAR=1). Am Abend wirkt damit der Vorlauf, am
 * Morgen die Tagesgrenze; es gilt immer die spätere der beiden.
 */
function fruehesterStart(jetzt: Date, optionen: SlotOptionen): Date {
  const nachVorlauf = new Date(jetzt.getTime() + optionen.vorlaufStunden * 3600_000);
  if (optionen.heuteBuchbar) return nachVorlauf;

  const morgen = new Date(jetzt);
  morgen.setDate(morgen.getDate() + 1);
  morgen.setHours(0, 0, 0, 0);
  return morgen > nachVorlauf ? morgen : nachVorlauf;
}

function tagAusText(tag: string): Date {
  const [j, m, t] = tag.split("-").map(Number);
  return new Date(j, m - 1, t, 0, 0, 0, 0);
}

export function tagText(d: Date): string {
  const j = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const t = String(d.getDate()).padStart(2, "0");
  return `${j}-${m}-${t}`;
}

type Spanne = { start: Date; ende: Date };

/**
 * Belegte Zeiten um ihren jeweiligen Puffer erweitern und überlappende
 * zusammenfassen.
 *
 * Der Puffer hängt am Kalender, nicht am Termin: zu Terminen mit Anfahrt etwa
 * 30 Minuten Abstand, zu Besprechungen im Haus 5. Nach dem Zusammenfassen
 * bleibt eine Liste sich nicht überschneidender Sperren, gegen die sich billig
 * prüfen lässt.
 */
export function sperrenBilden(belegt: Belegt[]): Spanne[] {
  const erweitert = belegt
    .map((b) => ({
      start: new Date(b.start.getTime() - b.puffer * 60_000),
      ende: new Date(b.ende.getTime() + b.puffer * 60_000),
    }))
    .sort((a, b) => a.start.getTime() - b.start.getTime());

  const zusammen: Spanne[] = [];
  for (const s of erweitert) {
    const letzte = zusammen[zusammen.length - 1];
    if (letzte && s.start.getTime() <= letzte.ende.getTime()) {
      if (s.ende > letzte.ende) letzte.ende = s.ende;
    } else {
      zusammen.push({ start: s.start, ende: s.ende });
    }
  }
  return zusammen;
}

/** Die freien Abschnitte zwischen den Sperren innerhalb eines Fensters. */
export function freieLuecken(von: Date, bis: Date, sperren: Spanne[]): Spanne[] {
  const luecken: Spanne[] = [];
  let cursor = von;

  for (const s of sperren) {
    if (s.ende <= cursor) continue;
    if (s.start > cursor) {
      const ende = s.start < bis ? s.start : bis;
      if (ende > cursor) luecken.push({ start: cursor, ende });
    }
    if (s.ende > cursor) cursor = s.ende;
    if (cursor >= bis) break;
  }
  if (cursor < bis) luecken.push({ start: cursor, ende: bis });

  return luecken;
}

/** Auf die nächste Fünf-Minuten-Grenze aufrunden, damit Startzeiten lesbar bleiben. */
function aufRasterAuf(d: Date): Date {
  const schritt = RUNDUNG_MINUTEN * 60_000;
  const auf = Math.ceil(d.getTime() / schritt) * schritt;
  return new Date(auf);
}

/** Das Tagesfenster in lokaler Zeit, getrennt nach Bürozeit und Randzeiten. */
function tagesFenster(
  tag: Date,
  optionen: SlotOptionen,
  mitAnfrage: boolean,
): { von: Date; bis: Date; buroVon: Date; buroBis: Date } {
  const setze = (minuten: number) => {
    const d = new Date(tag);
    d.setHours(0, minuten, 0, 0);
    return d;
  };
  const buroVon = setze(minutenAusUhrzeit(optionen.vonUhr));
  const buroBis = setze(minutenAusUhrzeit(optionen.bisUhr));
  if (!mitAnfrage) return { von: buroVon, bis: buroBis, buroVon, buroBis };

  const von = setze(Math.min(minutenAusUhrzeit(optionen.anfrageVonUhr), minutenAusUhrzeit(optionen.vonUhr)));
  const bis = setze(Math.max(minutenAusUhrzeit(optionen.anfrageBisUhr), minutenAusUhrzeit(optionen.bisUhr)));
  return { von, bis, buroVon, buroBis };
}

export function berechneSlots({
  vonTag,
  bisTag,
  dauerMinuten,
  belegt,
  jetzt,
  optionen,
  mitAnfrage = false,
}: SlotEingabe): Slot[] {
  const { startRasterMinuten, vorausTage, arbeitstage } = optionen;

  const fruehestens = fruehesterStart(jetzt, optionen);
  const spaetestens = new Date(jetzt.getTime() + vorausTage * 86_400_000);
  const sperren = sperrenBilden(belegt);

  const slots: Slot[] = [];
  const letzterTag = tagAusText(bisTag);

  for (let tag = tagAusText(vonTag); tag <= letzterTag; tag.setDate(tag.getDate() + 1)) {
    if (!arbeitstage.includes(wochentag(tag))) continue;

    const { von, bis, buroVon, buroBis } = tagesFenster(tag, optionen, mitAnfrage);

    const rasterMs = startRasterMinuten * 60_000;

    for (const luecke of freieLuecken(von, bis, sperren)) {
      // Zwei Arten von Startzeiten, damit nichts verlorengeht:
      // 1. der Anfang der Lücke selbst, auf fünf Minuten aufgerundet. Endet ein
      //    Termin um 16:15 und braucht 30 Minuten Abstand, ist das 16:45.
      // 2. die runden Zeiten des Tagesrasters, soweit sie in die Lücke fallen,
      //    also 17:00, 17:15 und so weiter.
      // Nur den Lückenanfang zu nehmen würde runde Zeiten verschlucken, nur das
      // Raster würde den frühestmöglichen Beginn verschenken.
      const kandidaten = new Set<number>();
      kandidaten.add(aufRasterAuf(luecke.start).getTime());
      for (let t = von.getTime(); t < luecke.ende.getTime(); t += rasterMs) {
        if (t >= luecke.start.getTime()) kandidaten.add(t);
      }

      for (const zeit of [...kandidaten].sort((a, b) => a - b)) {
        const start = new Date(zeit);
        const ende = new Date(zeit + dauerMinuten * 60_000);
        if (ende.getTime() > luecke.ende.getTime()) continue;
        const imFenster = start >= fruehestens && start <= spaetestens;
        const ausserhalbBuro = start < buroVon || ende > buroBis;

        // Am Rand der Lücke stört der Termin nichts: davor oder danach war
        // ohnehin schon Schluss. In der Mitte zerschneidet er einen Block.
        const amAnfang = zeit - luecke.start.getTime() < rasterMs;
        const amEnde = luecke.ende.getTime() - ende.getTime() < rasterMs;
        const startMinute = start.getHours() * 60 + start.getMinutes();
        const ueberMittag = startMinute >= MITTAG_VON && startMinute <= MITTAG_BIS;

        // Nicht der Index der Lücke entscheidet, sondern ob sie wirklich am
        // Tagesrand liegt. Beginnt der Tag mit einem fremden Termin, ist die
        // erste Lücke kein Tagesbeginn, sondern ein Anschluss.
        const ersterBlock = luecke.start.getTime() <= von.getTime();
        const letzterBlock = luecke.ende.getTime() >= bis.getTime();

        const empfehlung: Empfehlung = amAnfang
          ? ersterBlock
            ? "tagesbeginn"
            : "anschliessend"
          : amEnde
            ? letzterBlock
              ? "tagesende"
              : "vorpause"
            : ueberMittag
              ? "mittag"
              : null;

        slots.push({ start, ende, frei: imFenster, aufAnfrage: ausserhalbBuro, empfehlung });
      }
    }
  }

  slots.sort((a, b) => a.start.getTime() - b.start.getTime());
  return slots;
}

/**
 * Prüft einen einzelnen Wunschtermin gegen dieselben Regeln.
 *
 * Wird beim Buchen serverseitig aufgerufen: was das Browserfenster anzeigt, ist
 * nur ein Vorschlag, verbindlich ist ausschliesslich diese Prüfung.
 */
export function istBuchbar(
  start: Date,
  dauerMinuten: number,
  belegt: Belegt[],
  jetzt: Date,
  optionen: SlotOptionen,
  mitAnfrage = false,
): { ok: true; aufAnfrage: boolean } | { ok: false; grund: string } {
  const ende = new Date(start.getTime() + dauerMinuten * 60_000);

  if (!optionen.arbeitstage.includes(wochentag(start))) {
    return { ok: false, grund: "An diesem Wochentag sind keine Termine möglich." };
  }

  const tag = new Date(start);
  tag.setHours(0, 0, 0, 0);
  const { von, bis, buroVon, buroBis } = tagesFenster(tag, optionen, mitAnfrage);

  if (start < von || ende > bis) {
    return { ok: false, grund: "Diese Zeit liegt ausserhalb der buchbaren Stunden." };
  }

  const fruehestens = fruehesterStart(jetzt, optionen);
  if (start < fruehestens) {
    return {
      ok: false,
      grund: `Termine sind frühestens ab morgen und mit ${optionen.vorlaufStunden} Stunden Vorlauf möglich.`,
    };
  }

  const spaetestens = new Date(jetzt.getTime() + optionen.vorausTage * 86_400_000);
  if (start > spaetestens) return { ok: false, grund: "Dieser Termin liegt zu weit in der Zukunft." };

  for (const s of sperrenBilden(belegt)) {
    if (start < s.ende && ende > s.start) {
      return { ok: false, grund: "Dieser Termin ist inzwischen belegt." };
    }
  }

  return { ok: true, aufAnfrage: start < buroVon || ende > buroBis };
}

/**
 * Wie lange kann ein Termin ab dieser Startzeit höchstens dauern?
 *
 * Gebraucht für den dritten Schritt der Buchung: erst wählt der Gast Tag und
 * Uhrzeit, danach die Länge. Angeboten werden darf nur, was hineinpasst.
 */
export function maxDauerAb(
  start: Date,
  belegt: Belegt[],
  jetzt: Date,
  optionen: SlotOptionen,
  hoechstens: number,
  mitAnfrage = false,
): number {
  // Mit einer Minute Dauer prüfen: es geht nur darum, ob die Startzeit selbst
  // zulässig und frei ist. Wie lange es reicht, rechnet der Rest.
  if (!istBuchbar(start, 1, belegt, jetzt, optionen, mitAnfrage).ok) return 0;

  const tag = new Date(start);
  tag.setHours(0, 0, 0, 0);
  const { bis } = tagesFenster(tag, optionen, mitAnfrage);

  let moeglich = Math.floor((bis.getTime() - start.getTime()) / 60_000);

  for (const s of sperrenBilden(belegt)) {
    if (s.start <= start) continue;
    const bisDahin = Math.floor((s.start.getTime() - start.getTime()) / 60_000);
    if (bisDahin < moeglich) moeglich = bisDahin;
  }

  if (moeglich > hoechstens) moeglich = hoechstens;
  return moeglich > 0 ? moeglich : 0;
}

/**
 * Alle Startzeiten eines Tages mit der jeweils möglichen Höchstdauer.
 * Startzeiten ohne Platz für die Mindestdauer fallen weg.
 */
export function tagesStartzeiten(
  tag: string,
  belegt: Belegt[],
  jetzt: Date,
  optionen: SlotOptionen,
  mindestens: number,
  hoechstens: number,
  mitAnfrage = false,
): { start: Date; maxDauer: number; aufAnfrage: boolean; empfehlung: Empfehlung }[] {
  const slots = berechneSlots({
    vonTag: tag,
    bisTag: tag,
    dauerMinuten: mindestens,
    belegt,
    jetzt,
    optionen,
    mitAnfrage,
  });

  return slots
    .filter((s) => s.frei)
    .map((s) => ({
      start: s.start,
      maxDauer: maxDauerAb(s.start, belegt, jetzt, optionen, hoechstens, mitAnfrage),
      aufAnfrage: s.aufAnfrage,
      empfehlung: s.empfehlung,
    }))
    .filter((s) => s.maxDauer >= mindestens);
}

/** Slots nach Tag gruppiert. */
export function nachTagen(slots: Slot[]): { tag: string; slots: Slot[] }[] {
  const gruppen = new Map<string, Slot[]>();
  for (const s of slots) {
    const key = tagText(s.start);
    const liste = gruppen.get(key);
    if (liste) liste.push(s);
    else gruppen.set(key, [s]);
  }
  return [...gruppen.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([tag, slots]) => ({ tag, slots }));
}
