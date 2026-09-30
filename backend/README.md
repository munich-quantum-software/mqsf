# MQSF shared side-event calendar

The public GitHub Pages calendar uses [Cloudflare Workers and D1](../cloudflare/README.md).
This Python service provides the local preview with a separate SQLite database.

The calendar markup is in the main `index.html`, with its scripts, styles, and configuration in `side-events/`.
The small Python WSGI service stores events in SQLite.
No application accounts, cookies, analytics, or application visitor logs are used.
Event fields, a private contact email, revision metadata, and private before/after history are stored in SQLite.
Contact addresses are never returned by the public API. Editing and deleting require the event's original contact email; public edits cannot replace it.
The preview uses the same history migration as Cloudflare, but sends no Discord notifications. Use fictitious addresses for local tests.
Hosting providers and reverse proxies may keep their own access logs; configure those separately.

## Local review

From the repository root, with Python 3.10 or newer:

```sh
python3 backend/server.py --demo --port 8030
```

Open <http://127.0.0.1:8030/> for the main program and follow **Meet-Ups** to the calendar.
The calendar's direct link is <http://127.0.0.1:8030/#side-events>; the older `/mqsf/` and `/side-events/` links redirect there.
The labelled sample events are kept in `.data/demo.sqlite3`.
Stop the server with Ctrl+C. Without `--demo`, the app uses a separate, initially empty `.data/events.sqlite3`.
The local development server binds only to this computer. Use a production WSGI server for public hosting.

```sh
python3 backend/check.py
node backend/check-calendar.mjs
```

The checks use a temporary database and do not modify the preview.

## Program hours

`side-events/conference.json` follows the [main program](https://munich-quantum-software.github.io/mqsf-2026-program/):
both days start with registration at 08:00, talks run 09:00–17:55, and networking starts at 18:00 with an open end.
The start is enforced by the form and server; the end remains `null` so evening events are allowed.
If the program changes, update the hours and explanatory note, then restart the backend.
`viewStart` and `viewEnd` are display defaults only; the calendar expands to include events outside that range.
All dates/times refer to Munich local time (Europe/Berlin, CEST on 14–15 October 2026).

The calendar uses the main page's header, fonts, animated background, and sponsor section.
