# Buchungstool

[Deutsche Fassung](README.md)

A self-hosted appointment booking page that checks **several calendars from different
providers at once**. Free, open source, no account with any service required.

## The problem

If you use Proton Calendar privately and Microsoft 365 for work, booking services fall
short. Calendly, TidyCal, Microsoft Bookings and the like connect to Google or Microsoft,
but not to Proton, and usually only to one account per provider. Guests end up booking
slots that are already taken in your other calendar.

## The idea

Almost every calendar can be shared as an **ICS link** (iCal subscription): Proton,
Microsoft 365 and Outlook, Google, iCloud, Nextcloud, Fastmail and many more. Buchungstool
reads any number of these links and only offers a time slot if it is free in **all** of
them. It needs no access to your accounts, just the read-only links.

Guests only ever see free or busy. Titles, locations and attendees never leave the server.

## Features

- **Availability from any number of ICS calendars**, including recurring events, time
  zones (also Outlook's Windows zone names), all-day entries and events marked as "free".
- **Buffer per calendar**, for example 30 minutes around private appointments that need
  travel and 5 minutes around in-house meetings.
- **Areas** with their own target address, e.g. "Consulting" to your business address and
  "Private" to your private one, so the invitation lands in the right calendar. Each area
  has a short link (`/beratung`), an optional accent colour and logo, and can be hidden
  from the public selection so it is only reachable through its link.
- **Free duration**: guests pick day, start and end themselves; only what actually fits
  from the chosen start time is offered.
- **Recommended times** that don't fragment your day (start of day, right after existing
  appointments, around noon, end of day), plus a **weekly pattern** per area.
- **Off-hours on request**: with `?anfrage=1`, times outside office hours become bookable
  and are clearly marked in the e-mail and the event title.
- **Real calendar invitations** (ICS, `METHOD:REQUEST`) to the owner and as confirmation
  to the guest, via any SMTP account.
- **Cancellation links** for guest and owner (one each) using `METHOD:CANCEL`: the event disappears
  from both calendars and the slot becomes free again.
- **Holidays as markers** in the month view, without blocking anything.
- **No double bookings**: each booking claims time units with a unique key in the
  database, and if any calendar is unreachable, nothing is booked at all.
- **Abuse protection**: per-address and per-IP limits, honeypot field, input sanitising,
  security headers (CSP, HSTS).
- **Privacy-friendly**: no cookies, no third-party fonts or scripts, no analytics. Legal
  notice and privacy statement are generated from the configuration.

## Quick start with Docker

```bash
git clone https://github.com/<account>/buchungstool.git
cd buchungstool
cp buchung.env.example buchung.env
# fill in buchung.env: calendar links, areas, SMTP, legal notice
docker compose up -d --build
```

The page then runs on `http://127.0.0.1:3000`. Put a reverse proxy with HTTPS in front of
it for public use, for example Caddy:

```
booking.example.com {
    reverse_proxy 127.0.0.1:3000
}
```

Changes to `buchung.env` need no rebuild: `docker compose up -d` is enough. The SQLite
database lives in the `buchung_data` volume and survives restarts and updates.

## Finding your ICS links

- **Proton Calendar**: Settings, Calendars, "Share" on the calendar, "Create link".
- **Microsoft 365 / Outlook on the web**: Settings, Calendar, Shared calendars, "Publish a
  calendar", permission "Can view when I'm busy" is enough, then copy the ICS link.
- **Google Calendar**: calendar settings, "Secret address in iCal format".
- **iCloud**: share the calendar as "Public Calendar" and replace `webcal://` with
  `https://`.

These links are secrets: whoever has them can read the calendar. They belong in
`buchung.env` only, never in the code.

## Configuration

All settings are documented in [`buchung.env.example`](buchung.env.example) (comments in
German). The most important ones:

| Variable | Meaning |
|---|---|
| `INHABER_NAME` | Owner name in the title, invitations and e-mail signature |
| `SEITEN_URL` | Public URL of the page, used for cancellation links (required) |
| `KALENDER` | Calendar names, comma-separated; per name `KALENDER_<NAME>_URL` and optional `_PUFFER` (buffer in minutes) |
| `BEREICHE` | Area names; per name `BEREICH_<NAME>_NAME`, `_MAIL`, `_HINWEIS`, `_AKZENT`, `_LOGO`, `_WUNSCHZEITEN` |
| `BEREICHE_OEFFENTLICH` | Areas offered without a dedicated link |
| `VON_UHR`, `BIS_UHR`, `ARBEITSTAGE` | Office hours and weekdays (1 = Monday) |
| `KALENDER_IGNORIEREN` | Event titles that never block, e.g. `Ferien,Stand-up` |
| `MAIL_SMTP_HOST`, `MAIL_USER`, `MAIL_PASS` | Sending the invitations |

## Development

```bash
npm ci
cp buchung.env.example .env.local      # fill in; next dev reads .env.local
echo 'DATABASE_URL="file:./dev.db"' >> .env.local
npx prisma generate
DATABASE_URL="file:./dev.db" npx prisma db push
npm run dev
npm test
```

Stack: Next.js (App Router) with Server Actions, Prisma with SQLite, `ical.js` for parsing
feeds, `nodemailer` for sending. The slot calculation in `lib/slots.ts` is free of I/O and
fully tested.

## Limitations

- The user interface is in German.
- Invitations currently use the Europe/Zurich time zone (Central European Time); other
  zones require a change in `lib/ical.ts`.
- There is no admin overview of bookings; the invitations in your own calendar are the
  record.
- No video conference links are generated; the guest enters the location (or "online").
- If a calendar is unreachable, the page says so without naming it and accepts no bookings
  until it is back.
- The per-IP limit assumes exactly one reverse proxy that appends `X-Forwarded-For`.

## License

[GNU Affero General Public License v3.0](LICENSE). If you modify Buchungstool and run it
as a service for others, you must make your modified source code available as well.
