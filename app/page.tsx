import { getMonat, getTag } from "@/lib/buchung";
import {
  KONFIG,
  sichtbareBereiche,
  wunschzeitText,
  ferientageIm,
  ferienAm,
  zeigtEmpfehlungen,
  zeigtFerien,
  marke,
  type BereichKey,
} from "@/lib/config";
import { Buchen } from "@/components/buchen";

export const dynamic = "force-dynamic";

function schluessel(jahr: number, monat: number): string {
  return `${jahr}-${String(monat).padStart(2, "0")}`;
}

export default async function Seite({
  searchParams,
}: {
  searchParams: Promise<{
    monat?: string;
    tag?: string;
    anfrage?: string;
    fuer?: string;
    bereich?: string;
  }>;
}) {
  const p = await searchParams;
  const heute = new Date();
  const mitAnfrage = p.anfrage === "1";

  // Der Bereich steht am Anfang, nicht am Ende: erst mit ihm weiss die Seite,
  // welche Tage ins Wochenmuster passen.
  const auswahl = sichtbareBereiche(p.fuer);

  // Ohne gültigen Bereich kann keine Einladung ankommen. Lieber ein klarer
  // Hinweis als ein Kalender, der erst im Formular scheitert.
  if (auswahl.length === 0) {
    return (
      <main className="mx-auto max-w-xl px-4 py-12">
        <h1 className="text-xl font-semibold">{KONFIG.titel}</h1>
        <p className="mt-3 text-neutral-600 dark:text-neutral-400">
          Die Terminbuchung ist noch nicht eingerichtet: es ist kein Bereich mit gültiger
          Zieladresse hinterlegt (BEREICHE und BEREICH_&lt;NAME&gt;_MAIL).
        </p>
      </main>
    );
  }
  const gewaehlt = auswahl.length === 1 ? auswahl[0] : auswahl.find((b) => b.key === p.bereich);
  const bereichKey = gewaehlt?.key as BereichKey | undefined;

  const letzterTag = new Date(heute.getTime() + KONFIG.vorausTage * 86_400_000);
  const ersterMonat = schluessel(heute.getFullYear(), heute.getMonth() + 1);
  const letzterMonat = schluessel(letzterTag.getFullYear(), letzterTag.getMonth() + 1);

  const gemeinsam = {
    bereiche: auswahl.map((b) => ({ key: b.key, label: b.label, hinweis: b.hinweis })),
    bereich: bereichKey ?? null,
    bereichLabel: gewaehlt?.label ?? null,
    wunschText: bereichKey ? wunschzeitText(bereichKey) : null,
    vorausMonate: Math.round(KONFIG.vorausTage / 30),
    mitEmpfehlungen: bereichKey ? zeigtEmpfehlungen(bereichKey) : true,
    marke: marke(bereichKey),
    anfrageMail: gewaehlt?.mail ?? null,
    fuer: p.fuer ?? null,
    dauerMin: KONFIG.dauerMinMinuten,
    dauerSchritt: KONFIG.dauerSchrittMinuten,
    dauerStandard: KONFIG.dauerStandardMinuten,
    titel: KONFIG.titel,
    ersterMonat,
    letzterMonat,
    mitAnfrage,
    buroVon: KONFIG.vonUhr,
    buroBis: KONFIG.bisUhr,
  };

  // Schritt 2 und 3: ein Tag ist gewählt.
  if (p.tag && /^\d{4}-\d{2}-\d{2}$/.test(p.tag)) {
    const [j, m] = p.tag.split("-").map(Number);
    // Der Monat kommt mit, damit auf breiten Schirmen Kalender und Zeiten
    // nebeneinanderstehen und ein Tageswechsel keinen Seitenwechsel braucht.
    const [stand, monatStand] = await Promise.all([
      getTag(p.tag, mitAnfrage, bereichKey),
      getMonat(j, m, mitAnfrage, bereichKey),
    ]);
    return (
      <Buchen
        {...gemeinsam}
        jahr={j}
        monat={m}
        freieTage={monatStand.freieTage}
        wunschTage={monatStand.wunschTage}
        ferientage={zeigtFerien(bereichKey) ? ferientageIm(j, m) : {}}
        ferienHeute={zeigtFerien(bereichKey) ? (ferienAm(p.tag)?.name ?? null) : null}
        tag={p.tag}
        zeiten={stand.zeiten}
        fehler={stand.fehler}
      />
    );
  }

  // Schritt 1: Monatskalender.
  let jahr = heute.getFullYear();
  let monat = heute.getMonth() + 1;
  if (p.monat && /^\d{4}-\d{2}$/.test(p.monat)) {
    const [j, m] = p.monat.split("-").map(Number);
    const gewuenscht = schluessel(j, m);
    if (gewuenscht >= ersterMonat && gewuenscht <= letzterMonat) {
      jahr = j;
      monat = m;
    }
  }

  let stand = await getMonat(jahr, monat, mitAnfrage, bereichKey);

  // Ohne ausdrücklich gewählten Monat auf den ersten springen, in dem etwas
  // frei ist. Sonst landet jemand auf einem leeren Kalender.
  if (!p.monat && stand.freieTage.length === 0 && stand.fehler.length === 0) {
    for (let i = 0; i < 2 && stand.freieTage.length === 0; i++) {
      const naechster = monat === 12 ? { j: jahr + 1, m: 1 } : { j: jahr, m: monat + 1 };
      if (schluessel(naechster.j, naechster.m) > letzterMonat) break;
      jahr = naechster.j;
      monat = naechster.m;
      stand = await getMonat(jahr, monat, mitAnfrage, bereichKey);
    }
  }

  return (
    <Buchen
      {...gemeinsam}
      jahr={jahr}
      monat={monat}
      freieTage={stand.freieTage}
      wunschTage={stand.wunschTage}
      ferientage={zeigtFerien(bereichKey) ? ferientageIm(jahr, monat) : {}}
      ferienHeute={null}
      tag={null}
      zeiten={[]}
      fehler={stand.fehler}
    />
  );
}
