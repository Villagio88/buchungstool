import Link from "next/link";
import { KONFIG } from "@/lib/config";

export const metadata = { title: "Impressum und Datenschutz" };
export const dynamic = "force-dynamic";

/**
 * Impressum und Datenschutz.
 *
 * Die Angaben stehen in der Umgebung, damit hier nichts erfunden wird. Fehlen
 * sie, sagt die Seite das ausdrücklich, statt eine Vollständigkeit vorzutäuschen.
 */
export default function Seite() {
  const a = KONFIG.impressum;
  const vollstaendig = a.name && a.adresse && a.mail;

  return (
    <main className="mx-auto max-w-xl px-4 py-12">
      <Link href="/" className="inline-flex min-h-[44px] items-center text-sm text-neutral-600 hover:underline dark:text-neutral-400">
        &larr; zur Terminseite
      </Link>

      <h1 className="mt-4 text-2xl font-semibold">Impressum</h1>

      {vollstaendig ? (
        <address className="mt-4 not-italic text-sm leading-relaxed">
          {a.name}
          <br />
          {a.adresse.split(/\n|\\n/).map((z, i) => (
            <span key={i}>
              {z}
              <br />
            </span>
          ))}
          <a href={`mailto:${a.mail}`} className="text-neutral-900 underline dark:text-neutral-100">
            {a.mail}
          </a>
          {a.telefon && (
            <>
              <br />
              {a.telefon}
            </>
          )}
        </address>
      ) : (
        <p className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100">
          Die Angaben sind noch nicht hinterlegt.
        </p>
      )}

      <h2 className="mt-10 text-xl font-semibold">Datenschutz</h2>

      <div className="mt-4 space-y-4 text-sm leading-relaxed text-neutral-700 dark:text-neutral-300">
        <p>
          <strong className="font-medium">Was erhoben wird.</strong> Beim Buchen eines Termins
          werden Name, Mailadresse, der gewählte Bereich, der Ort des Termins und ein kurzer Text
          zum Anliegen gespeichert. Zusätzlich wird die IP-Adresse festgehalten, ausschliesslich um Missbrauch
          zu begrenzen.
        </p>
        <p>
          <strong className="font-medium">Wozu.</strong> Die Daten dienen allein dazu, den Termin
          zu vereinbaren und zu bestätigen. Es findet keine Auswertung, keine Werbung und keine
          Weitergabe zu anderen Zwecken statt.
        </p>
        <p>
          <strong className="font-medium">Wohin.</strong> Die Bestätigung und die
          Kalendereinladung werden per Mail versendet{a.mailDienst ? ` über ${a.mailDienst}` : ""},
          dabei werden Name und Mailadresse übermittelt.
          {a.serverOrt ? ` Gespeichert werden die Daten auf einem Server in ${a.serverOrt}.` : ""}
        </p>
        <p>
          <strong className="font-medium">Wie lange.</strong> Die Buchung bleibt gespeichert,
          solange sie für den Terminverlauf gebraucht wird. Eine Absage entfernt die Belegung,
          der Eintrag selbst bleibt als Verlauf bestehen.
        </p>
        <p>
          <strong className="font-medium">Keine Verfolgung.</strong> Diese Seite setzt keine
          Cookies, bindet keine fremden Schriften, Karten oder Skripte ein und nutzt keine
          Statistikdienste.
        </p>
        <p>
          <strong className="font-medium">Deine Rechte.</strong> Auskunft, Berichtigung und
          Löschung kannst du jederzeit formlos per Mail an die oben genannte Adresse verlangen.
        </p>
      </div>
    </main>
  );
}
