# Sicherheit

## Lücken melden

Bitte keine öffentlichen Issues für Sicherheitslücken. Stattdessen über GitHub
«Report a vulnerability» im Reiter *Security* dieses Repos melden (private
Meldung). Hilfreich sind: betroffene Version oder Commit, Schritte zum
Nachstellen und die mögliche Auswirkung.

Gemeldete Lücken werden so schnell wie möglich geprüft. Ein fester Zeitrahmen
kann für ein Freizeitprojekt nicht zugesichert werden.

## Unterstützte Versionen

Sicherheitskorrekturen gibt es für die jeweils neueste Version auf `main` und
das neueste Abbild `ghcr.io/villagio88/buchungstool:latest`.

## Was das Projekt selbst schützt

- Gästeeingaben können die Kalendereinladung nicht verändern (Maskierung nach
  RFC 5545, Teilnehmerparameter in Anführungszeichen, Tests in
  `lib/ical.test.ts` und `scripts/sicherheit.ts`).
- Keine Titel, Orte oder Teilnehmer aus den Kalendern gelangen zu den Gästen.
- Absage-Links tragen zufällige Tokens, getrennt für Gast und Inhaber.
- Grenzen je Mailadresse und IP, Sicherheitskopfzeilen, Betrieb ohne root.

## Was der Betreiber schützen muss

- `buchung.env` enthält Kalenderlinks und ein Mailpasswort: nur für den
  Betreiber lesbar ablegen, nie einchecken.
- HTTPS über einen Reverse Proxy; genau ein Proxy, der `X-Forwarded-For`
  ergänzt, sonst greift die Grenze je IP nicht zuverlässig.
- Den Server selbst absichern (Updates, SSH nur mit Schlüssel, Firewall) und
  das Abbild regelmässig aktualisieren.
