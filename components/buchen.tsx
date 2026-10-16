"use client";

import { useState, useTransition, useActionState } from "react";
import { useRouter } from "next/navigation";
import { buchungAnlegen } from "@/app/actions";

/**
 * Die Buchung in vier Schritten, im Aufbau von TidyCal und Microsoft Bookings:
 * erst der Tag im Monatskalender, dann die Uhrzeit, dann die Länge, dann die
 * Angaben zur Person.
 *
 * Der Weg über den Monatskalender ist übersichtlicher als eine lange
 * Wochenliste. Er hat einen zweiten Vorteil: die Dauer
 * lässt sich erst wählen, wenn die Startzeit feststeht, und dann nur so lang,
 * wie es dort tatsächlich reicht.
 */

type ZeitDaten = {
  startIso: string;
  maxDauer: number;
  aufAnfrage: boolean;
  empfehlung: "tagesbeginn" | "anschliessend" | "mittag" | "vorpause" | "tagesende" | null;
  wunschzeit: boolean;
};

type BereichDaten = { key: string; label: string; hinweis: string };

type MarkeDaten = {
  logo: string | null;
  logoAlt: string;
  akzent: string;
};

type Props = {
  jahr: number;
  monat: number;
  /** Tage des Monats, an denen mindestens eine Zeit frei ist. */
  freieTage: string[];
  /** Davon jene, die ins Wochenmuster des Bereichs passen. */
  wunschTage: string[];
  /** Tage des angezeigten Monats, die in eine Ferienzeit fallen, mit deren Namen. */
  ferientage: Record<string, string>;
  /** Name der Ferienzeit des gewählten Tages, falls er in eine fällt. */
  ferienHeute: string | null;
  /** Gewählter Tag, falls einer in der Adresse steht. */
  tag: string | null;
  zeiten: ZeitDaten[];
  /** Ausgefallene Kalenderquellen. Ist das nicht leer, wird nicht gebucht. */
  fehler: string[];
  bereiche: BereichDaten[];
  /** Gewählter Bereich, oder null solange keiner feststeht. */
  bereich: string | null;
  bereichLabel: string | null;
  /** Wochenmuster in Worten, etwa «Montag vormittags». */
  wunschText: string | null;
  /** Wie weit im Voraus gebucht werden kann, in Monaten (gerundet). */
  vorausMonate: number;
  /** Teilt dieser Bereich die Zeiten in bevorzugte und weitere? */
  mitEmpfehlungen: boolean;
  /** Adresse für Anfragen, die über das Fenster hinausgehen. */
  anfrageMail: string | null;
  /** Auf einen Bereich eingeschränkt, über ?fuer=... */
  fuer: string | null;
  /** Randzeiten ausserhalb der Bürozeit sind eingeschaltet. */
  mitAnfrage: boolean;
  buroVon: string;
  buroBis: string;
  dauerMin: number;
  dauerSchritt: number;
  dauerStandard: number;
  titel: string;
  /** Grenzen der Monatsnavigation, Format JJJJ-MM. */
  ersterMonat: string;
  letzterMonat: string;
  /** Logo und Akzentfarbe des gewählten Bereichs. */
  marke: MarkeDaten;
};

const WOCHENTAGE = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];


function dauerText(minuten: number): string {
  const std = Math.floor(minuten / 60);
  const min = minuten % 60;
  if (std === 0) return `${min} Min`;
  if (min === 0) return `${std} Std`;
  return `${std} Std ${min} Min`;
}

/**
 * Eine getippte Uhrzeit in Minuten ab dem Beginn.
 *
 * Nimmt entgegen, was Menschen tippen: «9:30», «09:30», «930», «0930». Gibt null
 * zurück, wenn daraus keine Uhrzeit wird; dann bleibt der bisherige Wert stehen.
 */
function minutenAus(eingabe: string, startMs: number, startTag: Date): number | null {
  const roh = eingabe.trim().replace(/[.\s]/g, ":");
  let stunde: number;
  let minute: number;

  const mitDoppelpunkt = roh.match(/^(\d{1,2}):(\d{1,2})$/);
  const nurZiffern = roh.match(/^(\d{3,4})$/);

  if (mitDoppelpunkt) {
    stunde = Number(mitDoppelpunkt[1]);
    minute = Number(mitDoppelpunkt[2]);
  } else if (nurZiffern) {
    const z = nurZiffern[1].padStart(4, "0");
    stunde = Number(z.slice(0, 2));
    minute = Number(z.slice(2));
  } else {
    return null;
  }

  if (stunde > 23 || minute > 59) return null;

  const endeMs = new Date(startTag).setHours(stunde, minute, 0, 0);
  return Math.round((endeMs - startMs) / 60_000);
}

/** Millisekunden als HH:MM in Ortszeit. */
function alsUhrzeit(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function uhrzeit(iso: string): string {
  return new Date(iso).toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit" });
}

function monatsName(jahr: number, monat: number): string {
  return new Date(jahr, monat - 1, 1).toLocaleDateString("de-CH", { month: "long", year: "numeric" });
}

function tagLang(tag: string): string {
  const [j, m, t] = tag.split("-").map(Number);
  return new Date(j, m - 1, t).toLocaleDateString("de-CH", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

function schluessel(jahr: number, monat: number): string {
  return `${jahr}-${String(monat).padStart(2, "0")}`;
}

/** Die Tageszellen eines Monats, aufgefüllt bis zum Montag der ersten Woche. */
function monatsRaster(jahr: number, monat: number): (string | null)[] {
  const erster = new Date(jahr, monat - 1, 1);
  const anzahl = new Date(jahr, monat, 0).getDate();
  const versatz = (erster.getDay() === 0 ? 7 : erster.getDay()) - 1;

  const zellen: (string | null)[] = Array(versatz).fill(null);
  for (let t = 1; t <= anzahl; t++) {
    zellen.push(`${jahr}-${String(monat).padStart(2, "0")}-${String(t).padStart(2, "0")}`);
  }
  return zellen;
}

/**
 * Akzentfarbe und abgeleitete Töne als CSS-Variablen.
 *
 * Tailwind kann keine dynamischen Farbklassen erzeugen; die Marke steht erst zur
 * Laufzeit fest. Deshalb eine Variable plus color-mix für Fläche und Rand.
 */
function markenStil(m: MarkeDaten): React.CSSProperties {
  return {
    "--akzent": m.akzent,
    "--akzent-flaeche": `color-mix(in srgb, ${m.akzent} 8%, white)`,
    "--akzent-rand": `color-mix(in srgb, ${m.akzent} 30%, white)`,
  } as React.CSSProperties;
}

export function Buchen(props: Props) {
  const router = useRouter();
  const [warte, starte] = useTransition();
  const [zeit, setZeit] = useState<ZeitDaten | null>(null);
  const [dauer, setDauer] = useState(props.dauerStandard);
  /**
   * Roher Text im Endzeit-Feld.
   *
   * Getrennt von der Dauer, weil ein kontrolliertes Feld sonst bei jedem
   * Tastendruck auf einen gültigen Wert zurückspringt: wer «09:30» tippen will,
   * kommt über die erste Ziffer nicht hinaus. Übernommen wird erst beim
   * Verlassen des Feldes.
   */
  const [endeText, setEndeText] = useState<string | null>(null);
  const [imFormular, setImFormular] = useState(false);
  const [ergebnis, aktion, laeuft] = useActionState(buchungAnlegen, null);


  // Der Anfrage-Schalter und die Ansicht hängen an der Adresse, weil der Server
  // die Zeiten dafür neu rechnen muss.
  const zusatz =
    (props.mitAnfrage ? "&anfrage=1" : "") +
    (props.fuer ? `&fuer=${props.fuer}` : "") +
    (props.bereich && !props.fuer ? `&bereich=${props.bereich}` : "");
  const geheZu = (ziel: string) => starte(() => router.push(ziel + zusatz, { scroll: false }));

  const schalteAnfrage = () => {
    const basis = props.tag
      ? `/?tag=${props.tag}`
      : `/?monat=${schluessel(props.jahr, props.monat)}`;
    const neu = props.mitAnfrage ? "" : "&anfrage=1";
    const fuer = props.fuer ? `&fuer=${props.fuer}` : "";
    // Ohne festen Bereich aus der Adresse muss der gewählte Bereich mit, sonst
    // landet der Gast nach dem Umschalten wieder in der Bereichsauswahl.
    const bereich = props.bereich && !props.fuer ? `&bereich=${props.bereich}` : "";
    const ohneAlt = basis.replace("&anfrage=1", "");
    starte(() => router.push(ohneAlt + neu + fuer + bereich, { scroll: false }));
  };

  // --- geschafft ---
  if (ergebnis?.ok) {
    const start = new Date(ergebnis.start);
    return (
      <main className="mx-auto max-w-xl px-4 py-12" style={markenStil(props.marke)}>
        {/* Erfolg braucht keine Signalfarbe: ein Haken und klare Typografie
            sagen dasselbe ruhiger. */}
        <div className="flex gap-4">
          <span aria-hidden="true"
            className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-neutral-900 text-[15px] text-white dark:bg-neutral-100 dark:text-neutral-900">
            &#10003;
          </span>
          <div>
            <h1 className="text-[22px] font-semibold leading-tight tracking-[-0.01em]">
              Termin ist eingetragen
            </h1>
            <p className="mt-2 text-[15px] leading-relaxed">
              {start.toLocaleDateString("de-CH", { weekday: "long", day: "numeric", month: "long" })},{" "}
              {start.toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit" })} Uhr,{" "}
              {dauerText(ergebnis.minuten)}
            </p>
            <p className="mt-3 text-[14px] leading-relaxed text-neutral-500 dark:text-neutral-400">
              {ergebnis.mailAnGast
                ? "Eine Bestätigung mit Kalendereintrag ist unterwegs zu dir."
                : "Der Termin steht. Die Bestätigungsmail konnte nicht zugestellt werden, ich melde mich."}
            </p>
          </div>
        </div>
        {/* Ein gewöhnlicher Link: das Neuladen setzt Formular und Auswahl zurück. */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a
          href="/"
          className="mt-8 inline-flex min-h-[44px] items-center rounded-xl border border-neutral-200 px-5 text-[15px] font-medium transition-colors hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-900"
        >
          Noch einen Termin buchen
        </a>
      </main>
    );
  }

  // --- Schritt 4: Angaben zur Person ---
  if (imFormular && zeit) {
    const start = new Date(zeit.startIso);
    const ende = new Date(start.getTime() + dauer * 60_000);
    return (
      <main className="mx-auto max-w-xl px-4 py-8" style={markenStil(props.marke)}>
        <button
          type="button"
          onClick={() => setImFormular(false)}
          className="mb-6 inline-flex min-h-[44px] items-center text-sm text-neutral-600 hover:underline dark:text-neutral-400"
        >
          &larr; zurück
        </button>

        <h1 className="text-xl font-semibold">{props.tag ? tagLang(props.tag) : ""}</h1>
        <p className="mt-1 text-neutral-600 dark:text-neutral-400">
          {uhrzeit(zeit.startIso)} bis {uhrzeit(ende.toISOString())} Uhr, {dauerText(dauer)}
          {props.bereichLabel ? `, ${props.bereichLabel}` : ""}
        </p>

        <form action={aktion} className="mt-8 space-y-5">
          <input type="hidden" name="start" value={zeit.startIso} />
          <input type="hidden" name="dauer" value={dauer} />
          <input type="hidden" name="anfrage" value={props.mitAnfrage ? "1" : "0"} />

          {/* Der Bereich steht seit dem ersten Schritt fest und wird nicht noch
              einmal gefragt. */}
          {props.bereich ? (
            <input type="hidden" name="bereich" value={props.bereich} />
          ) : (
            <fieldset>
              <legend className="text-sm font-medium">Worum geht es?</legend>
              <div className="mt-2 space-y-2">
                {props.bereiche.map((b, i) => (
                  <label
                    key={b.key}
                    className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 hover:bg-black/5 has-[:checked]:border-neutral-900 dark:hover:bg-white/5 dark:has-[:checked]:border-neutral-100"
                  >
                    <input type="radio" name="bereich" value={b.key} defaultChecked={i === 0} required className="mt-1" />
                    <span>
                      <span className="block text-sm font-medium">{b.label}</span>
                      <span className="block text-xs text-neutral-600 dark:text-neutral-400">{b.hinweis}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}

          <div>
            <label htmlFor="name" className="block text-sm font-medium">Name</label>
            <input id="name" name="name" required maxLength={80} autoComplete="name"
              className="mt-1 min-h-[44px] w-full rounded-lg border px-3 dark:bg-neutral-900" />
          </div>

          <div>
            <label htmlFor="email" className="block text-sm font-medium">Mailadresse</label>
            <input id="email" name="email" type="email" required maxLength={120} autoComplete="email"
              className="mt-1 min-h-[44px] w-full rounded-lg border px-3 dark:bg-neutral-900" />
          </div>

          <div>
            <label htmlFor="ort" className="block text-sm font-medium">
              Wo?
            </label>
            <input
              id="ort"
              name="ort"
              required
              maxLength={120}
              placeholder="z.B. Teams, Zoom, bei mir im Büro"
              className="mt-1 min-h-[44px] w-full rounded-lg border px-3 dark:bg-neutral-900"
            />
          </div>

          <div>
            <label htmlFor="anliegen" className="block text-sm font-medium">
              Anliegen
            </label>
            <textarea id="anliegen" name="anliegen" rows={4} required minLength={3} maxLength={1000}
              placeholder="Worum geht es?"
              className="mt-1 w-full rounded-lg border px-3 py-2 dark:bg-neutral-900" />
          </div>

          {/* Bot-Falle: für Menschen unsichtbar, für Skripte verlockend. */}
          <input type="text" name="webseite" tabIndex={-1} autoComplete="off" aria-hidden="true"
            className="absolute left-[-9999px] h-0 w-0 opacity-0" />

          {ergebnis && !ergebnis.ok && (
            <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100">
              {ergebnis.grund}
            </p>
          )}

          <button type="submit" disabled={laeuft}
            className="min-h-[48px] w-full rounded-lg bg-neutral-900 px-4 font-medium text-white disabled:opacity-60 dark:bg-neutral-100 dark:text-neutral-900">
            {laeuft ? "einen Moment ..." : "Termin buchen"}
          </button>
        </form>
      </main>
    );
  }

  // --- Schritt 3: Dauer ---
  if (zeit) {
    const gewaehlt = Math.min(Math.max(dauer, props.dauerMin), zeit.maxDauer);
    const startMs = new Date(zeit.startIso).getTime();

    return (
      <main className="mx-auto max-w-xl px-4 py-8" style={markenStil(props.marke)}>
        <button type="button" onClick={() => setZeit(null)}
          className="mb-6 inline-flex min-h-[44px] items-center text-sm text-neutral-600 hover:underline dark:text-neutral-400">
          &larr; andere Uhrzeit
        </button>

        <h1 className="text-[22px] font-semibold capitalize tracking-[-0.01em]">
          {props.tag ? tagLang(props.tag) : ""}
        </h1>
        <p className="mt-1.5 text-[15px] text-neutral-500 dark:text-neutral-400">
          Beginn {uhrzeit(zeit.startIso)} Uhr
        </p>

        {/* Beginn steht fest, das Ende wird eingetippt: ein
            Zeitfeld statt eines Auswahlfelds mit fast fünfzig Einträgen. Der Wert
            wird auf das Erlaubte geklemmt, damit nichts Ungültiges durchkommt. */}
        <div className="mt-10 flex flex-wrap items-end gap-4">
          <div>
            <span className="block text-[15px] font-medium">Beginn</span>
            <div className="mt-2 flex h-12 w-32 items-center rounded-xl border border-neutral-200 bg-neutral-50 px-4 text-[16px] tabular-nums text-neutral-500 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-400">
              {uhrzeit(zeit.startIso)}
            </div>
          </div>

          <div>
            <label htmlFor="ende" className="block text-[15px] font-medium">
              Ende
            </label>
            {/* Ein Textfeld, kein Zeitfeld: <input type="time"> öffnet in Chrome
                einen Wähler, und getippt werden soll die Zeit.
                Geprüft wird beim Verlassen des Feldes, nicht bei jedem Zeichen. */}
            <input
              id="ende"
              type="text"
              inputMode="numeric"
              autoComplete="off"
              placeholder="HH:MM"
              maxLength={5}
              aria-describedby="ende-hinweis"
              value={endeText ?? alsUhrzeit(startMs + gewaehlt * 60_000)}
              onChange={(e) => setEndeText(e.target.value)}
              onFocus={(e) => e.currentTarget.select()}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
              }}
              onBlur={() => {
                if (endeText === null) return;
                const minuten = minutenAus(endeText, startMs, new Date(zeit.startIso));
                if (minuten !== null) {
                  setDauer(Math.min(zeit.maxDauer, Math.max(props.dauerMin, minuten)));
                }
                setEndeText(null);
              }}
              className="mt-2 h-12 w-32 rounded-xl border border-neutral-300 bg-white px-4 text-[16px] tabular-nums transition-colors hover:border-neutral-400 focus:border-neutral-900 focus:outline-none dark:border-neutral-700 dark:bg-neutral-950 dark:hover:border-neutral-500 dark:focus:border-neutral-100"
            />
          </div>

          <div className="pb-3.5 text-[15px] text-neutral-500 dark:text-neutral-400">
            {dauerText(gewaehlt)}
          </div>
        </div>

        <p id="ende-hinweis" className="mt-2.5 text-[13px] leading-relaxed text-neutral-500 dark:text-neutral-400">
          Von {alsUhrzeit(startMs + props.dauerMin * 60_000)} bis{" "}
          {alsUhrzeit(startMs + zeit.maxDauer * 60_000)} Uhr, minutengenau. Danach ist mein
          Kalender belegt.
        </p>

        <button type="button" onClick={() => { setDauer(gewaehlt); setImFormular(true); }}
          className="mt-10 h-12 w-full rounded-xl bg-neutral-900 px-4 text-[16px] font-medium text-white transition-opacity active:opacity-80 dark:bg-neutral-100 dark:text-neutral-900">
          Weiter
        </button>

      </main>
    );
  }

  // --- Schritt 0: worum geht es? Steht am Anfang, weil erst der Bereich sagt,
  // welche Tage ins Wochenmuster passen.
  if (!props.bereich && props.bereiche.length > 1) {
    return (
      <main className="mx-auto max-w-xl px-4 py-8" style={markenStil(props.marke)}>
        <Kopf titel={props.titel} bereichLabel={props.bereichLabel} wunschText={props.wunschText} marke={props.marke} />
        <h2 className="mt-8 text-sm font-medium">Um welchen Bereich geht es?</h2>
        <div className="mt-3 space-y-2">
          {props.bereiche.map((b) => (
            <button key={b.key} type="button" disabled={warte}
              onClick={() => geheZu(`/?bereich=${b.key}`)}
              className="flex w-full items-center justify-between gap-3 rounded-lg border p-4 text-left hover:border-neutral-900 hover:bg-black/5 disabled:opacity-50 dark:hover:border-neutral-100 dark:hover:bg-white/10">
              <span>
                <span className="block font-medium">{b.label}</span>
                <span className="block text-sm text-neutral-600 dark:text-neutral-400">{b.hinweis}</span>
              </span>
              <span aria-hidden="true" className="text-neutral-400">&rarr;</span>
            </button>
          ))}
        </div>
        <Fuss />
      </main>
    );
  }

  // --- Schritt 2: Uhrzeit ---
  if (props.tag) {
    return (
      <main className="mx-auto max-w-4xl px-4 py-8" style={markenStil(props.marke)}>
        <Kopf titel={props.titel} bereichLabel={props.bereichLabel} wunschText={props.wunschText} marke={props.marke} />

        <div className="mt-10 grid gap-10 md:grid-cols-[auto_1fr]">
          {/* Auf breiten Schirmen bleibt der Kalender stehen, damit ein anderer
              Tag einen Klick kostet und keinen Seitenwechsel. */}
          <div className="hidden md:block">
            <Monatsnavigation
              jahr={props.jahr}
              monat={props.monat}
              ersterMonat={props.ersterMonat}
              letzterMonat={props.letzterMonat}
              warte={warte}
              wechsle={(m) => geheZu(`/?monat=${m}`)}
              className="mb-5"
            />
            <Monatsgitter
              jahr={props.jahr}
              monat={props.monat}
              freieTage={props.freieTage}
              wunschTage={props.wunschTage}
              ferientage={props.ferientage}
              aktiverTag={props.tag}
              gesperrt={props.fehler.length > 0}
              warte={warte}
              waehle={(t) => geheZu(`/?tag=${t}`)}
            />
          </div>

          <div>
            <button type="button" onClick={() => geheZu(`/?monat=${schluessel(props.jahr, props.monat)}`)}
              className="mb-4 inline-flex min-h-[44px] items-center text-sm text-neutral-600 hover:underline dark:text-neutral-400 md:hidden">
              &larr; anderer Tag
            </button>

            <h2 className="text-[19px] font-semibold capitalize tracking-[-0.01em]">{tagLang(props.tag)}</h2>
            {props.ferienHeute && (
              <p className="mt-2 inline-flex items-center gap-2.5 text-[13px] text-neutral-500 dark:text-neutral-400">
                <span aria-hidden="true" className="h-3.5 w-6 shrink-0 rounded-md bg-neutral-100 dark:bg-neutral-800/70" />
                {props.ferienHeute}
              </p>
            )}
            <p className="mt-1.5 text-[15px] text-neutral-500 dark:text-neutral-400">Beginn wählen</p>

            {props.zeiten.length === 0 ? (
              <p className="mt-4 rounded-lg border border-dashed p-6 text-center text-sm text-neutral-500">
                An diesem Tag ist nichts mehr frei.
              </p>
            ) : (
              <Zeitauswahl
                zeiten={props.zeiten}
                mitEmpfehlungen={props.mitEmpfehlungen}
                gesperrt={props.fehler.length > 0}
                warte={warte}
                waehle={(z) => {
                  setZeit(z);
                  setDauer(Math.min(props.dauerStandard, z.maxDauer));
                  setEndeText(null);
                }}
              />
            )}

            <AnfrageSchalter an={props.mitAnfrage} von={props.buroVon} bis={props.buroBis}
              umschalten={schalteAnfrage} warte={warte} />
          </div>
        </div>

        <Fuss />
      </main>
    );
  }

  // --- Schritt 1: Tag ---
  const jetzigerMonat = schluessel(props.jahr, props.monat);

  return (
    <main className="mx-auto max-w-xl px-4 py-8" style={markenStil(props.marke)}>
      <Kopf titel={props.titel} bereichLabel={props.bereichLabel} wunschText={props.wunschText} marke={props.marke} />

      {props.fehler.length > 0 && (
        <p className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100">
          Ein Kalender ist gerade nicht erreichbar. Buchen ist bis auf
          Weiteres nicht möglich.
        </p>
      )}

      <AnfrageSchalter an={props.mitAnfrage} von={props.buroVon} bis={props.buroBis}
        umschalten={schalteAnfrage} warte={warte} />

      <Monatsnavigation
        jahr={props.jahr}
        monat={props.monat}
        ersterMonat={props.ersterMonat}
        letzterMonat={props.letzterMonat}
        warte={warte}
        wechsle={(m) => geheZu(`/?monat=${m}`)}
        className="mt-10"
      />

      <div className={`mt-6 ${warte ? "opacity-50" : ""}`}>
        <Monatsgitter jahr={props.jahr} monat={props.monat} freieTage={props.freieTage}
          wunschTage={props.wunschTage} ferientage={props.ferientage} aktiverTag={null}
          gesperrt={props.fehler.length > 0}
          warte={warte} waehle={(t) => geheZu(`/?tag=${t}`)} />
      </div>

      {props.freieTage.length === 0 && (
        <p className="mt-6 rounded-lg border border-dashed p-6 text-center text-sm text-neutral-500">
          In diesem Monat ist nichts frei. Probier den nächsten.
        </p>
      )}

      {jetzigerMonat >= props.letzterMonat && (
        <p className="mt-6 rounded-lg border border-dashed p-4 text-sm text-neutral-600 dark:text-neutral-400">
          Weiter als {props.vorausMonate} Monate im Voraus ist hier nichts buchbar, weil mein
          Kalender so weit noch nicht steht.
          {props.anfrageMail ? (
            <>
              {" "}
              Für einen späteren Termin schreib mir an{" "}
              <a href={`mailto:${props.anfrageMail}`} className="underline">
                {props.anfrageMail}
              </a>
              .
            </>
          ) : null}
        </p>
      )}
      <Fuss />
    </main>
  );
}

/** Kopfzeile mit dem, was ein Gast wissen muss, bevor er klickt. */
function Kopf({ titel, bereichLabel, wunschText, marke }: {
  titel: string; bereichLabel?: string | null; wunschText?: string | null; marke?: MarkeDaten;
}) {
  return (
    <header>
      {marke?.logo && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={marke.logo} alt={marke.logoAlt} className="mb-6 h-9 w-auto" />
      )}
      {/* Grosse Schrift braucht enges Tracking und knappe Zeilenhöhe, sonst
          zerfällt sie; darunter mehr Luft statt einer Farbe für die Hierarchie. */}
      <h1 className="text-[26px] font-semibold leading-[1.15] tracking-[-0.02em] sm:text-[30px]">
        {titel}
      </h1>
      {/* Der Bereichsname steht schon im Logo, er erscheint
          deshalb nur ohne Logo. */}
      {bereichLabel && !marke?.logo && (
        <p className="mt-2.5 text-[15px] leading-relaxed text-neutral-500 dark:text-neutral-400">
          {bereichLabel}
        </p>
      )}
      {wunschText && (
        <p className="mt-4 inline-flex items-center gap-2.5 text-[13px] text-neutral-500 dark:text-neutral-400">
          <span aria-hidden="true"
            className="h-4 w-6 shrink-0 rounded-md border border-[var(--akzent-rand)] bg-[var(--akzent-flaeche)]" />
          Bevorzugt {wunschText}
        </p>
      )}
    </header>
  );
}

function Fuss() {
  return (
    <footer className="mt-16 flex flex-wrap items-center justify-between gap-3 border-t border-neutral-200 pt-5 text-[13px] text-neutral-400 dark:border-neutral-800 dark:text-neutral-500">
      <a href="/impressum" className="hover:underline">
        Impressum und Datenschutz
      </a>
      <span>Buchungstool, Open Source</span>
    </footer>
  );
}

/** Schalter für Randzeiten ausserhalb der Bürozeit. */
function AnfrageSchalter({ an, von, bis, umschalten, warte }: {
  an: boolean; von: string; bis: string; umschalten: () => void; warte: boolean;
}) {
  return (
    <button type="button" onClick={umschalten} disabled={warte} aria-pressed={an}
      className="mt-10 flex w-full items-start gap-3.5 rounded-xl border border-neutral-200 p-4 text-left transition-colors hover:border-neutral-300 hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-800 dark:hover:border-neutral-700 dark:hover:bg-neutral-900">
      <span className={`mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-md border text-[11px] transition-colors ${
        an
          ? "border-neutral-900 bg-neutral-900 text-white dark:border-neutral-100 dark:bg-neutral-100 dark:text-neutral-900"
          : "border-neutral-300 dark:border-neutral-600"
      }`}>
        {an ? "\u2713" : ""}
      </span>
      <span className="space-y-1">
        <span className="block text-[15px] font-medium leading-snug">
          Auch ausserhalb {von} bis {bis} Uhr anfragen
        </span>
        <span className="block text-[13px] leading-relaxed text-neutral-500 dark:text-neutral-400">
          Etwa eine Sitzung um 19 Uhr. Diese Zeiten sind unverbindlich und werden von mir bestätigt.
        </span>
      </span>
    </button>
  );
}


/**
 * Das Tagesgitter eines Monats. Gesperrte Tage bleiben lesbar (Kontrast
 * mindestens 4.5 zu 1, wie von WCAG gefordert) und werden zusätzlich
 * durchgestrichen, damit die Unterscheidung nicht allein an der Farbe hängt.
 */
function Monatsgitter({ jahr, monat, freieTage, wunschTage, ferientage, aktiverTag, gesperrt, warte, waehle }: {
  jahr: number; monat: number; freieTage: string[]; wunschTage: string[];
  ferientage: Record<string, string>; aktiverTag: string | null;
  gesperrt: boolean; warte: boolean; waehle: (tag: string) => void;
}) {
  const freie = new Set(freieTage);
  const wunsch = new Set(wunschTage);
  const ferienNamen = [...new Set(Object.values(ferientage))];
  const heute = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  const heuteText = `${heute.getFullYear()}-${p(heute.getMonth() + 1)}-${p(heute.getDate())}`;

  return (
    <div>
      <div className="grid grid-cols-7 text-center text-[12px] font-medium text-neutral-400 dark:text-neutral-500">
        {WOCHENTAGE.map((w) => (
          <div key={w} className="pb-2">{w}</div>
        ))}
      </div>
      <div className="mt-1 grid grid-cols-7 gap-y-2">
        {(() => {
          const zellen = monatsRaster(jahr, monat);
          return zellen.map((tag, i) => {
          if (!tag) return <div key={`leer-${i}`} />;
          const frei = freie.has(tag);
          const aktiv = tag === aktiverTag;
          const passt = frei && wunsch.has(tag);
          const ferien = ferientage[tag];
          const nummer = Number(tag.slice(8));

          // Das Ferienband läuft durch die Woche. Es endet am Wochenrand oder
          // dort, wo der Nachbartag nicht mehr in dieselbe Ferienzeit fällt;
          // nur dort wird es abgerundet.
          const spalte = i % 7;
          const vorher = spalte > 0 ? zellen[i - 1] : null;
          const nachher = spalte < 6 ? zellen[i + 1] : null;
          const bandBeginn = !vorher || ferientage[vorher] !== ferien;
          const bandEnde = !nachher || ferientage[nachher] !== ferien;
          return (
            <div
              key={tag}
              className={[
                "flex justify-center px-1.5 py-1",
                ferien ? "bg-neutral-100 dark:bg-neutral-800/70" : "",
                ferien && bandBeginn ? "rounded-l-lg" : "",
                ferien && bandEnde ? "rounded-r-lg" : "",
              ].join(" ")}
            >
            <button type="button" disabled={!frei || gesperrt || warte}
              onClick={() => waehle(tag)}
              aria-label={`${tagLang(tag)}${frei ? "" : ", nichts frei"}${passt ? ", bevorzugt" : ""}${ferien ? `, ${ferien}` : ""}`}
              aria-current={aktiv ? "date" : undefined}
              className={[
                "relative flex h-11 w-11 items-center justify-center rounded-lg text-sm tabular-nums",
                aktiv
                  ? "bg-neutral-900 font-semibold text-white dark:bg-neutral-100 dark:text-neutral-900"
                  : frei
                    ? "border border-neutral-400 font-medium hover:border-neutral-900 hover:bg-black/5 dark:border-neutral-600 dark:hover:border-neutral-100 dark:hover:bg-white/10"
                    : "text-neutral-500 line-through decoration-neutral-300 dark:text-neutral-500",
                passt && !aktiv ? "border-[var(--akzent-rand)] bg-[var(--akzent-flaeche)]" : "",
                tag === heuteText && !aktiv ? "ring-1 ring-neutral-400" : "",
              ].join(" ")}>
              {nummer}
            </button>
            </div>
          );
          });
        })()}
      </div>

      {ferienNamen.length > 0 && (
        <p className="mt-5 flex items-center gap-2.5 text-[13px] text-neutral-500 dark:text-neutral-400">
          <span aria-hidden="true" className="h-3.5 w-6 shrink-0 rounded-md bg-neutral-100 dark:bg-neutral-800/70" />
          {ferienNamen.join(", ")}, Termine sind trotzdem möglich
        </p>
      )}
    </div>
  );
}


/**
 * Die Uhrzeiten eines Tages.
 *
 * Statt einer Wand aus Dutzenden gleichwertigen Knöpfen stehen oben die Zeiten,
 * die keinen Arbeitsblock zerschneiden (Tagesbeginn, Mittag, Feierabend); alles andere liegt hinter einem Schalter. Wer eine bestimmte Zeit
 * braucht, kommt weiterhin an alle heran.
 */
function Zeitauswahl({ zeiten, mitEmpfehlungen, gesperrt, warte, waehle }: {
  zeiten: ZeitDaten[]; mitEmpfehlungen: boolean; gesperrt: boolean; warte: boolean;
  waehle: (z: ZeitDaten) => void;
}) {
  // Zu als Ausgangslage: die Vorschläge oben sollen den Blick
  // führen, die lange Liste ist einen Klick entfernt.
  const [weitereOffen, setWeitereOffen] = useState(false);
  // Höchstens zwei je Art: vier fast gleiche Mittagszeiten nebeneinander machen
  // den Zweck einer Empfehlung zunichte. Der Rest bleibt unter «weitere Zeiten»
  // erreichbar, es geht nur um die Auswahl, die zuerst ins Auge fällt.
  const proArt = new Map<string, number>();
  const empfohlen: ZeitDaten[] = [];
  const weitere: ZeitDaten[] = [];

  for (const z of zeiten) {
    // Ohne Empfehlungen sind alle Zeiten gleichwertig und stehen in einer Liste.
    if (!mitEmpfehlungen || z.empfehlung === null) {
      weitere.push(z);
      continue;
    }
    const bisher = proArt.get(z.empfehlung) ?? 0;
    if (bisher < 2) {
      empfohlen.push(z);
      proArt.set(z.empfehlung, bisher + 1);
    } else {
      weitere.push(z);
    }
  }
  weitere.sort((a, b) => a.startIso.localeCompare(b.startIso));

  const knopf = (z: ZeitDaten, gross: boolean) => (
    <button key={z.startIso} type="button" disabled={gesperrt || warte}
      onClick={() => waehle(z)}
      className={[
        "flex flex-col items-center justify-center rounded-lg border tabular-nums",
        gross ? "min-h-[64px] px-3" : "min-h-[44px] text-neutral-600 dark:text-neutral-400",
        z.wunschzeit ? "border-[var(--akzent)]" : gross ? "border-neutral-300 dark:border-neutral-600" : "",
        z.aufAnfrage ? "border-dashed" : "",
        "text-sm hover:border-neutral-900 hover:bg-black/5 disabled:opacity-40 dark:hover:border-neutral-100 dark:hover:bg-white/10",
      ].join(" ")}>
      {/* Nur die Uhrzeit, ohne Begründung darunter: die Gewichtung trägt die
          Gruppierung. */}
      <span className={gross ? "text-[17px] font-medium" : ""}>{uhrzeit(z.startIso)}</span>
      {z.aufAnfrage && <span className="text-[10px] text-neutral-500">auf Anfrage</span>}
    </button>
  );

  return (
    <div className={`mt-4 ${warte ? "opacity-50" : ""}`}>
      {empfohlen.length > 0 && (
        <>
          <div className="text-[13px] font-medium">Bevorzugte Zeiten</div>
          <p className="mt-1 text-[13px] leading-relaxed text-neutral-500 dark:text-neutral-400">
            Diese Zeiten fügen sich am besten in meinen Arbeitstag ein.
          </p>
          <div className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-3">
            {empfohlen.map((z) => knopf(z, true))}
          </div>
        </>
      )}

      {weitere.length > 0 && (
        <>
          {empfohlen.length > 0 && (
            <button
              type="button"
              onClick={() => setWeitereOffen((o) => !o)}
              aria-expanded={weitereOffen}
              className="mt-8 flex w-full items-center justify-between gap-3 py-1 text-left text-[13px] font-medium text-neutral-500 transition-colors hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
            >
              <span>
                Weitere freie Zeiten
                <span className="ml-1.5 font-normal text-neutral-400 dark:text-neutral-500">
                  {weitere.length}
                </span>
              </span>
              <span
                aria-hidden="true"
                className={`text-[11px] transition-transform duration-200 ${weitereOffen ? "rotate-180" : ""}`}
              >
                &#9660;
              </span>
            </button>
          )}
          {(weitereOffen || empfohlen.length === 0) && (
            <>
              {empfohlen.length > 0 && (
                <p className="mt-2 text-[13px] leading-relaxed text-neutral-500 dark:text-neutral-400">
                  Diese Zeiten sind frei, liegen aber mitten in einem Arbeitsblock. Für
                  wichtige Anliegen geht das; für alltägliche Fragen sind die Zeiten am
                  Rand besser.
                </p>
              )}
              <div className={`${empfohlen.length > 0 ? "mt-3" : ""} grid grid-cols-3 gap-2.5 sm:grid-cols-4`}>
                {weitere.map((z) => knopf(z, false))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}


/**
 * Vor und zurück durch die Monate.
 *
 * Steht in beiden Ansichten, auch in der Tagesansicht. Ein Wechsel führt zurück in die Monatsübersicht, weil der bisher gewählte
 * Tag im neuen Monat nicht mehr existiert.
 */
function Monatsnavigation({ jahr, monat, ersterMonat, letzterMonat, warte, wechsle, className }: {
  jahr: number; monat: number; ersterMonat: string; letzterMonat: string;
  warte: boolean; wechsle: (monat: string) => void; className?: string;
}) {
  const jetziger = schluessel(jahr, monat);
  const vor = monat === 1 ? schluessel(jahr - 1, 12) : schluessel(jahr, monat - 1);
  const nach = monat === 12 ? schluessel(jahr + 1, 1) : schluessel(jahr, monat + 1);
  const knopf =
    "flex h-11 w-11 items-center justify-center rounded-xl border border-neutral-200 text-neutral-600 transition-colors hover:bg-neutral-50 disabled:opacity-25 dark:border-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-900";

  return (
    <div className={`flex items-center justify-between gap-4 ${className ?? ""}`}>
      <button type="button" onClick={() => wechsle(vor)} disabled={jetziger <= ersterMonat || warte}
        aria-label="vorheriger Monat" className={knopf}>
        &larr;
      </button>
      <span className="text-[17px] font-medium capitalize tracking-[-0.01em]">
        {monatsName(jahr, monat)}
      </span>
      <button type="button" onClick={() => wechsle(nach)} disabled={jetziger >= letzterMonat || warte}
        aria-label="nächster Monat" className={knopf}>
        &rarr;
      </button>
    </div>
  );
}
