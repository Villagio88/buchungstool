# Änderungen

## 0.3.0 (Oktober 2026)

- Weitere Pfade je Bereich (`BEREICH_<NAME>_ALIAS`).
- Eigene Schrift je Bereich aus `public/marke/` (`BEREICH_<NAME>_SCHRIFT`,
  `BEREICH_<NAME>_SCHRIFTDATEI`).
- Eigener Hinweis bei den weiteren Zeiten (`BEREICH_<NAME>_HINWEIS_WEITERE`) und
  eigene Fusszeile (`FUSSZEILE`).

## 0.2.0 (Oktober 2026)

- Datenbank über das in Node 24 eingebaute `node:sqlite` statt Prisma: weniger
  Abhängigkeiten, keine bekannten Lücken in den Laufzeitpaketen. Bestehende
  Datenbanken werden weiterverwendet; der Container übergibt das Volume beim
  Start dem Benutzer `node`.
- Kalender-Feeds mit eigenem Zwischenspeicher (2 Minuten): fällt ein Feed aus,
  wird nicht mehr gegen veraltete Daten gebucht.
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

- Erste Fassung: Verfügbarkeit aus beliebig vielen ICS-Kalendern,
  Bereiche, freie Dauer, empfohlene Zeiten, Einladungen und Absage per Link.
