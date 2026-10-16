# Änderungen

## 0.2.0 (Oktober 2026)

- Datenbank über das in Node 24 eingebaute `node:sqlite` statt Prisma: weniger
  Abhängigkeiten, keine bekannten Lücken in den Laufzeitpaketen, bestehende
  Datenbanken laufen ohne Umbau weiter.
- Next.js 16.4 und nodemailer 10 (Sicherheitskorrekturen).
- Einladungen in UTC, korrekt in jeder Zeitzone.
- Automatische Löschung: IP-Adressen nach 7 Tagen, Personendaten 90 Tage nach
  dem Termin (einstellbar).
- Healthcheck `/gesund`, Docker-Abbild läuft ohne root, fertiges Abbild in der
  GitHub Container Registry.
- SMTP auf Port 587 verlangt TLS.
- GitHub Actions für Typprüfung, Lint, Tests, Sicherheitsprüfung, Build und
  Docker; Dependabot.

## 0.1.0 (Oktober 2026)

- Erste öffentliche Fassung: Verfügbarkeit aus beliebig vielen ICS-Kalendern,
  Bereiche, freie Dauer, empfohlene Zeiten, Einladungen und Absage per Link.
