# Mitarbeiten

Beiträge sind willkommen: Fehlermeldungen, Verbesserungen der Dokumentation,
Übersetzungen und Code.

## Bevor du anfängst

- Für grössere Änderungen zuerst ein Issue eröffnen, damit wir die Richtung
  klären, bevor Arbeit verloren geht.
- Das Projekt soll klein bleiben: eine Person, mehrere Kalender, wenig Betrieb.
  Funktionen wie Benutzerkonten oder Teams passen besser zu
  [Tymeslot](https://tymeslot.app) oder [Cal.diy](https://github.com/calcom/cal.diy).

## Sprache im Code

Bezeichner, Kommentare und Oberfläche sind Deutsch (Schweizer Schreibweise, also
immer «ss», kein Eszett). Das ist eine bewusste Entscheidung des ursprünglichen Projekts.
Issues und Pull Requests dürfen gern auf Englisch sein.

Ein paar Begriffe zur Orientierung:

| Deutsch | Bedeutung |
|---|---|
| Bereich | area / role with its own target address |
| Belegung, Einheit | booked five-minute unit (double-booking lock) |
| Puffer | buffer around existing events |
| Vorlauf | minimum lead time |
| Wunschzeit | preferred time (weekly pattern) |
| Anfrage | off-hours request |
| Absage | cancellation |

## Ablauf

```bash
npm ci
npm run typecheck && npm run lint && npm test && npm run sicherheit
npm run build
```

Alle Prüfungen laufen auch in GitHub Actions; ein Pull Request sollte sie
bestehen. Neue Logik braucht Tests, besonders alles in `lib/slots.ts`,
`lib/ical.ts` und `lib/db.ts`.

Mit dem Einreichen eines Beitrags stimmst du zu, dass er unter der
AGPL-3.0 dieses Projekts veröffentlicht wird.
