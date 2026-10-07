"""Run with python3 backend/check.py. Uses an isolated, disposable database."""
from concurrent.futures import ThreadPoolExecutor
from io import BytesIO
import json
import sqlite3
import secrets
from pathlib import Path
from tempfile import TemporaryDirectory

from server import create_app, validate_event, RequestError


def request(app, method="GET", path="/2026/meetups/api/meetups", data=None, origin=None, content_type="application/json", authorization=None):
    payload = json.dumps(data).encode() if data is not None else b""
    environ = {"REQUEST_METHOD": method, "PATH_INFO": path, "CONTENT_TYPE": content_type,
               "CONTENT_LENGTH": str(len(payload)), "wsgi.input": BytesIO(payload),
               "wsgi.url_scheme": "http", "HTTP_HOST": "localhost:8030"}
    if origin:
        environ["HTTP_ORIGIN"] = origin
    if authorization:
        environ["HTTP_AUTHORIZATION"] = authorization
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
    status, data, headers = request(app, "POST", data={**event, "contact_email": "  private@example.test  "}, origin="https://munich-quantum-software.github.io")
    assert status == 201 and headers["Access-Control-Allow-Origin"] == "https://munich-quantum-software.github.io"
    first = data["event"]
    assert first["title"] == event["title"] and first["version"] == 1
    assert set(first) == (set(event) - {"contact_email"}) | {"id", "version", "updated_at", "table_number"}, "Store only public event data and revision metadata"
    assert first["table_number"] == 1
    assert first["organizers"] == event["organizers"]
    second_client = create_app(database)
    assert request(second_client)[1]["events"] == [first], "Edits must persist across clients and restarts"
    # Already-open clients use the same records through the old route.
    legacy_path = "/2026/meetups/api/events/" + first["id"]
    assert request(app, "GET", "/2026/meetups/api/events")[1]["events"] == [first]
    assert request(app, "POST", "/2026/meetups/api/events", data={**event, "start": "10:30", "end": "11:30"})[0] == 201, "Overlaps are allowed"
    path = "/2026/meetups/api/meetups/" + first["id"]
    for route in [path, legacy_path]:
        for method in ["PUT", "DELETE"]:
            for email in [None, "", 123, "invalid", "a@example.test\r\nBcc:x", "wrong@example.test", "x' OR 1=1 --@example.test"]:
                denied = request(app, method, route, {**first, "contact_email": email})
                assert denied[0] == (403 if email == "wrong@example.test" else 400)
                assert event["contact_email"] not in json.dumps(denied[1]), "Errors must not reveal the saved email"
            assert request(app, method, route, first)[0] == 400, "Missing email must be rejected"
            assert request(app, method, route, {**first, "version": 999, "contact_email": "wrong@example.test"})[0] == 403
    assert next(e for e in request(app)[1]["events"] if e["id"] == first["id"]) == first
    with sqlite3.connect(database) as connection:
        assert connection.execute("SELECT COUNT(*) FROM event_changes WHERE event_id=?", (first["id"],)).fetchone()[0] == 1, "Denied writes create no history or notifications"
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda title: request(app, "PUT", path, {**first, "title": title, "contact_email": event["contact_email"]})[0], ["Editor one", "Editor two"]))
    assert sorted(results) == [200, 409], "Concurrent edits must not overwrite each other"
    latest = next(e for e in request(app)[1]["events"] if e["id"] == first["id"])
    assert latest["version"] == 2
    assert request(app, "DELETE", legacy_path, {"version": 1, "contact_email": event["contact_email"]})[0] == 409
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
    status, data, _ = request(app, "PUT", legacy_path, {**latest, "organizers": "Taylor", "contact_email": "  PRIVATE@EXAMPLE.TEST  "})
    assert status == 200 and data["event"]["organizers"] == "Taylor"
    latest = data["event"]
    with sqlite3.connect(database) as connection:
        assert connection.execute("SELECT contact_email FROM events WHERE id=?", (first["id"],)).fetchone()[0] == event["contact_email"]
    status, data, _ = request(app, "PUT", path, {**latest, "title": "Updated with original contact", "contact_email": event["contact_email"]})
    assert status == 200 and "contact_email" not in data["event"]
    latest = data["event"]
    assert request(app, "DELETE", legacy_path, {"version": latest["version"], "contact_email": "  PRIVATE@EXAMPLE.TEST  "})[0] == 200
    with sqlite3.connect(database) as connection:
        rows = connection.execute("SELECT action, before_json, after_json FROM event_changes WHERE event_id=? ORDER BY rowid", (first["id"],)).fetchall()
        assert [row[0] for row in rows] == ["created", "updated", "updated", "updated", "deleted"]
        assert json.loads(rows[-2][1])["contact_email"] == event["contact_email"]
        assert json.loads(rows[-1][1])["contact_email"] == event["contact_email"]
        assert rows[-1][2] is None
    assert "contact_email" not in json.dumps(request(app)[1])
    assert request(app, "GET", "/2026/meetups/api/history")[0] == 404
    assert request(app, "PUT", path, {**latest, "contact_email": event["contact_email"]})[0] == 404
    assert request(app, "GET", "/2026/meetups/../backend/server.py")[0] == 404
    assert request(app, "GET", "/2026/meetups/.data/events.sqlite3")[0] == 404
    for removed in ["/mqsf/", "/side-events/", "/event-preview/", "/background-preview/"]:
        assert request(app, "GET", removed)[0] == 404
    assert b'url=2026/' in request(app, "GET", "/")[1]
    assert b'href="#side-events"' in request(app, "GET", "/2026/program/")[1]
    for resource in ["/2026/", "/2026/event.css", "/2026/program/styles.css", "/2026/program/script.js", "/2026/meetups/app.mjs", "/2026/meetups/conference.json", "/background/", "/logos/", "/logos/styles.css", "/assets/images/brand/favicon.png", "/assets/images/brand/mqsf-logo.svg"]:
        assert request(app, "GET", resource)[0] == 200, resource
    assert request(app, "GET", "/2026/program")[0] == 308
    assert request(app, "GET", "/2026/meetups/api/meetups")[0] == 200
    assert request(app, "GET", "/2026/../backend/server.py")[0] == 404
    assert request(app, "GET", "/2026/missing.html")[0] == 404
    assert b"frame-ancestors 'self'" in request(app, "GET", "/background/")[2]["Content-Security-Policy"].encode()
    assert request(app, "GET", "/assets/../backend/server.py")[0] == 404
    assert request(app, "OPTIONS", origin="https://munich-quantum-software.github.io")[0] == 204
    legacy_db = Path(directory) / "legacy.sqlite3"
    with sqlite3.connect(legacy_db) as connection:
        connection.execute("CREATE TABLE events (id TEXT PRIMARY KEY, date TEXT, start TEXT, end TEXT, title TEXT, description TEXT, audience TEXT, version INTEGER, updated_at TEXT)")
        connection.execute("INSERT INTO events VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", tuple(first[key] for key in ("id", "date", "start", "end", "title", "description", "audience", "version", "updated_at")))
    migrated = request(create_app(legacy_db))[1]["events"][0]
    assert migrated == {**first, "organizers": "", "table_number": None}, "Adding organizers must preserve existing events"
    assert request(create_app(legacy_db))[1]["events"][0] == migrated, "Migration is safe to repeat"
    seeded_db = Path(directory) / "seeded.sqlite3"
    seeded = create_app(seeded_db, seed_examples=True)
    examples = request(seeded)[1]
    assert examples["demo"] is False and len(examples["events"]) == 5
    assert all(e["title"].endswith(" (example)") and e["organizers"] == "Example organizer" for e in examples["events"])
    for method in ["PUT", "DELETE"]:
        example = examples["events"][0]
        assert request(seeded, method, "/api/meetups/" + example["id"], {**example, "contact_email": ""})[0] == 400
        assert request(seeded, method, "/api/events/" + example["id"], {**example, "contact_email": event["contact_email"]})[0] == 403, "Events without an address cannot be claimed"
    assert request(create_app(seeded_db, seed_examples=True))[1] == examples, "Seeding must not duplicate or replace existing events"
    before = request(app)[1]
    assert request(create_app(database, seed_examples=True))[1] == before, "Seeding must leave an existing calendar untouched"
    capped_db = Path(directory) / "capped.sqlite3"
    capped = create_app(capped_db)
    for _ in range(2):
        assert request(capped, "POST", data=event)[0] == 201
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: request(capped, "POST", data=event), range(2)))
    assert sorted(r[0] for r in results) == [201, 422], "Only one concurrent save can take the last place"
    third = next(r[1]["event"] for r in results if r[0] == 201)
    assert sorted(e["table_number"] for e in request(capped)[1]["events"]) == [1, 2, 3], "Concurrent creates receive different tables"
    assert request(capped, "PUT", "/api/meetups/" + third["id"], {**third, "title": "Edited at capacity", "contact_email": event["contact_email"]})[0] == 200
    before_rejected = request(capped)[1]
    assert request(capped, "POST", data={**event, "start": "09:00", "end": "12:00"})[0] == 422
    assert request(capped)[1] == before_rejected
    with sqlite3.connect(capped_db) as connection:
        assert connection.execute("SELECT COUNT(*) FROM event_changes").fetchone()[0] == 4
    adjacent = []
    for start, end in [("09:00", "10:00"), ("11:00", "12:00")]:
        status, data, _ = request(capped, "POST", data={**event, "start": start, "end": end})
        assert status == 201, "Touching endpoints are allowed"
        adjacent.append(data["event"])
    assert request(capped, "POST", data={**event, "date": "2026-10-15"})[0] == 201
    before_rejected = request(capped)[1]
    assert request(capped, "PUT", "/api/events/" + adjacent[0]["id"], {**event, "version": 1})[0] == 422
    assert request(capped)[1] == before_rejected, "Rejected edits preserve the original event"
    assert request(capped, "DELETE", "/api/meetups/" + third["id"], {"version": 2, "contact_email": event["contact_email"]})[0] == 200
    with sqlite3.connect(capped_db) as connection:
        for e in adjacent:
            connection.execute("UPDATE events SET table_number=?, version=version+1 WHERE id=?", (third["table_number"], e["id"]))
            e["version"] += 1
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda e: request(capped, "PUT", "/api/meetups/" + e["id"], {**event, "version": e["version"]})[0], adjacent))
    assert sorted(results) == [200, 422], "Concurrent edits cannot overbook the last place"
    for start, end in [("17:00", "18:00"), ("18:00", "19:00"), ("19:00", "20:00"), ("17:00", "20:00")]:
        assert request(capped, "POST", data={**event, "start": start, "end": end})[0] == 201
    tables_db = Path(directory) / "tables.sqlite3"
    tables = create_app(tables_db)
    a = request(tables, "POST", data={**event, "table_number": 3})[1]["event"]
    b = request(tables, "POST", data={**event, "start": "11:00", "end": "12:00"})[1]["event"]
    assert a["table_number"] == b["table_number"] == 1, "Assign tables automatically, reuse touching endpoints, and ignore public choices"
    with sqlite3.connect(tables_db) as connection:
        connection.execute("UPDATE events SET table_number=1, version=version+1")
        row = connection.execute("SELECT after_json FROM event_changes WHERE event_id=? ORDER BY rowid DESC LIMIT 1", (a["id"],)).fetchone()
        assert json.loads(row[0])["table_number"] == 1
    public_edit = request(tables, "PUT", "/api/meetups/" + a["id"], {**a, "version": 2, "table_number": 2, "contact_email": event["contact_email"]})
    assert public_edit[0] == 200 and public_edit[1]["event"]["table_number"] == 1
    before_conflict = request(tables)[1]
    conflict = request(tables, "PUT", "/api/meetups/" + b["id"], {**b, "version": 2, "start": "10:30", "contact_email": event["contact_email"]})
    assert conflict[0] == 422 and "assigned table is already occupied" in conflict[1]["error"]
    assert request(tables)[1] == before_conflict
    organizer_db = Path(directory) / "organizer.sqlite3"
    key = secrets.token_urlsafe(32)
    authorization = "Bearer " + key
    organizer = create_app(organizer_db, organizer_key=key)
    assert request(organizer, "OPTIONS", "/api/organizer")[2]["Access-Control-Allow-Headers"] == "Content-Type, Authorization"
    assert request(organizer, "POST", "/api/organizer")[0] == 401
    assert request(organizer, "POST", "/api/organizer", authorization="Bearer " + secrets.token_urlsafe(32))[0] == 401
    assert request(organizer, "POST", "/api/organizer", authorization="Basic " + key)[0] == 401
    assert request(organizer, "GET", "/api/organizer", authorization=authorization)[0] == 405
    assert request(organizer, "POST", "/api/organizer", origin="https://unrelated.example", authorization=authorization)[0] == 403
    assert request(organizer, "POST", "/api/organizer", authorization=authorization)[1] == {"organizer": True}
    for invalid_key in ["", "too-short"]:
        unavailable = create_app(organizer_db, organizer_key=invalid_key)
        assert request(unavailable, "POST", "/api/organizer", authorization=authorization)[0] == 503
    a = request(organizer, "POST", data=event)[1]["event"]
    b = request(organizer, "POST", data={**event, "contact_email": "another@example.test"})[1]["event"]
    assert request(organizer, "POST", data=event)[0] == 201
    path = "/api/meetups/" + a["id"]
    assigned = request(organizer, "PUT", path, {**a, "table_number": 1}, authorization=authorization)
    assert assigned[0] == 200 and assigned[1]["event"]["table_number"] == 1
    assert "contact_email" not in json.dumps(assigned[1])
    participant = request(organizer, "PUT", path, {**assigned[1]["event"], "table_number": 2, "contact_email": event["contact_email"]})
    assert participant[1]["event"]["table_number"] == 1
    before = request(organizer)[1]
    for table in [0, 4, "1", True, [], {}]:
        assert request(organizer, "PUT", path, {**participant[1]["event"], "table_number": table}, authorization=authorization)[0] == 400
    for method in ["PUT", "DELETE"]:
        assert request(organizer, method, path, {**a, "contact_email": event["contact_email"]}, authorization="Bearer " + secrets.token_urlsafe(32))[0] == 401
        assert request(organizer, method, path, a, authorization=authorization)[0] == 409
    assert request(organizer, "PUT", "/api/events/" + b["id"], {**b, "table_number": 1}, authorization=authorization)[0] == 422
    assert request(organizer, "POST", data={**event, "table_number": 3}, authorization=authorization)[0] == 422
    assert request(organizer)[1] == before
    with sqlite3.connect(organizer_db) as connection:
        assert connection.execute("SELECT COUNT(*) FROM event_changes").fetchone()[0] == 5, "Denied requests create no history or notifications"
        assert connection.execute("SELECT contact_email FROM events WHERE id=?", (a["id"],)).fetchone()[0] == event["contact_email"]
    without_table = {k: v for k, v in participant[1]["event"].items() if k != "table_number"}
    assigned = request(organizer, "PUT", path, {**without_table, "title": "Organizer edit"}, authorization=authorization)
    assert assigned[1]["event"]["table_number"] == 1
    cleared = request(organizer, "PUT", path, {**assigned[1]["event"], "table_number": None}, authorization=authorization)
    assert cleared[1]["event"]["table_number"] is None
    other_owner = request(organizer, "PUT", "/api/events/" + b["id"], {**b, "table_number": 2}, authorization=authorization)
    assert other_owner[0] == 200
    assert request(organizer, "DELETE", path, {"version": cleared[1]["event"]["version"]}, authorization=authorization)[0] == 200
    assert request(organizer, "DELETE", "/api/events/" + b["id"], {"version": other_owner[1]["event"]["version"]}, authorization=authorization)[0] == 200
    for table, start, end in [(1, "08:00", "08:15"), (2, "08:15", "08:30"), (3, "08:30", "08:45")]:
        created = request(organizer, "POST", data={**event, "start": start, "end": end, "table_number": table}, authorization=authorization)
        assert created[0] == 201 and created[1]["event"]["table_number"] == table
    before = request(organizer)[1]
    no_free_table = request(organizer, "POST", data={**event, "start": "08:00", "end": "08:45"})
    assert no_free_table[0] == 422 and "No table is free for this entire time slot" in no_free_table[1]["error"]
    assert request(organizer)[1] == before, "Do not move existing assignments or create an unassigned event"
    automatic = request(organizer, "POST", data={**event, "date": "2026-10-15", "start": "08:00", "end": "08:45", "table_number": None}, authorization=authorization)
    assert automatic[0] == 201 and automatic[1]["event"]["table_number"] == 1
    rotated = create_app(organizer_db, organizer_key=secrets.token_urlsafe(32))
    assert request(rotated, "POST", "/api/organizer", authorization=authorization)[0] == 401
    assert request(rotated, "DELETE", path, {"version": 999}, authorization=authorization)[0] == 401
print("Calendar API checks passed: persistence, organizers, migration, concurrent edits, deletion, hours, navigation, and path isolation.")
