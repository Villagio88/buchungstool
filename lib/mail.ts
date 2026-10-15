import nodemailer from "nodemailer";
import { baueEinladung } from "./ical";
import { INHABER_NAME, type Bereich } from "./config";

/**
 * Versand über ein beliebiges SMTP-Konto (MAIL_SMTP_HOST, MAIL_USER, MAIL_PASS).
 * Bei Gmail braucht es ein App-Passwort, bei Microsoft 365 ein Konto mit
 * SMTP AUTH.
 *
 * Zwei Mails je Buchung: die Einladung an die Adresse des gewählten Bereichs,
 * damit der Termin im richtigen Kalender landet, und eine Bestätigung an den Gast.
 *
 * Der Betreff ist nicht beliebig: manche Exchange-Umgebungen ersetzen den
 * Termintitel durch den Mail-Betreff. Er muss deshalb genau das sein, was im
 * Kalender stehen soll.
 */

function transporter() {
  const user = process.env.MAIL_USER;
  const pass = process.env.MAIL_PASS;
  if (!user || !pass) throw new Error("MAIL_USER und MAIL_PASS müssen gesetzt sein.");

  return nodemailer.createTransport({
    host: process.env.MAIL_SMTP_HOST ?? "localhost",
    port: Number(process.env.MAIL_SMTP_PORT ?? 465),
    secure: Number(process.env.MAIL_SMTP_PORT ?? 465) === 465,
    auth: { user, pass },
  });
}

export type BuchungsMail = {
  id: string;
  start: Date;
  ende: Date;
  bereich: Bereich;
  name: string;
  email: string;
  anliegen: string | null;
  ort: string | null;
  /** Liegt ausserhalb der Bürozeit: der Inhaber muss ausdrücklich zustimmen. */
  aufAnfrage: boolean;
  /** Geheimnis für den Absage-Link des Gastes. Fehlt bei Altbuchungen. */
  token?: string | null;
  /** Geheimnis für den Absage-Link des Inhabers. */
  tokenInhaber?: string | null;
};

/** Adresse der Seite, für die Links in den Mails. */
function seitenUrl(): string {
  return (process.env.SEITEN_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

function absageLink(id: string, token: string | null | undefined): string | null {
  if (!token) return null;
  return `${seitenUrl()}/absagen?id=${encodeURIComponent(id)}&token=${encodeURIComponent(token)}`;
}

function zeitText(start: Date, ende: Date): string {
  const tag = start.toLocaleDateString("de-CH", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
  const von = start.toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit" });
  const bis = ende.toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit" });
  return `${tag}, ${von} bis ${bis} Uhr`;
}

/** Host der Seite, für eindeutige Termin-IDs. */
function uidDomain(): string {
  try {
    return new URL(seitenUrl()).hostname || "buchungstool";
  } catch {
    return "buchungstool";
  }
}

/** Unterschrift und Absendername in den Mails an den Gast. */
function absenderName(): string {
  return INHABER_NAME || "Terminbuchung";
}

/** Der Titel, der im Kalender stehen soll. Zugleich der Mail-Betreff. */
function termintitel(b: BuchungsMail): string {
  // Bei einer Randzeit steht das im Titel, weil manche Postfächer den Betreff
  // als Termintitel übernehmen: so ist es auch im Kalender sichtbar.
  const rand = b.aufAnfrage ? " ausserhalb der Bürozeit" : "";
  return `Termin mit ${b.name} (${b.bereich.label})${rand}`;
}

export async function sendeEinladungen(b: BuchungsMail): Promise<{ anInhaber: boolean; anGast: boolean }> {
  const user = process.env.MAIL_USER;
  // Fehlt die Konfiguration, darf das die Buchung nicht mitreissen: sie steht
  // bereits in der Datenbank, und der Gast bekäme sonst eine Fehlermeldung für
  // einen Termin, den es tatsächlich gibt.
  let t: ReturnType<typeof transporter>;
  try {
    if (!user) throw new Error("MAIL_USER fehlt");
    t = transporter();
  } catch (e) {
    console.error("[mail] Versand nicht möglich, Buchung bleibt bestehen:", e);
    return { anInhaber: false, anGast: false };
  }
  const titel = termintitel(b);
  const zeit = zeitText(b.start, b.ende);
  const anliegen = b.anliegen?.trim() ? b.anliegen.trim() : "kein Text angegeben";

  const ics = baueEinladung({
    uid: `${b.id}@${uidDomain()}`,
    start: b.start,
    ende: b.ende,
    titel,
    beschreibung: `Gebucht über die Terminseite.\nName: ${b.name}\nMail: ${b.email}\nOrt: ${b.ort ?? "nicht angegeben"}\nAnliegen: ${anliegen}`,
    ort: b.ort,
    organisator: user,
    inhaberName: INHABER_NAME,
    inhaberMail: b.bereich.mail,
    gastName: b.name,
    gastMail: b.email,
  });

  const ergebnis = { anInhaber: false, anGast: false };

  try {
    await t.sendMail({
      from: `"Terminbuchung" <${user}>`,
      to: b.bereich.mail,
      replyTo: b.email,
      subject: titel,
      text: [
        `${zeit}`,
        "",
        `Bereich: ${b.bereich.label}`,
        `Ort: ${b.ort ?? "nicht angegeben"}`,
        `Name: ${b.name}`,
        `Mail: ${b.email}`,
        `Anliegen: ${anliegen}`,
        "",
        b.aufAnfrage
          ? "ACHTUNG: Diese Zeit liegt ausserhalb der Bürozeit und wurde als Anfrage gebucht."
          : "",
        "Zum Bestätigen die Einladung im Anhang annehmen.",
        absageLink(b.id, b.tokenInhaber)
          ? `Absagen und die Zeit wieder freigeben: ${absageLink(b.id, b.tokenInhaber)}`
          : "",
      ].join("\n"),
      icalEvent: { filename: "termin.ics", method: "REQUEST", content: ics },
    });
    ergebnis.anInhaber = true;
  } catch (e) {
    console.error("[mail] Einladung an den Inhaber fehlgeschlagen:", e);
  }

  try {
    await t.sendMail({
      from: `"${absenderName()}" <${user}>`,
      to: b.email,
      replyTo: b.bereich.mail,
      subject: `Termin angefragt: ${zeit}`,
      text: [
        `Guten Tag ${b.name}`,
        "",
        b.aufAnfrage
          ? `Ihre Anfrage ist eingegangen: ${zeit}.`
          : `Ihr Termin ist eingetragen: ${zeit}.`,
        `Bereich: ${b.bereich.label}`,
        b.ort ? `Ort: ${b.ort}` : "",
        "",
        b.aufAnfrage
          ? "Diese Zeit liegt ausserhalb meiner üblichen Bürozeiten. Ich melde mich, falls es doch nicht passt."
          : "Die Einladung im Anhang können Sie in Ihren Kalender übernehmen.",
        absageLink(b.id, b.token)
          ? `Falls es doch nicht passt, hier absagen: ${absageLink(b.id, b.token)}`
          : "Falls etwas nicht passt, antworten Sie einfach auf diese Mail.",
        "",
        "Freundliche Grüsse",
        absenderName(),
      ].join("\n"),
      icalEvent: { filename: "termin.ics", method: "REQUEST", content: ics },
    });
    ergebnis.anGast = true;
  } catch (e) {
    console.error("[mail] Bestätigung an den Gast fehlgeschlagen:", e);
  }

  return ergebnis;
}


/**
 * Absage an beide Seiten. Die angehängte Nachricht trägt METHOD:CANCEL, damit
 * Outlook und Proton den Termin von selbst aus dem Kalender nehmen.
 */
export async function sendeAbsage(
  b: BuchungsMail & { abgesagtVon: "gast" | "inhaber" },
): Promise<void> {
  const user = process.env.MAIL_USER;
  let t: ReturnType<typeof transporter>;
  try {
    if (!user) throw new Error("MAIL_USER fehlt");
    t = transporter();
  } catch (e) {
    console.error("[mail] Absage konnte nicht versandt werden:", e);
    return;
  }

  const zeit = zeitText(b.start, b.ende);
  const ics = baueEinladung(
    {
      uid: `${b.id}@${uidDomain()}`,
      start: b.start,
      ende: b.ende,
      titel: termintitel(b),
      beschreibung: "Dieser Termin wurde abgesagt.",
      organisator: user as string,
      inhaberName: INHABER_NAME,
      inhaberMail: b.bereich.mail,
      gastName: b.name,
      gastMail: b.email,
    },
    true,
  );

  const wer = b.abgesagtVon === "gast" ? `${b.name} hat abgesagt` : "Du hast abgesagt";

  for (const [an, text] of [
    [b.bereich.mail, `${wer}.\n\n${zeit}\n\nDie Zeit ist wieder frei.`],
    [b.email, `Der Termin vom ${zeit} ist abgesagt.\n\nFreundliche Grüsse\n${absenderName()}`],
  ] as [string, string][]) {
    try {
      await t.sendMail({
        from: `"Terminbuchung" <${user}>`,
        to: an,
        subject: `Abgesagt: ${termintitel(b)}`,
        text,
        icalEvent: { filename: "absage.ics", method: "CANCEL", content: ics },
      });
    } catch (e) {
      console.error(`[mail] Absage an ${an} fehlgeschlagen:`, e);
    }
  }
}
