# Buchungstool

[Deutsche Fassung](README.md) · [CI](https://github.com/Villagio88/buchungstool/actions) · License AGPL-3.0

A self-hosted appointment booking page that reads availability from **several calendars
from different providers at once**, via their ICS links. No account with a booking
service, no access to mailboxes, data on your own server.

![Booking page with month view and recommended times](docs/screenshot.png)

## What it is for

For people whose appointments live in calendars that cannot be connected to each other:
Proton Calendar privately, Microsoft 365 at work, perhaps a school or club calendar on
top. The well-known booking services (Calendly, TidyCal, Microsoft Bookings) connect by
signing in to Google, Microsoft or Apple (Bookings only to its own Microsoft 365). Proton offers neither CalDAV nor an API, and
many organisations do not allow third-party services to connect to their Microsoft 365
accounts.

Almost every calendar can be shared as an **ICS link**, often as "busy only". Buchungstool
reads any number of these links and only offers a slot if it is free in all of them.
Guests only see free or busy; titles, locations and attendees never leave the server.

### Honest positioning

The idea is not unique, and nobody should find that out only after installing it:

| Tool | ICS links as source | Self-hosted | License | Difference |
|---|---|---|---|---|
| **Buchungstool** | yes, any number | yes (Docker) | AGPL-3.0 | small, one person, several roles with their own target address, no accounts |
| [Tymeslot](https://tymeslot.app) | yes, per [feature list](https://tymeslot.app/features) ("feed URL") | yes (Docker), also hosted | AGPL-3.0 | broader feature set, user accounts |
| [Cal.diy](https://github.com/calcom/cal.diy) (community edition of Cal.com) | yes, "ICS Feed" app | yes, involved | MIT | very extensive, for teams; self-hosting is involved |
| [Proton Booking Pages](https://proton.me/support/calendar-appointment-scheduling) | Proton calendars | no | proprietary | part of Proton since April 2026; ideal if everything is in Proton |
| Calendly, TidyCal | no (sign-in with Google, Microsoft, Apple) | no | proprietary | mature, but no Proton and data stays with the provider |
| Microsoft Bookings | no (only its own Microsoft 365 calendar) | no | proprietary | included in Microsoft 365, within your own organisation |

As of October 2026, no warranty. If you only use Proton, Proton's booking pages serve you
better. If you need many features and accounts, look at Tymeslot. Buchungstool is built
for **one person** offering appointments **across several providers** while running as
little software as possible.

## Features

- **Availability from any number of ICS calendars**, including recurring events, time
  zones (also Outlook's Windows names), all-day entries and events marked as free.
- **Buffer per calendar**, e.g. 30 minutes around private appointments, 5 around meetings.
- **Areas** with their own target address so invitations land in the right calendar; each
  has a short link (`/beratung`), accent colour, optional logo, and can be hidden.
- **Free duration**: guests choose day, start and end; only what fits is offered.
- **Recommended times** that don't fragment your day, plus a **weekly pattern** per area.
- **Off-hours on request** via `?anfrage=1`, clearly marked.
- **Real calendar invitations** (ICS) to owner and guest via any SMTP account, in UTC.
- **Cancellation links**, one each for guest and owner, using `METHOD:CANCEL`.
- **No double bookings**: five-minute units with a unique key; if any calendar is
  unreachable, nothing is booked.
- **Data minimisation**: IP addresses deleted after 7 days, name, e-mail, location and
  message 90 days after the appointment (both configurable). No cookies, no third-party
  scripts or fonts, no analytics.
- **Abuse protection**: per-address and per-IP limits, honeypot, input sanitising,
  security headers (CSP, HSTS).

## Quick start with Docker

```bash
git clone https://github.com/Villagio88/buchungstool.git
cd buchungstool
cp buchung.env.example buchung.env      # fill in calendars, areas, SMTP, legal notice
docker compose up -d --build
curl http://127.0.0.1:3000/gesund        # {"ok":true,...}
```

A prebuilt image is available as `ghcr.io/villagio88/buchungstool`. Put a reverse proxy
with HTTPS in front, e.g. Caddy (`reverse_proxy 127.0.0.1:3000`). Changes to
`buchung.env` need no rebuild. For a consistent backup while running, use SQLite's
`VACUUM INTO` (see the German README for the exact command) and copy the result out;
copying the database file alone may miss recent writes.

## Finding your ICS links

- **Proton Calendar**: Settings, Calendars, "Share", "Create link", "Limited view" (busy
  only). Paid plans only; Proton states updates may take up to eight hours.
- **Microsoft 365 / Outlook on the web**: Settings, Calendar, Shared calendars, "Publish a
  calendar", permission "Can view when I'm busy", copy the ICS link.
- **Google Calendar**: calendar settings, "Secret address in iCal format".
- **iCloud**: share as "Public Calendar", replace `webcal://` with `https://`.

These links are secrets. Keep them in `buchung.env` only and regenerate them if leaked.
A lead time (`VORLAUF_STUNDEN`, default 12) absorbs provider delays.

## For schools and organisations

- Publishing calendars can be blocked by Microsoft 365 or Google Workspace policy, which
  happens in schools. If the option is missing, ask your IT.
- Share "busy only"; it is all Buchungstool needs and protects student and parent data.
- Host in your jurisdiction, send mail through a provider there, set deletion periods.
  Swiss law (revDSG, Art. 19) requires naming the country if data goes abroad. Not legal
  advice.
- There is no user management and no booking overview; each person needs their own
  instance.

## Configuration

All settings are documented in [`buchung.env.example`](buchung.env.example) (comments in
German). Key variables: `INHABER_NAME`, `SEITEN_URL` (required), `KALENDER` with
`KALENDER_<NAME>_URL` and `_PUFFER`, `BEREICHE` with `BEREICH_<NAME>_NAME`, `_MAIL`,
`_HINWEIS`, `_AKZENT`, `_LOGO`, `_WUNSCHZEITEN`, office hours `VON_UHR`, `BIS_UHR`,
`ARBEITSTAGE`, `TZ`, SMTP `MAIL_SMTP_HOST`, `MAIL_SMTP_PORT`, `MAIL_USER`, `MAIL_PASS`,
deletion periods `LOESCHEN_IP_NACH_TAGEN`, `LOESCHEN_PERSONENDATEN_NACH_TAGEN`.

## Operations and development

- `GET /gesund` reports database and calendar reachability as numbers only; used as the
  Docker healthcheck. The container starts as root only to hand `/data` to user `node`,
  then runs as `node`, so volumes from older versions keep working.
- `npm ci`, `cp buchung.env.example .env.local`, `npm run dev`, `npm test`,
  `npm run sicherheit`.
- Stack: Next.js (App Router), SQLite via Node 24's built-in `node:sqlite`, `ical.js`,
  `nodemailer`. Identifiers and comments are in German, see [CONTRIBUTING.md](CONTRIBUTING.md).

## Limitations

German user interface only; no booking overview or user management; no video conference
links; availability is only as fresh as the providers' feeds; the per-IP limit assumes
exactly one reverse proxy appending `X-Forwarded-For`.

## Security and license

Please report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).
License: [GNU Affero General Public License v3.0](LICENSE).

Built with AI assistance (Claude). The logic is covered by automated tests that run on
every change in GitHub Actions.
