import { db } from "@/lib/db";
import { getBelegteZeiten } from "@/lib/kalender";
import { aufraeumenWennFaellig } from "@/lib/buchung";

export const dynamic = "force-dynamic";

/**
 * Zustand für Docker-Healthcheck und Überwachung.
 *
 * Bewusst ohne Namen oder Adressen: die Seite ist öffentlich, und die Namen der
 * Kalender verraten etwas über den Inhaber. Gemeldet werden nur Zahlen.
 * Status 503 nur, wenn die Datenbank fehlt; ein ausgefallener Kalender macht
 * den Dienst nicht kaputt, er sperrt nur das Buchen und steht in der Antwort.
 */
export async function GET() {
  // Der Healthcheck ruft diese Seite jede Minute auf. So laufen die Löschfristen
  // auch dann, wenn niemand die Buchungsseite besucht.
  aufraeumenWennFaellig();

  let datenbank = false;
  try {
    db().anzahl();
    datenbank = true;
  } catch {
    datenbank = false;
  }

  const jetzt = new Date();
  const stand = await getBelegteZeiten(jetzt, new Date(jetzt.getTime() + 86_400_000));

  return Response.json(
    {
      ok: datenbank && stand.fehler.length === 0,
      datenbank,
      kalender: {
        konfiguriert: stand.konfiguriert,
        erreichbar: stand.konfiguriert - stand.fehler.length,
      },
    },
    { status: datenbank ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
