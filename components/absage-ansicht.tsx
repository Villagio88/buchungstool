"use client";

import Link from "next/link";
import { useActionState } from "react";
import { terminAbsagen } from "@/app/actions";

/**
 * Zeigt den Termin und fragt einmal nach, bevor abgesagt wird. Eine Absage ist
 * nicht umkehrbar: der Slot ist danach wieder für alle frei.
 */
export function AbsageAnsicht(props: {
  id: string;
  token: string;
  startIso: string;
  endeIso: string;
  minuten: number;
  name: string;
  bereich: string;
  bereitsAbgesagt: boolean;
}) {
  const [ergebnis, aktion, laeuft] = useActionState(terminAbsagen, null);

  const start = new Date(props.startIso);
  const ende = new Date(props.endeIso);
  const zeit = `${start.toLocaleDateString("de-CH", {
    weekday: "long",
    day: "numeric",
    month: "long",
  })}, ${start.toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit" })} bis ${ende.toLocaleTimeString(
    "de-CH",
    { hour: "2-digit", minute: "2-digit" },
  )} Uhr`;

  const erledigt = props.bereitsAbgesagt || ergebnis?.ok;

  return (
    <main className="mx-auto max-w-xl px-4 py-12">
      <h1 className="text-xl font-semibold">{erledigt ? "Termin ist abgesagt" : "Termin absagen?"}</h1>

      <div className="mt-6 rounded-lg border p-4">
        <div className={`text-sm ${erledigt ? "text-neutral-500 line-through" : ""}`}>{zeit}</div>
        <div className="mt-1 text-xs text-neutral-600 dark:text-neutral-400">
          {props.bereich}, {props.name}
        </div>
      </div>

      {erledigt ? (
        <p className="mt-6 text-sm text-neutral-600 dark:text-neutral-400">
          Die Zeit ist wieder frei. Beide Seiten haben eine Absage per Mail bekommen.
        </p>
      ) : (
        <form action={aktion} className="mt-6">
          <input type="hidden" name="id" value={props.id} />
          <input type="hidden" name="token" value={props.token} />
          <p className="text-sm text-neutral-600 dark:text-neutral-400">
            Die Zeit wird danach wieder für andere frei. Rückgängig machen geht nicht.
          </p>
          {ergebnis && !ergebnis.ok && (
            <p className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100">
              {ergebnis.grund}
            </p>
          )}
          <button
            type="submit"
            disabled={laeuft}
            className="mt-4 min-h-[48px] w-full rounded-lg bg-neutral-900 px-4 font-medium text-white disabled:opacity-60 dark:bg-neutral-100 dark:text-neutral-900"
          >
            {laeuft ? "einen Moment ..." : "Ja, Termin absagen"}
          </button>
        </form>
      )}

      <Link
        href="/"
        className="mt-6 inline-flex min-h-[44px] items-center text-sm text-neutral-600 hover:underline dark:text-neutral-400"
      >
        {erledigt ? "Neuen Termin buchen" : "Nein, Termin behalten"}
      </Link>
    </main>
  );
}
