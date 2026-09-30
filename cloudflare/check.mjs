// An isolated local D1 database: no account or production data is used.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { getPlatformProxy, unstable_splitSqlQuery } from "wrangler";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import worker from "./worker.mjs";
import { notifyChanges, discordMessages } from "./notifications.mjs";
import { restoreSQL, assignTableSQL } from "./moderate.mjs";

const platform = await getPlatformProxy({ configPath: "cloudflare/wrangler.jsonc", persist: false, remoteBindings: false });
const { env } = platform;
const origin = "https://munich-quantum-software.github.io";
async function request(method = "GET", path = "/api/meetups", data, from = origin, authorization) {
  const response = await worker.fetch(new Request(`https://calendar.example${path}`, {
    method, headers: { Origin: from, ...(data !== undefined ? { "Content-Type": "application/json" } : {}), ...(authorization ? { Authorization: authorization } : {}) },
    ...(data !== undefined ? { body: JSON.stringify(data) } : {}),
  }), env);
  return { status: response.status, headers: response.headers, data: response.status === 204 ? null : await response.json() };
}
async function apply(file, db = env.DB) {
  const sql = await readFile(new URL(file, import.meta.url), "utf8");
  await db.batch(unstable_splitSqlQuery(sql).map(sql => db.prepare(sql)));
}
try {
  await apply("./migrations/0001_events.sql");
  await apply("./migrations/0003_private_contacts_and_history.sql");
  await apply("./migrations/0004_parallel_session_limit.sql");
  await apply("./migrations/0005_table_assignments.sql");
  assert.deepEqual((await request()).data, { events: [], demo: false });
  const draft = { date: "2026-10-14", start: "10:00", end: "11:15", title: "Meetup <b>plain text</b>",
    description: "Bring a laptop.\nAll welcome.", audience: "Developers", organizers: "Alex & Sam", contact_email: "private@example.test" };
  assert.equal((await request("POST", "/api/meetups", draft, "https://unrelated.example")).status, 403);
  const preflight = await request("OPTIONS");
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("Access-Control-Allow-Origin"), origin);
  assert.match(preflight.headers.get("Access-Control-Allow-Headers"), /Authorization/);
  const created = await request("POST", "/api/meetups", { ...draft, contact_email: `  ${draft.contact_email}  ` });
  assert.equal(created.status, 201);
  const first = created.data.event, path = `/api/meetups/${first.id}`;
  const { contact_email, ...publicDraft } = draft;
  assert.deepEqual(first, { ...publicDraft, id: first.id, version: 1, updated_at: first.updated_at, table_number: 1 });
  assert.deepEqual((await request()).data.events, [first]);
  // Already-open clients can still read and edit the same records through the old route.
  const legacyPath = `/api/events/${first.id}`;
  assert.deepEqual((await request("GET", "/api/events")).data.events, [first]);
  assert.equal((await request("POST", "/api/events", { ...draft, start: "10:15", end: "10:30" })).status, 201);
  for (const route of [path, legacyPath]) {
    for (const method of ["PUT", "DELETE"]) {
      for (const email of [undefined, "", null, 123, "invalid", "a@example.test\r\nBcc:x", "wrong@example.test", "x' OR 1=1 --@example.test"]) {
        const denied = await request(method, route, { ...first, contact_email: email });
        assert.equal(denied.status, email === "wrong@example.test" ? 403 : 400);
        assert.ok(!JSON.stringify(denied.data).includes(contact_email), "Errors must not reveal the saved email");
      }
      assert.equal((await request(method, route, { ...first, version: 999, contact_email: "wrong@example.test" })).status, 403);
    }
  }
  assert.deepEqual((await request()).data.events.find(e => e.id === first.id), first, "Denied edits and deletes preserve the event");
  assert.equal((await env.DB.prepare("SELECT COUNT(*) AS n FROM event_changes WHERE event_id=?").bind(first.id).first()).n, 1, "Denied writes create no history or notifications");
  const simultaneous = await Promise.all(["One", "Two"].map(title => request("PUT", path, { ...first, title, contact_email })));
  assert.deepEqual(simultaneous.map(r => r.status).sort(), [200, 409]);
  const latest = simultaneous.find(r => r.status === 200).data.event;
  assert.equal(latest.version, 2);
  assert.equal((await request("DELETE", legacyPath, { version: 1, contact_email })).status, 409);
  for (const change of [{ contact_email: "" }, { contact_email: null }, { contact_email: "not-an-email" }, { contact_email: "a@example.test\r\nBcc:x" }, { organizers: " " }, { organizers: "x".repeat(201) }, { audience: null }, { date: "2026-10-16" },
    { start: "24:00" }, { start: "07:59" }, { start: "11:15" }, { end: "09:00" }]) {
    assert.equal((await request("POST", "/api/meetups", { ...draft, ...change })).status, 400);
  }
  assert.equal((await request("PUT", path, { ...latest, version: true })).status, 400);
  assert.equal((await request("POST", "/api/meetups", { ...draft, description: "x".repeat(20001) })).status, 413);
  assert.equal((await request("POST", "/api/meetups", { ...draft, start: "18:00", end: "21:00" })).status, 201);
  const edited = await request("PUT", legacyPath, { ...latest, organizers: "Taylor", contact_email: `  ${contact_email.toUpperCase()}  ` });
  assert.equal(edited.data.event.organizers, "Taylor");
  assert.equal((await env.DB.prepare("SELECT contact_email FROM events WHERE id=?").bind(first.id).first()).contact_email, contact_email, "Verification must not change the stored address");
  const verified = await request("PUT", path, { ...edited.data.event, title: "Updated with original contact", contact_email });
  assert.equal(verified.status, 200);
  assert.equal(JSON.stringify(verified.data).includes("contact_email"), false);
  assert.equal((await request("DELETE", legacyPath, { version: verified.data.event.version, contact_email: `  ${contact_email.toUpperCase()}  ` })).status, 200);
  const history = (await env.DB.prepare("SELECT * FROM event_changes WHERE event_id=? ORDER BY rowid").bind(first.id).all()).results;
  assert.deepEqual(history.map(row => row.action), ["created", "updated", "updated", "updated", "deleted"], "Conflicts must not create history");
  assert.equal(JSON.parse(history.at(-2).before_json).contact_email, contact_email);
  assert.equal(JSON.parse(history[0].after_json).table_number, 1, "Creation history and notifications include the automatic assignment");
  assert.equal(JSON.parse(history.at(-1).before_json).contact_email, contact_email);
  assert.equal(history.at(-1).after_json, null);
  for (const privatePath of ["/api/history", "/api/event_changes", "/api/meetups/" + first.id]) {
    assert.ok([404, 405].includes((await request("GET", privatePath)).status));
  }
  assert.equal(JSON.stringify((await request()).data).includes("contact_email"), false);
  assert.equal((await request("PUT", path, { ...edited.data.event, contact_email })).status, 404);
  assert.equal((await request("GET", "/worker.mjs")).status, 404);
  await apply("./migrations/0002_example_events.sql");
  const seeded = (await request()).data.events;
  const examples = seeded.filter(event => event.title.endsWith(" (example)"));
  assert.equal(examples.length, 5);
  const example = examples[0];
  for (const method of ["PUT", "DELETE"]) {
    assert.equal((await request(method, `/api/meetups/${example.id}`, { ...example, contact_email: "" })).status, 400);
    assert.equal((await request(method, `/api/events/${example.id}`, { ...example, contact_email })).status, 403, "Events without an address cannot be claimed");
  }
  await env.DB.prepare("UPDATE events SET title=?, version=version+1 WHERE id=?").bind("Organizer's updated title", example.id).run();
  const beforeReseed = (await request()).data.events;
  await apply("./migrations/0002_example_events.sql");
  assert.deepEqual((await request()).data.events, beforeReseed, "Seed migration must preserve edits");
  const deletion = history.at(-1);
  const restored = await env.DB.prepare(restoreSQL(deletion.id, "before", 0)).first();
  assert.equal(restored.id, first.id);
  assert.equal(restored.version, verified.data.event.version + 1, "Restoration must invalidate all old versions");
  assert.equal((await env.DB.prepare("SELECT contact_email FROM events WHERE id=?").bind(first.id).first()).contact_email, contact_email);
  assert.equal(await env.DB.prepare(restoreSQL(deletion.id, "before", 0)).first(), null, "Do not overwrite an event recreated since review");
  assert.equal(await env.DB.prepare(restoreSQL(deletion.id, "before", restored.version - 1)).first(), null);
  const reverted = await env.DB.prepare(restoreSQL(history[0].id, "after", restored.version)).first();
  assert.equal(reverted.version, restored.version + 1);
  assert.equal((await env.DB.prepare("SELECT title FROM events WHERE id=?").bind(first.id).first()).title, draft.title);
  assert.equal((await request("PUT", path, { ...verified.data.event, contact_email })).status, 409, "Pre-deletion clients cannot overwrite a restored event");

  // A failed journal write must roll back the public mutation as well.
  const beforeFailure = (await request()).data.events;
  await env.DB.prepare("CREATE TRIGGER reject_history BEFORE INSERT ON event_changes BEGIN SELECT RAISE(ABORT, 'test failure'); END").run();
  assert.equal((await request("POST", "/api/meetups", { ...draft, date: "2026-10-15", start: "16:00", end: "17:00" })).status, 503);
  assert.deepEqual((await request()).data.events, beforeFailure);
  await env.DB.prepare("DROP TRIGGER reject_history").run();

  const slot = { ...draft, date: "2026-10-15", start: "13:00", end: "14:00" };
  for (let i = 0; i < 2; i++) assert.equal((await request("POST", "/api/meetups", slot)).status, 201);
  const race = await Promise.all([1, 2].map(() => request("POST", "/api/meetups", slot)));
  assert.deepEqual(race.map(result => result.status).sort(), [201, 422], "Only one concurrent save can take the last place");
  const third = race.find(result => result.status === 201).data.event;
  assert.deepEqual((await request()).data.events.filter(e => e.date === slot.date && e.start === slot.start).map(e => e.table_number).sort(), [1, 2, 3], "Concurrent creates receive different tables");
  assert.match(race.find(result => result.status === 422).data.error, /At most 3 meet-ups/);
  assert.equal((await request("PUT", `/api/meetups/${third.id}`, { ...third, title: "Edited at capacity", contact_email })).status, 200, "An edit must not count itself twice");
  const beforeCapacityFailure = (await request()).data;
  const historyCount = () => env.DB.prepare("SELECT COUNT(*) AS n FROM event_changes").first();
  const journalBefore = await historyCount();
  for (const times of [{ start: "13:15", end: "13:45" }, { start: "12:00", end: "15:00" }]) {
    assert.equal((await request("POST", "/api/events", { ...slot, ...times })).status, 422, "Check the entire requested interval");
  }
  assert.deepEqual((await request()).data, beforeCapacityFailure);
  assert.deepEqual(await historyCount(), journalBefore, "Rejected saves must not generate history or notifications");
  const adjacent = [];
  for (const times of [{ start: "12:00", end: "13:00" }, { start: "14:00", end: "15:00" }]) {
    const result = await request("POST", "/api/meetups", { ...slot, ...times });
    assert.equal(result.status, 201, "Touching endpoints are allowed");
    adjacent.push(result.data.event);
  }
  const otherDay = await request("POST", "/api/meetups", { ...slot, date: "2026-10-14" });
  assert.equal(otherDay.status, 201, "Days have independent capacity");
  const beforeEdit = (await request()).data, journalBeforeEdit = await historyCount();
  for (const event of [adjacent[0], otherDay.data.event]) {
    assert.equal((await request("PUT", `/api/meetups/${event.id}`, { ...slot, version: event.version })).status, 422);
    assert.equal((await env.DB.prepare("SELECT contact_email FROM events WHERE id=?").bind(event.id).first()).contact_email, draft.contact_email);
  }
  assert.deepEqual((await request()).data, beforeEdit, "Rejected edits preserve the event and its version");
  assert.deepEqual(await historyCount(), journalBeforeEdit);
  assert.equal((await request("DELETE", `/api/meetups/${third.id}`, { version: 2, contact_email })).status, 200);
  // Keep these edits on the newly freed table; participants cannot change their assigned table.
  for (const event of adjacent) Object.assign(event, await env.DB.prepare(assignTableSQL(event.id, third.table_number, event.version)).first());
  const editRace = await Promise.all(adjacent.map(event => request("PUT", `/api/meetups/${event.id}`, { ...slot, version: event.version })));
  assert.deepEqual(editRace.map(result => result.status).sort(), [200, 422], "Concurrent edits also share the last place");
  const removed = await env.DB.prepare("SELECT id FROM event_changes WHERE event_id=? AND action='deleted'").bind(third.id).first();
  await assert.rejects(env.DB.prepare(restoreSQL(removed.id, "before", 0)).first(), /MQSF_MAX_PARALLEL_SESSIONS|MQSF_TABLE_OCCUPIED/, "Restores cannot overbook a slot or table");
  for (const [start, end] of [["17:00", "18:00"], ["18:00", "19:00"], ["19:00", "20:00"], ["17:00", "20:00"]]) {
    assert.equal((await request("POST", "/api/meetups", { ...slot, start, end })).status, 201, "Count simultaneous sessions, not total intersecting events");
  }

  const tableEvents = [];
  for (const [start, end] of [["21:00", "22:00"], ["21:30", "22:30"], ["22:00", "23:00"]]) {
    const result = await request("POST", "/api/meetups", { ...slot, start, end, table_number: 3 });
    assert.equal(result.status, 201);
    tableEvents.push(result.data.event);
  }
  const [tableA, tableB, tableC] = tableEvents;
  assert.deepEqual(tableEvents.map(e => e.table_number), [1, 2, 1], "Assign free tables, reuse touching endpoints, and ignore public table choices");
  assert.equal((await env.DB.prepare(assignTableSQL(tableA.id, 3, 1)).first()).table_number, 3);
  assert.equal(await env.DB.prepare(assignTableSQL(tableA.id, 2, 1)).first(), null, "Stale assignments must not overwrite changes");
  assert.equal(await env.DB.prepare(assignTableSQL(tableA.id, 3, 2)).first(), null, "An unchanged assignment creates no revision");
  assert.equal((await env.DB.prepare(assignTableSQL(tableA.id, 1, 2)).first()).table_number, 1);
  await assert.rejects(env.DB.prepare(assignTableSQL(tableB.id, 1, 1)).first(), /MQSF_TABLE_OCCUPIED/);
  const publicEdit = await request("PUT", `/api/meetups/${tableA.id}`, { ...tableA, version: 3, title: "Public edit", table_number: 3, contact_email });
  assert.equal(publicEdit.data.event.table_number, 1, "Public edits preserve organizer assignments");
  const beforeTableConflict = (await request()).data, journalBeforeTableConflict = await historyCount();
  const conflict = await request("PUT", `/api/meetups/${tableC.id}`, { ...tableC, start: "21:45", contact_email });
  assert.equal(conflict.status, 422);
  assert.match(conflict.data.error, /assigned table is already occupied/);
  assert.deepEqual((await request()).data, beforeTableConflict);
  assert.deepEqual(await historyCount(), journalBeforeTableConflict);
  const assignments = await Promise.allSettled([
    env.DB.prepare(assignTableSQL(tableA.id, 3, 4)).first(),
    env.DB.prepare(assignTableSQL(tableB.id, 3, 1)).first(),
  ]);
  assert.deepEqual(assignments.map(result => result.status).sort(), ["fulfilled", "rejected"], "Overlapping sessions cannot race for the same table");
  assert.equal((await env.DB.prepare(assignTableSQL(tableC.id, null, 1)).first()).table_number, null);
  const clearedTable = await env.DB.prepare("SELECT * FROM event_changes WHERE event_id=? ORDER BY rowid DESC LIMIT 1").bind(tableC.id).first();
  assert.equal(JSON.parse(clearedTable.before_json).table_number, 1);
  assert.equal(JSON.parse(clearedTable.after_json).table_number, null);
  await env.DB.prepare(restoreSQL(clearedTable.id, "before", 2)).first();
  assert.equal((await request()).data.events.find(event => event.id === tableC.id).table_number, 1, "Undo restores the table assignment");
  const notification = discordMessages(clearedTable)[0].embeds[0].fields.find(field => field.name === "Table changed");
  assert.deepEqual(notification, { name: "Table changed", value: "**Before**\n1\n\n**After**\nNot assigned" });
  assert.throws(() => assignTableSQL(tableA.id, 4, 1));
  await assert.rejects(env.DB.prepare("UPDATE events SET table_number=4 WHERE id=?").bind(tableA.id).run(), /CHECK constraint/);

  // Organizer access is server-checked on every request; no email or key is returned.
  const key = crypto.randomUUID(), authorization = `Bearer ${key}`;
  delete env.ORGANIZER_ACCESS_KEY;
  assert.equal((await request("POST", "/api/organizer", undefined, origin, authorization)).status, 503);
  env.ORGANIZER_ACCESS_KEY = "too-short";
  assert.equal((await request("POST", "/api/organizer", undefined, origin, authorization)).status, 503);
  env.ORGANIZER_ACCESS_KEY = key;
  assert.equal((await request("POST", "/api/organizer")).status, 401);
  for (const invalid of [`Bearer ${crypto.randomUUID()}`, `Basic ${key}`, "Bearer short"]) {
    assert.equal((await request("POST", "/api/organizer", undefined, origin, invalid)).status, 401);
  }
  assert.equal((await request("POST", `/api/organizer?key=${key}`)).status, 401, "Keys in URLs cannot authorize requests");
  assert.equal((await request("GET", "/api/organizer", undefined, origin, authorization)).status, 405);
  assert.equal((await request("POST", "/api/organizer", undefined, "https://unrelated.example", authorization)).status, 403);
  assert.deepEqual((await request("POST", "/api/organizer", undefined, origin, authorization)).data, { organizer: true });
  // A table must be free for the whole event; existing assignments must not move to make room.
  for (const [index, start, end] of [[1, "08:00", "08:15"], [2, "08:15", "08:30"], [3, "08:30", "08:45"]]) {
    const created = await request("POST", "/api/meetups", { ...draft, start, end, table_number: index }, origin, authorization);
    assert.equal(created.status, 201);
    assert.equal(created.data.event.table_number, index, "Organizers can override the automatic choice");
  }
  const beforeNoFreeTable = (await request()).data, historyBeforeNoFreeTable = await historyCount();
  const noFreeTable = await request("POST", "/api/meetups", { ...draft, start: "08:00", end: "08:45" });
  assert.equal(noFreeTable.status, 422);
  assert.match(noFreeTable.data.error, /No table is free for this entire time slot/);
  assert.deepEqual((await request()).data, beforeNoFreeTable);
  assert.deepEqual(await historyCount(), historyBeforeNoFreeTable);
  const automatic = await request("POST", "/api/meetups", { ...draft, date: "2026-10-15", start: "08:00", end: "08:45", table_number: null }, origin, authorization);
  assert.equal(automatic.data.event.table_number, 1, "Organizer defaults are automatic and tables are independent across dates");
  const organizerDraft = { ...draft, start: "22:00", end: "23:00" };
  const a = (await request("POST", "/api/meetups", organizerDraft)).data.event;
  const b = (await request("POST", "/api/meetups", { ...organizerDraft, contact_email: "another@example.test" })).data.event;
  assert.equal((await request("POST", "/api/meetups", organizerDraft)).status, 201);
  let assigned = await request("PUT", `/api/meetups/${a.id}`, { ...a, table_number: 1 }, origin, authorization);
  assert.equal(assigned.status, 200);
  assert.equal(assigned.data.event.table_number, 1);
  assert.equal(JSON.stringify(assigned.data).includes("contact_email"), false);
  assert.equal((await env.DB.prepare("SELECT contact_email FROM events WHERE id=?").bind(a.id).first()).contact_email, contact_email);
  const participant = await request("PUT", `/api/meetups/${a.id}`, { ...assigned.data.event, contact_email, table_number: 2 });
  assert.equal(participant.data.event.table_number, 1, "Participants cannot reassign tables");
  assigned = participant;
  const beforeOrganizerFailure = (await request()).data, organizerJournal = await historyCount();
  for (const table_number of [0, 4, "1", true, [], {}]) {
    assert.equal((await request("PUT", `/api/meetups/${a.id}`, { ...assigned.data.event, table_number }, origin, authorization)).status, 400);
  }
  for (const method of ["PUT", "DELETE"]) {
    assert.equal((await request(method, `/api/events/${a.id}`, { ...a, contact_email }, origin, `Bearer ${crypto.randomUUID()}`)).status, 401, "Invalid organizer keys cannot fall back to email access");
    assert.equal((await request(method, `/api/events/${a.id}`, a, origin, authorization)).status, 409, "Organizer changes still enforce revisions");
  }
  assert.equal((await request("PUT", `/api/events/${b.id}`, { ...b, table_number: 1 }, origin, authorization)).status, 422, "Organizers cannot double-book a table");
  assert.equal((await request("POST", "/api/meetups", { ...organizerDraft, table_number: 3 }, origin, authorization)).status, 422, "Organizers cannot exceed the parallel-session limit");
  assert.deepEqual((await request()).data, beforeOrganizerFailure);
  assert.deepEqual(await historyCount(), organizerJournal, "Denied organizer requests leave history and notifications unchanged");
  const { table_number, ...withoutTable } = assigned.data.event;
  assigned = await request("PUT", `/api/meetups/${a.id}`, { ...withoutTable, title: "Organizer edit" }, origin, authorization);
  assert.equal(assigned.data.event.table_number, 1, "Omitted assignments are preserved");
  assigned = await request("PUT", `/api/meetups/${a.id}`, { ...assigned.data.event, table_number: null }, origin, authorization);
  assert.equal(assigned.data.event.table_number, null, "Organizers can clear assignments");
  const otherOwner = await request("PUT", `/api/events/${b.id}`, { ...b, table_number: 2 }, origin, authorization);
  assert.equal(otherOwner.status, 200, "Organizers can edit events created with another email");
  assert.equal((await request("DELETE", `/api/meetups/${a.id}`, { version: assigned.data.event.version }, origin, authorization)).status, 200);
  assert.equal((await request("DELETE", `/api/events/${b.id}`, { version: otherOwner.data.event.version }, origin, authorization)).status, 200);
  const organizerHistory = (await env.DB.prepare("SELECT action, before_json, after_json FROM event_changes WHERE event_id=? ORDER BY rowid").bind(b.id).all()).results;
  assert.deepEqual(organizerHistory.map(change => change.action), ["created", "updated", "deleted"]);
  assert.equal(JSON.parse(organizerHistory[1].after_json).table_number, 2, "Assignments enter the existing history/notification outbox");
  assert.equal(JSON.parse(organizerHistory[2].before_json).contact_email, "another@example.test");
  env.ORGANIZER_ACCESS_KEY = crypto.randomUUID();
  assert.equal((await request("POST", "/api/organizer", undefined, origin, authorization)).status, 401, "Rotating the key revokes old access");
  assert.equal((await request("DELETE", `/api/meetups/${third.id}`, { version: 999 }, origin, authorization)).status, 401);

  const realFetch = globalThis.fetch, deliveries = [];
  let releaseDelivery, sawDelivery;
  const firstDelivery = new Promise(resolve => sawDelivery = resolve);
  const resumeDelivery = new Promise(resolve => releaseDelivery = resolve);
  const notifyEnv = { ...env, DISCORD_WEBHOOK_URL: "https://discord.com/api/webhooks/123/test-only" };
  try {
    globalThis.fetch = async (url, options) => {
      assert.equal(new URL(url).search, "?wait=true");
      assert.equal(options.redirect, "manual");
      const payload = JSON.parse(options.body);
      assert.deepEqual(payload.allowed_mentions, { parse: [] });
      assert.ok(payload.embeds[0].title.includes("Meet-up"));
      assert.equal(payload.attachments, undefined);
      deliveries.push(payload.embeds[0]);
      if (deliveries.length === 1) { sawDelivery(); await resumeDelivery; }
      return Response.json({ id: "discord-message" });
    };
    await notifyChanges(env); // No configured secret: leave the outbox untouched.
    assert.equal(deliveries.length, 0);
    const queued = (await env.DB.prepare("SELECT id FROM event_changes WHERE notified_at IS NULL ORDER BY created_at, rowid LIMIT 3").all()).results;
    const firstRun = notifyChanges(notifyEnv, 3);
    await firstDelivery;
    try {
      await notifyChanges(notifyEnv, 3);
      assert.equal(deliveries.length, 1, "Later notifications must wait while the oldest is in flight");
    } finally { releaseDelivery(); }
    await firstRun;
    assert.deepEqual(deliveries.map(d => d.footer.text), queued.map(row => `Private · Change ${row.id}`), "Send notifications in recorded order");
    assert.equal(deliveries[0].fields.find(field => field.name === "Contact email (private)").value, contact_email);
    let attempts = 0;
    globalThis.fetch = async () => { attempts++; return Response.json({ retry_after: 120, message: "Do not store response bodies" }, { status: 429 }); };
    await notifyChanges(notifyEnv);
    assert.equal(attempts, 1);
    const pending = await env.DB.prepare("SELECT * FROM event_changes WHERE notify_error IS NOT NULL").first();
    assert.equal(pending.notified_at, null);
    assert.equal(pending.notify_error, "Discord HTTP 429");
    assert.ok(pending.notify_after >= Math.floor(Date.now() / 1000) + 119);
    await notifyChanges(notifyEnv);
    assert.equal(attempts, 1, "Do not send later changes ahead of an earlier change awaiting retry");
    await env.DB.prepare("UPDATE event_changes SET notified_at='test' WHERE id!=?").bind(pending.id).run();
    await notifyChanges(notifyEnv);
    assert.equal(attempts, 1, "Respect retry backoff");
    await env.DB.prepare("UPDATE event_changes SET notify_after=0 WHERE id=?").bind(pending.id).run();
    globalThis.fetch = async () => { attempts++; return Response.json({ id: "retried-message" }); };
    await notifyChanges(notifyEnv);
    assert.equal(attempts, 2);
    assert.ok((await env.DB.prepare("SELECT notified_at FROM event_changes WHERE id=?").bind(pending.id).first()).notified_at);
    const longChange = await env.DB.prepare("INSERT INTO event_changes(event_id, action, before_json, after_json) VALUES (?, 'updated', ?, ?) RETURNING id")
      .bind(first.id, JSON.stringify({ ...draft, description: "*".repeat(3000) }), JSON.stringify({ ...draft, description: "_".repeat(3000) })).first();
    let parts = 0;
    globalThis.fetch = async () => ++parts === 2 ? new Response(null, { status: 503 }) : Response.json({ id: "part" });
    await notifyChanges(notifyEnv);
    assert.equal(parts, 2);
    const incomplete = await env.DB.prepare("SELECT notified_at, notify_error FROM event_changes WHERE id=?").bind(longChange.id).first();
    assert.deepEqual(incomplete, { notified_at: null, notify_error: "Discord HTTP 503" }, "Only acknowledge a change after every part is delivered");
    await env.DB.prepare("UPDATE event_changes SET notify_after=0 WHERE id=?").bind(longChange.id).run();
    globalThis.fetch = async () => Response.json({ id: "complete-part" });
    await notifyChanges(notifyEnv);
    assert.ok((await env.DB.prepare("SELECT notified_at FROM event_changes WHERE id=?").bind(longChange.id).first()).notified_at);
    await assert.rejects(notifyChanges({ ...env, DISCORD_WEBHOOK_URL: "https://unrelated.example/webhook" }));
  } finally { globalThis.fetch = realFetch; }
  const oldDetails = { ...draft, description: "Original plan", start: "10:00" };
  const newDetails = { ...draft, description: "New plan", start: "11:00" };
  const [message] = discordMessages({ id: "test", action: "updated", created_at: new Date().toISOString(), before_json: JSON.stringify(oldDetails), after_json: JSON.stringify(newDetails) });
  assert.deepEqual(message.embeds[0].fields.slice(2, 4), [
    { name: "Start time changed", value: "**Before**\n10:00\n\n**After**\n11:00" },
    { name: "Description changed", value: "**Before**\nOriginal plan\n\n**After**\nNew plan" },
  ]);
  for (const action of ["created", "updated", "deleted"]) {
    const longBefore = { ...draft, title: "*".repeat(120), description: "*".repeat(2998) + "🚀", audience: "*".repeat(300), organizers: "*".repeat(200) };
    const longAfter = { ...longBefore, description: "_".repeat(2998) + "🚀" };
    const messages = discordMessages({ id: "test", action, created_at: new Date().toISOString(), before_json: action === "created" ? null : JSON.stringify(longBefore), after_json: action === "deleted" ? null : JSON.stringify(longAfter) });
    for (const payload of messages) {
      const embed = payload.embeds[0];
      assert.ok(embed.title.length <= 256 && embed.description.length <= 4096 && embed.fields.length <= 25);
      assert.ok(embed.fields.every(field => field.name.length <= 256 && field.value.length <= 1024));
      assert.ok(embed.title.length + embed.description.length + embed.footer.text.length + embed.fields.reduce((sum, field) => sum + field.name.length + field.value.length, 0) <= 6000);
      assert.deepEqual(payload.allowed_mentions, { parse: [] });
      assert.equal(payload.flags, undefined, "Do not suppress our own rich embeds");
      assert.equal(payload.attachments, undefined);
    }
    const fields = messages.flatMap(payload => payload.embeds[0].fields);
    const shown = fields.filter(field => field.name.startsWith(action === "updated" ? "Description · After" : "Description")).map(field => field.value).join("");
    const raw = action === "deleted" ? longBefore.description : longAfter.description;
    assert.equal(shown, raw.replace(/[\\`*_~|\[\]()<>]/g, "\\$&"), "Long text and Unicode must be preserved completely");
    if (action === "updated") assert.ok(messages.length > 1, "Large before/after changes span numbered messages");
  }
  // Run the actual outbound request in workerd: its Fetch API differs from Node's.
  let runtimeDeliveries = 0, redirectTest = true;
  const runtime = new Miniflare(convertV4MiniflareOptions({
    modules: true, compatibilityDate: "2026-09-25", d1Databases: ["DB"],
    bindings: { DISCORD_WEBHOOK_URL: notifyEnv.DISCORD_WEBHOOK_URL },
    script: await readFile(new URL("./notifications.mjs", import.meta.url), "utf8")
      + "\nexport default { async fetch(request, env) { await notifyChanges(env); return new Response('done'); } };",
    outboundService: async request => {
      runtimeDeliveries++;
      assert.equal(new URL(request.url).hostname, "discord.com");
      const payload = await request.json();
      assert.deepEqual(payload.allowed_mentions, { parse: [] });
      assert.equal(payload.embeds[0].fields.find(field => field.name === "Contact email (private)").value, contact_email);
      return redirectTest ? new Response(null, { status: 302, headers: { Location: "https://unrelated.example/" } }) : Response.json({ id: "runtime-message" });
    },
  }));
  try {
    const db = await runtime.getD1Database("DB");
    await apply("./migrations/0001_events.sql", db);
    await apply("./migrations/0003_private_contacts_and_history.sql", db);
    await apply("./migrations/0005_table_assignments.sql", db);
    await db.prepare("INSERT INTO events(id,date,start,end,title,description,audience,organizers,contact_email,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)")
      .bind(crypto.randomUUID(), draft.date, draft.start, draft.end, draft.title, draft.description, draft.audience, draft.organizers, contact_email, new Date().toISOString()).run();
    await runtime.dispatchFetch("http://localhost/");
    assert.equal(runtimeDeliveries, 1, "Never follow webhook redirects with private data");
    assert.equal((await db.prepare("SELECT notify_error FROM event_changes").first()).notify_error, "Discord HTTP 302");
    redirectTest = false;
    await db.prepare("UPDATE event_changes SET notify_after=0").run();
    await runtime.dispatchFetch("http://localhost/");
    assert.equal(runtimeDeliveries, 2);
    assert.ok((await db.prepare("SELECT notified_at FROM event_changes").first()).notified_at);
  } finally { await runtime.dispose(); }
  console.log("Cloudflare D1 checks passed: private contacts, atomic history, Discord outbox, retries, CRUD, validation, concurrent edits, CORS, hours, and example seeds.");
} finally { await platform.dispose(); }
