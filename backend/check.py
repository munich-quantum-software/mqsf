"""Run with python3 backend/check.py. Uses an isolated, disposable database."""
from concurrent.futures import ThreadPoolExecutor
from io import BytesIO
import json
import sqlite3
from pathlib import Path
from tempfile import TemporaryDirectory

from server import create_app, validate_event, RequestError


def request(app, method="GET", path="/mqsf/api/meetups", data=None, origin=None, content_type="application/json"):
    payload = json.dumps(data).encode() if data is not None else b""
    environ = {"REQUEST_METHOD": method, "PATH_INFO": path, "CONTENT_TYPE": content_type,
               "CONTENT_LENGTH": str(len(payload)), "wsgi.input": BytesIO(payload),
               "wsgi.url_scheme": "http", "HTTP_HOST": "localhost:8030"}
    if origin:
        environ["HTTP_ORIGIN"] = origin
    captured = []
    body = b"".join(app(environ, lambda status, headers: captured.append((int(status[:3]), dict(headers)))))
    assert len(captured) == 1, "Each request must return exactly one response"
    status, headers = captured[0]
    return status, json.loads(body) if body and "application/json" in headers["Content-Type"] else body, headers


with TemporaryDirectory() as directory:
    database = Path(directory) / "events.sqlite3"
    app = create_app(database, allowed_origins=("https://munich-quantum-software.github.io",))
    event = {"date": "2026-10-14", "start": "10:00", "end": "11:00", "title": 'Meetup <script>alert("x")</script>',
             "description": "Bring a laptop.\nEveryone is welcome.", "audience": "Developers & researchers", "organizers": "Alex & Sam", "contact_email": "private@example.test"}
    assert request(app)[1] == {"events": [], "demo": False}
    assert request(app, "POST", data=event, origin="https://unrelated.example")[0] == 403
    assert request(app, "POST", data=event, content_type="text/plain")[0] == 415
    status, data, headers = request(app, "POST", data=event, origin="https://munich-quantum-software.github.io")
    assert status == 201 and headers["Access-Control-Allow-Origin"] == "https://munich-quantum-software.github.io"
    first = data["event"]
    assert first["title"] == event["title"] and first["version"] == 1
    assert set(first) == (set(event) - {"contact_email"}) | {"id", "version", "updated_at"}, "Store only event data and revision metadata"
    assert first["organizers"] == event["organizers"]
    second_client = create_app(database)
    assert request(second_client)[1]["events"] == [first], "Edits must persist across clients and restarts"
    # Already-open clients use the same records through the old route.
    legacy_path = "/mqsf/api/events/" + first["id"]
    assert request(app, "GET", "/mqsf/api/events")[1]["events"] == [first]
    assert request(app, "POST", "/mqsf/api/events", data={**event, "start": "10:30", "end": "11:30"})[0] == 201, "Overlaps are allowed"
    path = "/mqsf/api/meetups/" + first["id"]
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda title: request(app, "PUT", path, {**first, "title": title})[0], ["Editor one", "Editor two"]))
    assert sorted(results) == [200, 409], "Concurrent edits must not overwrite each other"
    latest = next(e for e in request(app)[1]["events"] if e["id"] == first["id"])
    assert latest["version"] == 2
    assert request(app, "DELETE", legacy_path, {"version": 1})[0] == 409
    for changes in [{"contact_email": ""}, {"contact_email": None}, {"contact_email": "invalid"}, {"contact_email": "a@example.test\nX"}, {"date": "2026-10-16"}, {"start": "11:00"}, {"end": "09:00"}, {"start": "24:00"},
                    {"title": " "}, {"title": "x" * 121}, {"description": None}, {"audience": 5},
                    {"organizers": " "}, {"organizers": "x" * 201}, {"start": "07:59"}]:
        assert request(app, "POST", data={**event, **changes})[0] == 400, changes
    assert request(app, "PUT", path, {**latest, "version": True})[0] == 400
    assert request(app, "POST", data={**event, "description": "x" * 25000})[0] == 413
    bounds = {"days": [{"date": "2026-10-14", "start": "09:00", "end": "17:00"}]}
    assert validate_event(event, bounds)["start"] == "10:00"
    try:
        validate_event({**event, "start": "08:00"}, bounds)
        raise AssertionError("Published hours must be enforced on the server")
    except RequestError as error:
        assert error.status == 400
    assert request(app, "POST", data={**event, "start": "18:00", "end": "21:00"})[0] == 201, "Networking has no published cutoff"
    status, data, _ = request(app, "PUT", legacy_path, {**latest, "organizers": "Taylor"})
    assert status == 200 and data["event"]["organizers"] == "Taylor"
    latest = data["event"]
    with sqlite3.connect(database) as connection:
        assert connection.execute("SELECT contact_email FROM events WHERE id=?", (first["id"],)).fetchone()[0] == event["contact_email"]
    status, data, _ = request(app, "PUT", path, {**latest, "contact_email": "new@example.test"})
    assert status == 200 and "contact_email" not in data["event"]
    latest = data["event"]
    assert request(app, "DELETE", path, {"version": latest["version"]})[0] == 200
    with sqlite3.connect(database) as connection:
        rows = connection.execute("SELECT action, before_json, after_json FROM event_changes WHERE event_id=? ORDER BY rowid", (first["id"],)).fetchall()
        assert [row[0] for row in rows] == ["created", "updated", "updated", "updated", "deleted"]
        assert json.loads(rows[-2][1])["contact_email"] == event["contact_email"]
        assert json.loads(rows[-1][1])["contact_email"] == "new@example.test"
        assert rows[-1][2] is None
    assert "contact_email" not in json.dumps(request(app)[1])
    assert request(app, "GET", "/mqsf/api/history")[0] == 404
    assert request(app, "PUT", path, latest)[0] == 404
    assert request(app, "GET", "/mqsf/../backend/server.py")[0] == 404
    assert request(app, "GET", "/mqsf/.data/events.sqlite3")[0] == 404
    assert request(app, "GET", "/mqsf")[0] == 308
    for mount in ["/mqsf", "/side-events"]:
        assert b'url=../#side-events' in request(app, "GET", mount + "/")[1]
        assert request(app, "GET", mount + "/app.mjs")[0] == 200
        assert request(app, "GET", mount + "/conference.json")[0] == 200
        assert request(app, "GET", mount + "/api/meetups")[0] == 200
    assert b'href="#side-events"' in request(app, "GET", "/")[1]
    for resource in ["/styles.css", "/script.js", "/assets/images/brand/favicon.png", "/assets/images/brand/mqsf-logo.svg"]:
        assert request(app, "GET", resource)[0] == 200
    assert request(app, "GET", "/assets/../backend/server.py")[0] == 404
    assert request(app, "OPTIONS", origin="https://munich-quantum-software.github.io")[0] == 204
    legacy_db = Path(directory) / "legacy.sqlite3"
    with sqlite3.connect(legacy_db) as connection:
        connection.execute("CREATE TABLE events (id TEXT PRIMARY KEY, date TEXT, start TEXT, end TEXT, title TEXT, description TEXT, audience TEXT, version INTEGER, updated_at TEXT)")
        connection.execute("INSERT INTO events VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", tuple(first[key] for key in ("id", "date", "start", "end", "title", "description", "audience", "version", "updated_at")))
    migrated = request(create_app(legacy_db))[1]["events"][0]
    assert migrated == {**first, "organizers": ""}, "Adding organizers must preserve existing events"
    assert request(create_app(legacy_db))[1]["events"][0] == migrated, "Migration is safe to repeat"
    seeded_db = Path(directory) / "seeded.sqlite3"
    seeded = create_app(seeded_db, seed_examples=True)
    examples = request(seeded)[1]
    assert examples["demo"] is False and len(examples["events"]) == 5
    assert all(e["title"].endswith(" (example)") and e["organizers"] == "Example organizer" for e in examples["events"])
    assert request(create_app(seeded_db, seed_examples=True))[1] == examples, "Seeding must not duplicate or replace existing events"
    before = request(app)[1]
    assert request(create_app(database, seed_examples=True))[1] == before, "Seeding must leave an existing calendar untouched"
print("Calendar API checks passed: persistence, organizers, migration, concurrent edits, deletion, hours, navigation, and path isolation.")
