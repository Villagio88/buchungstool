import Link from "next/link";
import { terminFuerAbsage } from "@/lib/buchung";
import { AbsageAnsicht } from "@/components/absage-ansicht";

export const dynamic = "force-dynamic";

/**
 * Absage über den Link aus der Bestätigungsmail.
 *
 * Der Token im Link ist der einzige Nachweis. Wer ihn hat, hat die Mail bekommen
 * und darf absagen; eine Anmeldung wäre für einen einzelnen Termin unverhältnismässig.
 */
export default async function Seite({
  searchParams,
}: {
  searchParams: Promise<{ id?: string; token?: string }>;
}) {
  const { id, token } = await searchParams;

  const termin = id && token ? await terminFuerAbsage(id, token) : null;

  if (!termin) {
    return (
      <main className="mx-auto max-w-xl px-4 py-12">
        <h1 className="text-xl font-semibold">Termin nicht gefunden</h1>
        <p className="mt-3 text-neutral-600 dark:text-neutral-400">
          Dieser Absage-Link stimmt nicht oder ist nicht mehr gültig. Antworte einfach auf die
          Bestätigungsmail, dann wird es von Hand erledigt.
        </p>
        <Link href="/" className="mt-6 inline-flex min-h-[44px] items-center text-sm text-neutral-600 hover:underline dark:text-neutral-400">
          Zur Terminseite
        </Link>
      </main>
    );
  }

  return (
    <AbsageAnsicht
      id={id as string}
      token={token as string}
      startIso={termin.start.toISOString()}
      endeIso={termin.ende.toISOString()}
      minuten={termin.minuten}
      name={termin.name}
      bereich={termin.bereich}
      bereitsAbgesagt={termin.storniert}
    />
  );
}
