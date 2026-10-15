"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { buchen, type BuchungsErgebnis } from "@/lib/buchung";

/**
 * Nimmt das Formular entgegen. Die eigentliche Prüfung steckt in lib/buchung.ts,
 * hier wird nur die Anfrage ausgepackt.
 */
export async function buchungAnlegen(
  _vorher: BuchungsErgebnis | null,
  formular: FormData,
): Promise<BuchungsErgebnis> {
  const kopf = await headers();
  // Den LETZTEN Eintrag nehmen, nicht den ersten: der Reverse Proxy hängt die
  // echte Adresse hinten an. Schickt der Client selbst ein X-Forwarded-For mit,
  // steht sein Wunschwert vorne. Mit dem ersten Eintrag wäre die Sperre pro
  // Adresse durch eine einzige Kopfzeile auszuhebeln. Voraussetzung: genau ein
  // Proxy vor der Seite, der X-Forwarded-For ergänzt.
  const kette = (kopf.get("x-forwarded-for") ?? "").split(",").map((t) => t.trim()).filter(Boolean);
  const ip = kette.length > 0 ? kette[kette.length - 1] : null;

  const ergebnis = await buchen({
    startIso: String(formular.get("start") ?? ""),
    dauerMinuten: Number(formular.get("dauer") ?? 0),
    mitAnfrage: formular.get("anfrage") === "1",
    bereich: String(formular.get("bereich") ?? ""),
    name: String(formular.get("name") ?? ""),
    email: String(formular.get("email") ?? ""),
    anliegen: String(formular.get("anliegen") ?? ""),
    ort: String(formular.get("ort") ?? ""),
    falle: String(formular.get("webseite") ?? ""),
    ip,
  });

  if (ergebnis.ok) revalidatePath("/");
  return ergebnis;
}

/** Absage über den Link aus der Bestätigungsmail. */
export async function terminAbsagen(
  _vorher: { ok: boolean; grund?: string } | null,
  formular: FormData,
): Promise<{ ok: boolean; grund?: string }> {
  const { absagen } = await import("@/lib/buchung");
  const ergebnis = await absagen(
    String(formular.get("id") ?? ""),
    String(formular.get("token") ?? ""),
  );
  if (ergebnis.ok) {
    revalidatePath("/");
    return { ok: true };
  }
  return { ok: false, grund: ergebnis.grund };
}
