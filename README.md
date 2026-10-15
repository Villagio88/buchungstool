# Buchungstool

[English version](README.en.md)

Eine selbst gehostete Seite für Terminbuchungen, die **mehrere Kalender verschiedener
Anbieter zugleich** berücksichtigt. Gratis, Open Source, ohne Konto bei einem Dienst.

## Das Problem

Wer privat Proton Calendar nutzt und geschäftlich Microsoft 365, hat ein Problem mit
Buchungsdiensten. Calendly, TidyCal, Microsoft Bookings und ähnliche Dienste verbinden
sich mit Google oder Microsoft, mit Proton aber nicht, und meist nur mit einem Konto pro
Anbieter. Die Folge: Gäste buchen Zeiten, die im anderen Kalender längst belegt sind.

## Die Idee

Fast jeder Kalender lässt sich als **ICS-Link** (iCal-Abo) freigeben: Proton, Microsoft
365 und Outlook, Google, iCloud, Nextcloud, Fastmail und viele mehr. Das Buchungstool liest
beliebig viele solcher Links und zählt eine Zeit nur als frei, wenn sie in **allen**
Kalendern frei ist. Es braucht keinen Zugriff auf die Konten, nur die Leselinks.

Gäste sehen ausschliesslich frei oder belegt. Titel, Orte und Teilnehmer verlassen den
Server nie.

## Was es kann

- **Verfügbarkeit aus beliebig vielen ICS-Kalendern**, mit Serien, Zeitzonen (auch die
  Windows-Namen von Outlook), ganztägigen Einträgen und als «frei» markierten Terminen.
- **Mindestabstand je Kalender**, etwa 30 Minuten zu privaten Terminen mit Anfahrt und
  5 Minuten zu Besprechungen im Haus.
- **Bereiche** mit eigener Zieladresse, etwa «Beratung» an die Geschäftsadresse und
  «Privat» an die private. Die Einladung landet so direkt im richtigen Kalender. Jeder
  Bereich hat einen kurzen Link (`/beratung`) und kann eine eigene Akzentfarbe und ein Logo
  tragen. Bereiche lassen sich aus der öffentlichen Auswahl ausblenden und sind dann nur
  über ihren Link erreichbar.
- **Freie Dauer**: der Gast wählt Tag, Beginn und Ende selbst. Angeboten wird nur, was ab
  der gewählten Startzeit tatsächlich hineinpasst.
- **Empfohlene Zeiten**, die den Tag nicht zerstückeln (Tagesbeginn, Anschluss an
  bestehende Termine, Mittag, Tagesende), dazu ein **Wochenmuster** je Bereich
  (zum Beispiel «Dienstag, Donnerstag vormittags»).
- **Randzeiten auf Anfrage**: mit `?anfrage=1` werden auch Zeiten ausserhalb der Bürozeit
  buchbar, deutlich markiert in Mail und Kalendertitel.
- **Echte Kalendereinladung** (ICS, `METHOD:REQUEST`) an den Inhaber und als Bestätigung
  an den Gast, über ein beliebiges SMTP-Konto.
- **Absage per Link** für Gast und Inhaber (je ein eigener Link), mit `METHOD:CANCEL`: der Termin verschwindet
  von selbst aus den Kalendern, und die Zeit wird wieder frei.
- **Ferien als Markierung** im Monatskalender, ohne etwas zu sperren.
- **Schutz vor Doppelbuchungen**: jede Buchung belegt Zeiteinheiten mit eindeutigem
  Schlüssel in der Datenbank, und ist ein Kalender nicht erreichbar, wird gar nicht gebucht.
- **Missbrauchsschutz**: Höchstzahl Buchungen je Mailadresse und IP-Adresse, verstecktes
  Feld gegen Bots, Bereinigung aller Eingaben, Sicherheitskopfzeilen (CSP, HSTS).
- **Datenschutzfreundlich**: keine Cookies, keine fremden Schriften oder Skripte, keine
  Statistik. Impressum und Datenschutzerklärung werden aus der Konfiguration erzeugt.

## Schnellstart mit Docker

```bash
git clone https://github.com/<konto>/buchungstool.git
cd buchungstool
cp buchung.env.example buchung.env
# buchung.env ausfüllen: Kalenderlinks, Bereiche, SMTP, Impressum
docker compose up -d --build
```

Die Seite läuft danach auf `http://127.0.0.1:3000`. Für den Betrieb im Netz gehört ein
Reverse Proxy mit HTTPS davor, etwa Caddy:

```
termin.example.com {
    reverse_proxy 127.0.0.1:3000
}
```

Änderungen an `buchung.env` brauchen keinen neuen Build: `docker compose up -d` genügt.
Die Datenbank (SQLite) liegt im Volume `buchung_data` und überlebt Neustarts und Updates.

## ICS-Links finden

- **Proton Calendar**: Einstellungen, Kalender, beim gewünschten Kalender «Teilen»,
  «Link erstellen».
- **Microsoft 365 / Outlook im Web**: Einstellungen, Kalender, Freigegebene Kalender,
  «Kalender veröffentlichen», Berechtigung «Kann anzeigen, wann ich beschäftigt bin»
  genügt, dann den ICS-Link kopieren.
- **Google Kalender**: Einstellungen des Kalenders, «Privatadresse im iCal-Format».
- **iCloud**: Kalender freigeben, «Öffentlicher Kalender», Link mit `webcal://` durch
  `https://` ersetzen.

Diese Links sind geheim: wer sie hat, kann den Kalender lesen. Sie stehen deshalb nur in
`buchung.env` und nie im Code.

Gut zu wissen: Veröffentlichte Feeds aktualisieren sich je nach Anbieter mit Verzögerung.
Die Seite hält Feeds zusätzlich zwei Minuten im Zwischenspeicher, und ein Vorlauf
(`VORLAUF_STUNDEN`) fängt Verzögerungen ab. Ob ein Feed aktuell ist, lässt sich mit einem
Testeintrag prüfen.

## Konfiguration

Alle Einstellungen stehen kommentiert in [`buchung.env.example`](buchung.env.example).
Die wichtigsten:

| Variable | Bedeutung |
|---|---|
| `INHABER_NAME` | Name im Titel, in den Einladungen und als Unterschrift |
| `SEITEN_URL` | Öffentliche Adresse der Seite, für die Absage-Links (Pflicht) |
| `KALENDER` | Namen der Kalender, Komma getrennt; je Name `KALENDER_<NAME>_URL` und optional `_PUFFER` |
| `BEREICHE` | Namen der Bereiche; je Name `BEREICH_<NAME>_NAME`, `_MAIL`, `_HINWEIS`, `_AKZENT`, `_LOGO`, `_WUNSCHZEITEN` |
| `BEREICHE_OEFFENTLICH` | Bereiche, die ohne eigenen Link zur Auswahl stehen |
| `VON_UHR`, `BIS_UHR`, `ARBEITSTAGE` | Bürozeit und Wochentage |
| `KALENDER_IGNORIEREN` | Titel, die nie blockieren, etwa `Ferien,Stand-up` |
| `MAIL_SMTP_HOST`, `MAIL_USER`, `MAIL_PASS` | Versand der Einladungen |

Logos gehören nach `public/marke/` und werden mit `BEREICH_<NAME>_LOGO=/marke/datei.png`
eingebunden.

## Entwicklung

```bash
npm ci
cp buchung.env.example .env.local      # ausfüllen; next dev liest .env.local
echo 'DATABASE_URL="file:./dev.db"' >> .env.local
npx prisma generate
DATABASE_URL="file:./dev.db" npx prisma db push
npm run dev
npm test            # Tests für Zeitberechnung, Kalender, Einladungen, Belegung
```

Aufbau: Next.js (App Router) mit Server Actions, Prisma mit SQLite, `ical.js` zum Lesen
der Feeds, `nodemailer` für den Versand. Die Zeitberechnung in `lib/slots.ts` ist frei von
Ein- und Ausgabe und vollständig getestet. Tests und `scripts/sicherheit.ts` prüfen, dass
Eingaben der Gäste weder Felder noch Teilnehmer der Kalendereinladung verändern können.

## Grenzen

- Die Oberfläche ist Deutsch.
- Die Einladungen tragen derzeit die Zeitzone Europe/Zurich (Mitteleuropäische Zeit).
  Für andere Zeitzonen muss `lib/ical.ts` angepasst werden.
- Es gibt keine Übersicht der Buchungen für den Inhaber; massgeblich sind die
  Einladungen im eigenen Kalender.
- Es gibt keine Videokonferenz-Links. Den Ort (auch «online») gibt der Gast an.
- Fällt ein Kalender aus, nennt die Seite das, ohne den Kalender zu benennen, und nimmt
  keine Buchungen an, bis er wieder erreichbar ist.
- Die Sperre je IP-Adresse setzt genau einen Reverse Proxy voraus, der
  `X-Forwarded-For` ergänzt.

## Lizenz

[GNU Affero General Public License v3.0](LICENSE). Wer das Buchungstool verändert und
als Dienst für andere betreibt, muss den geänderten Quellcode ebenfalls zugänglich machen.
