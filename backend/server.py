"""Shared MQSF calendar. Python 3.10+, SQLite, and a WSGI server."""

import argparse
from contextlib import closing
from datetime import datetime, timezone
from http import HTTPStatus
import hashlib
import hmac
import json
import mimetypes
import os
from pathlib import Path
import re
import sqlite3
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / "side-events"
FIELDS = ("date", "start", "end", "title", "description", "audience", "organizers")
PUBLIC_COLUMNS = ", ".join((*FIELDS, "id", "version", "updated_at", "table_number"))


class RequestError(Exception):
    def __init__(self, status, message):
        self.status, self.message = status, message


def minutes(value):
    if not isinstance(value, str) or not re.fullmatch(r"(?:[01]\d|2[0-3]):[0-5]\d", value):
        raise RequestError(400, "Use a time between 00:00 and 23:59.")
    hours, minute = map(int, value.split(":"))
    return hours * 60 + minute


def validate_event(data, config):
    if not isinstance(data, dict):
        raise RequestError(400, "Send an event as a JSON object.")
    event = {}
    for key, limit in {"date": 10, "start": 5, "end": 5, "title": 120,
                       "description": 3000, "audience": 300, "organizers": 200}.items():
        value = data.get(key)
        if not isinstance(value, str) or not value.strip() or len(value) > limit:
            raise RequestError(400, f"{key.capitalize()} is required (maximum {limit} characters).")
        event[key] = value.strip()
    day = next((d for d in config["days"] if d["date"] == event["date"]), None)
    if not day:
        raise RequestError(400, "Choose 14 or 15 October 2026.")
    start, end = minutes(event["start"]), minutes(event["end"])
    if start >= end:
        raise RequestError(400, "The end time must be after the start time on the same day.")
    if (day["start"] and start < minutes(day["start"])) or (day["end"] and end > minutes(day["end"])):
        raise RequestError(400, f"Choose a time within the published hours for {event['date']}.")
    return event


def read_json(environ):
    if environ.get("CONTENT_TYPE", "").split(";")[0].strip() != "application/json":
        raise RequestError(415, "Send JSON using Content-Type: application/json.")
    try:
        length = int(environ.get("CONTENT_LENGTH", "0"))
        if not 0 < length <= 20000:
            raise RequestError(413, "The event is too large or empty.")
        value = json.loads(environ["wsgi.input"].read(length))
    except (ValueError, UnicodeError):
        raise RequestError(400, "The event could not be read. Send valid JSON.") from None
    if not isinstance(value, dict):
        raise RequestError(400, "Send a JSON object.")
    return value


def contact_email(data):
    value = data.get("contact_email", "")
    if not isinstance(value, str) or len(value) > 254 or "\r" in value or "\n" in value:
        raise RequestError(400, "Enter a valid private contact email address.")
    email = value.strip()
    if not re.fullmatch(r"[^\s<>@,;]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,}", email):
        raise RequestError(400, "Enter a valid private contact email address.")
    return email


def organizer_access(environ, secret):
    authorization = environ.get("HTTP_AUTHORIZATION")
    if not authorization:
        return False
    if not isinstance(secret, str) or not re.fullmatch(r"[!-~]{32,256}", secret):
        raise RequestError(503, "Organizer access is not configured. Contact the MQSF organizers.")
    match = re.fullmatch(r"Bearer ([!-~]{32,256})", authorization)
    if not match or not hmac.compare_digest(hashlib.sha256(match[1].encode()).digest(), hashlib.sha256(secret.encode()).digest()):
        raise RequestError(401, "Organizer access key is invalid. Sign in again or sign out to use the contact email.")
    return True


def create_app(database=None, allowed_origins=None, demo=False, seed_examples=False, organizer_key=None):
    if organizer_key is None:
        organizer_key = os.environ.get("ORGANIZER_ACCESS_KEY")
    if allowed_origins is None:
        allowed_origins = tuple(filter(None, os.environ.get("MQSF_ALLOWED_ORIGINS", "").split(",")))
    config = json.loads((PUBLIC / "conference.json").read_text())
    for day in config["days"]:
        datetime.strptime(day["date"], "%Y-%m-%d")
        if day["start"] is not None:
            minutes(day["start"])
        if day["end"] is not None:
            minutes(day["end"])
        if day["start"] and day["end"] and minutes(day["start"]) >= minutes(day["end"]):
            raise ValueError("Conference start must be before end.")
    database = Path(database or os.environ.get("MQSF_DB", ROOT / ".data/events.sqlite3"))
    database.parent.mkdir(parents=True, exist_ok=True)

    def connect():
        connection = sqlite3.connect(database, timeout=10)
        connection.row_factory = sqlite3.Row
        return connection

    with closing(connect()) as connection, connection:
        connection.execute("PRAGMA journal_mode=WAL")
        connection.execute("""CREATE TABLE IF NOT EXISTS events (
            id TEXT PRIMARY KEY, date TEXT NOT NULL, start TEXT NOT NULL, end TEXT NOT NULL,
            title TEXT NOT NULL, description TEXT NOT NULL, audience TEXT NOT NULL,
            version INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL,
            organizers TEXT NOT NULL DEFAULT ''
        )""")
        if "organizers" not in {row["name"] for row in connection.execute("PRAGMA table_info(events)")}:
            connection.execute("ALTER TABLE events ADD COLUMN organizers TEXT NOT NULL DEFAULT ''")
        if "contact_email" not in {row["name"] for row in connection.execute("PRAGMA table_info(events)")}:
            migration = (ROOT / "cloudflare/migrations/0003_private_contacts_and_history.sql").read_text()
            connection.executescript("BEGIN;\n" + migration + "\nCOMMIT;")
        migration = (ROOT / "cloudflare/migrations/0004_parallel_session_limit.sql").read_text()
        connection.executescript("BEGIN;\n" + migration + "\nCOMMIT;")
        if "table_number" not in {row["name"] for row in connection.execute("PRAGMA table_info(events)")}:
            migration = (ROOT / "cloudflare/migrations/0005_table_assignments.sql").read_text()
            connection.executescript("BEGIN;\n" + migration + "\nCOMMIT;")
        if (demo or seed_examples) and not connection.execute("SELECT 1 FROM events LIMIT 1").fetchone():
            examples = [
                ("2026-10-14", "10:00", "11:15", "MQT developers meeting", "Compare ideas for the next MQT release and discuss opportunities to contribute.", "MQT contributors and anyone interested in contributing"),
                ("2026-10-14", "10:30", "12:00", "Quantum compiler hackathon", "Bring a laptop and explore a compiler problem together. No prepared project needed.", "Developers curious about quantum compilation"),
                ("2026-10-14", "14:00", "15:00", "Open-source quantum coffee", "An informal conversation about maintaining tools, welcoming contributors, and working together.", "Open-source maintainers and new contributors"),
                ("2026-10-15", "09:30", "10:30", "Error correction meetup", "Exchange practical experiences with error correction tools and find people tackling similar questions.", "Researchers and developers working on QEC"),
                ("2026-10-15", "10:00", "11:30", "Benchmarking working session", "Compare approaches to benchmarks and sketch a small experiment together.", "Anyone building or evaluating quantum software"),
            ]
            for values in examples:
                if seed_examples:
                    values = (*values[:3], values[3] + " (example)", *values[4:])
                connection.execute("INSERT INTO events (id, date, start, end, title, description, audience, version, updated_at, organizers) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, 'Example organizer')",
                                   (str(uuid4()), *values, datetime.now(timezone.utc).isoformat()))

    def application(environ, start_response):
        origin = environ.get("HTTP_ORIGIN")
        server_origin = environ.get("wsgi.url_scheme", "http") + "://" + environ.get("HTTP_HOST", "")
        permitted_origin = origin and (origin == server_origin or origin in allowed_origins)
        headers = [("X-Content-Type-Options", "nosniff"), ("Referrer-Policy", "strict-origin-when-cross-origin")]
        if permitted_origin:
            headers += [("Access-Control-Allow-Origin", origin), ("Vary", "Origin")]

        def reply(status, body, content_type="application/json; charset=utf-8", extra=()):
            if isinstance(body, dict):
                body = json.dumps(body, ensure_ascii=False).encode()
            start_response(f"{status} {HTTPStatus(status).phrase}", headers + [
                ("Content-Type", content_type), ("Content-Length", str(len(body))),
                ("Cache-Control", "no-store"), *extra])
            return [body]

        try:
            # Serve the main program at root and the calendar at either supported subpath.
            path = environ.get("PATH_INFO", "/")
            calendar_path = False
            for prefix in ("/mqsf", "/side-events"):
                if path == prefix:
                    return reply(308, b"", extra=[("Location", path + "/")])
                if path.startswith(prefix + "/"):
                    path = path[len(prefix):]
                    calendar_path = True
                    break
            method = environ["REQUEST_METHOD"]
            match = re.fullmatch(r"/api/(?:meetups|events)(?:/([a-f0-9-]{36}))?", path)
            login = path == "/api/organizer"
            if not match and not login:
                filename = "index.html" if path == "/" else path.lstrip("/")
                public = PUBLIC if calendar_path else ROOT
                allowed = filename in {
                    "index.html", "styles.css", "app.mjs", "calendar.mjs", "config.js",
                    "conference.json"
                } if calendar_path else filename in {"index.html", "styles.css", "script.js"}
                asset = (public / filename).resolve()
                if not calendar_path and filename.startswith("assets/"):
                    allowed = asset.is_relative_to(ROOT / "assets") and asset.is_file()
                if method != "GET" or not allowed:
                    raise RequestError(404, "Not found.")
                mime = "text/javascript" if filename.endswith(".mjs") else mimetypes.guess_type(filename)[0]
                policy = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
                return reply(200, asset.read_bytes(), mime or "application/octet-stream", [("Content-Security-Policy", policy)])
            if origin and not permitted_origin:
                raise RequestError(403, "This website is not configured to edit the calendar.")
            if method == "OPTIONS":
                return reply(204, b"", extra=[("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS"),
                                              ("Access-Control-Allow-Headers", "Content-Type, Authorization")])
            if login:
                if method != "POST":
                    raise RequestError(405, "Method not allowed.")
                if not organizer_access(environ, organizer_key):
                    raise RequestError(401, "Enter the organizer access key.")
                return reply(200, {"organizer": True})
            event_id = match.group(1)
            with closing(connect()) as connection, connection:
                if method == "GET" and not event_id:
                    events = [dict(row) for row in connection.execute(f"SELECT {PUBLIC_COLUMNS} FROM events ORDER BY date, start, end, id")]
                    return reply(200, {"events": events, "demo": demo})
                if method not in ("POST", "PUT", "DELETE") or (method == "POST") == bool(event_id):
                    raise RequestError(405, "Method not allowed.")
                organizer = organizer_access(environ, organizer_key)
                data = read_json(environ)
                if event_id:
                    if type(data.get("version")) is not int or data["version"] < 1:
                        raise RequestError(400, "The event version is missing. Reload the event and try again.")
                email = "" if organizer and event_id else contact_email(data)
                assign_table = organizer and "table_number" in data
                table = data["table_number"] if assign_table else None
                if assign_table and table is not None and (type(table) is not int or table not in (1, 2, 3)):
                    raise RequestError(400, "Choose table 1, 2, 3, or not assigned.")
                if method == "DELETE":
                    result = connection.execute("DELETE FROM events WHERE id=? AND version=? AND (? OR contact_email=? COLLATE NOCASE)", (event_id, data["version"], organizer, email))
                else:
                    event = validate_event(data, config)
                    values = tuple(event[key] for key in FIELDS)
                    now = datetime.now(timezone.utc).isoformat()
                    if method == "POST":
                        event_id = str(uuid4())
                        # Choose and reserve a table atomically, as in the Cloudflare API.
                        saved = connection.execute("""WITH assignment AS (
                            SELECT COALESCE(?, (SELECT MIN(number) FROM (SELECT 1 AS number UNION ALL SELECT 2 UNION ALL SELECT 3) AS tables
                                WHERE NOT EXISTS (SELECT 1 FROM events WHERE date=? AND start<? AND end>? AND table_number=tables.number))) AS number
                            ) INSERT INTO events (id, date, start, end, title, description, audience, organizers, contact_email, version, updated_at, table_number)
                            SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, number FROM assignment WHERE number IS NOT NULL RETURNING id""",
                            (table, event["date"], event["end"], event["start"], event_id, *values, email, now)).fetchone()
                        if not saved:
                            raise RequestError(422, "No table is free for this entire time slot. At most 3 sessions can run at the same time. Choose another time or contact the MQSF organizers.")
                    else:
                        result = connection.execute("""UPDATE events SET date=?, start=?, end=?, title=?, description=?, audience=?, organizers=?,
                            table_number=CASE WHEN ? THEN ? ELSE table_number END, updated_at=?, version=version+1
                            WHERE id=? AND version=? AND (? OR contact_email=? COLLATE NOCASE)""", (*values, assign_table, table, now, event_id, data["version"], organizer, email))
                if method != "POST" and not result.rowcount:
                    existing = connection.execute("SELECT contact_email=? COLLATE NOCASE AS verified FROM events WHERE id=?", (email, event_id)).fetchone()
                    if not existing:
                        raise RequestError(404, "This event was removed. Your changes have not been saved.")
                    if not organizer and not existing["verified"]:
                        raise RequestError(403, "The contact email does not match this event. Enter the address used to create it, or contact the MQSF organizers.")
                    raise RequestError(409, "Someone changed this event. Load the latest version before saving or deleting it.")
                if method == "DELETE":
                    connection.commit()
                    return reply(200, {"deleted": event_id})
                event = dict(connection.execute(f"SELECT {PUBLIC_COLUMNS} FROM events WHERE id=?", (event_id,)).fetchone())
                connection.commit()
                return reply(201 if method == "POST" else 200, {"event": event})
        except RequestError as error:
            return reply(error.status, {"error": error.message})
        except sqlite3.Error as error:
            if "MQSF_MAX_PARALLEL_SESSIONS" in str(error):
                return reply(422, {"error": "At most 3 sessions can run at the same time. Choose another time. Your changes have not been saved."})
            if "MQSF_TABLE_OCCUPIED" in str(error):
                return reply(422, {"error": "The assigned table is already occupied at that time. Choose another time or ask the MQSF organizers to change the table assignment. Your changes have not been saved."})
            return reply(503, {"error": "The calendar could not save or load events. Please try again. Your draft is still here."})

    return application


if __name__ == "__main__":
    from wsgiref.simple_server import make_server, WSGIRequestHandler

    class QuietHandler(WSGIRequestHandler):
        def log_message(self, format, *args):
            pass  # The application does not retain visitor addresses or request logs.

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8030)
    parser.add_argument("--demo", action="store_true", help="Use a separate local database with sample events.")
    parser.add_argument("--seed-examples", action="store_true", help="Add labelled example events to an empty production database, then exit.")
    options = parser.parse_args()
    if options.demo and options.seed_examples:
        parser.error("Use --demo for the local preview or --seed-examples for the production database.")
    database = ROOT / ".data/demo.sqlite3" if options.demo else None
    local_app = create_app(database, demo=options.demo, seed_examples=options.seed_examples)
    if options.seed_examples:
        print("Example seeding completed. Existing calendars are left unchanged.", flush=True)
        raise SystemExit(0)
    print(f"Calendar: http://127.0.0.1:{options.port}/mqsf/", flush=True)
    with make_server("127.0.0.1", options.port, local_app, handler_class=QuietHandler) as server:
        server.serve_forever()
