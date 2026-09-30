// An isolated local D1 database: no account or production data is used.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { getPlatformProxy, unstable_splitSqlQuery } from "wrangler";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import worker from "./worker.mjs";
import { notifyChanges, discordMessages } from "./notifications.mjs";
import { restoreSQL } from "./moderate.mjs";

const platform = await getPlatformProxy({ configPath: "cloudflare/wrangler.jsonc", persist: false, remoteBindings: false });
const { env } = platform;
const origin = "https://munich-quantum-software.github.io";
async function request(method = "GET", path = "/api/meetups", data, from = origin) {
  const response = await worker.fetch(new Request(`https://calendar.example${path}`, {
    method, headers: { Origin: from, ...(data !== undefined ? { "Content-Type": "application/json" } : {}) },
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
  assert.deepEqual((await request()).data, { events: [], demo: false });
  const draft = { date: "2026-10-14", start: "10:00", end: "11:15", title: "Meetup <b>plain text</b>",
    description: "Bring a laptop.\nAll welcome.", audience: "Developers", organizers: "Alex & Sam", contact_email: "private@example.test" };
  assert.equal((await request("POST", "/api/meetups", draft, "https://unrelated.example")).status, 403);
  const preflight = await request("OPTIONS");
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("Access-Control-Allow-Origin"), origin);
  const created = await request("POST", "/api/meetups", draft);
  assert.equal(created.status, 201);
  const first = created.data.event, path = `/api/meetups/${first.id}`;
  const { contact_email, ...publicDraft } = draft;
  assert.deepEqual(first, { ...publicDraft, id: first.id, version: 1, updated_at: first.updated_at });
  assert.deepEqual((await request()).data.events, [first]);
  // Already-open clients can still read and edit the same records through the old route.
  const legacyPath = `/api/events/${first.id}`;
  assert.deepEqual((await request("GET", "/api/events")).data.events, [first]);
  assert.equal((await request("POST", "/api/events", { ...draft, start: "10:15", end: "10:30" })).status, 201);
  const simultaneous = await Promise.all(["One", "Two"].map(title => request("PUT", path, { ...first, title })));
  assert.deepEqual(simultaneous.map(r => r.status).sort(), [200, 409]);
  const latest = simultaneous.find(r => r.status === 200).data.event;
  assert.equal(latest.version, 2);
  assert.equal((await request("DELETE", legacyPath, { version: 1 })).status, 409);
  for (const change of [{ contact_email: "" }, { contact_email: null }, { contact_email: "not-an-email" }, { contact_email: "a@example.test\r\nBcc:x" }, { organizers: " " }, { organizers: "x".repeat(201) }, { audience: null }, { date: "2026-10-16" },
    { start: "24:00" }, { start: "07:59" }, { start: "11:15" }, { end: "09:00" }]) {
    assert.equal((await request("POST", "/api/meetups", { ...draft, ...change })).status, 400);
  }
  assert.equal((await request("PUT", path, { ...latest, version: true })).status, 400);
  assert.equal((await request("POST", "/api/meetups", { ...draft, description: "x".repeat(20001) })).status, 413);
  assert.equal((await request("POST", "/api/meetups", { ...draft, start: "18:00", end: "21:00" })).status, 201);
  const edited = await request("PUT", legacyPath, { ...latest, organizers: "Taylor" });
  assert.equal(edited.data.event.organizers, "Taylor");
  assert.equal((await env.DB.prepare("SELECT contact_email FROM events WHERE id=?").bind(first.id).first()).contact_email, contact_email, "Blank edits preserve the hidden address");
  const replaced = await request("PUT", path, { ...edited.data.event, contact_email: "replacement@example.test" });
  assert.equal(replaced.status, 200);
  assert.equal(JSON.stringify(replaced.data).includes("contact_email"), false);
  assert.equal((await request("DELETE", path, { version: replaced.data.event.version })).status, 200);
  const history = (await env.DB.prepare("SELECT * FROM event_changes WHERE event_id=? ORDER BY rowid").bind(first.id).all()).results;
  assert.deepEqual(history.map(row => row.action), ["created", "updated", "updated", "updated", "deleted"], "Conflicts must not create history");
  assert.equal(JSON.parse(history.at(-2).before_json).contact_email, contact_email);
  assert.equal(JSON.parse(history.at(-1).before_json).contact_email, "replacement@example.test");
  assert.equal(history.at(-1).after_json, null);
  for (const privatePath of ["/api/history", "/api/event_changes", "/api/meetups/" + first.id]) {
    assert.ok([404, 405].includes((await request("GET", privatePath)).status));
  }
  assert.equal(JSON.stringify((await request()).data).includes("contact_email"), false);
  assert.equal((await request("PUT", path, edited.data.event)).status, 404);
  assert.equal((await request("GET", "/worker.mjs")).status, 404);
  await apply("./migrations/0002_example_events.sql");
  const seeded = (await request()).data.events;
  const examples = seeded.filter(event => event.title.endsWith(" (example)"));
  assert.equal(examples.length, 5);
  const example = examples[0];
  await request("PUT", `/api/meetups/${example.id}`, { ...example, title: "Participant's updated title" });
  const beforeReseed = (await request()).data.events;
  await apply("./migrations/0002_example_events.sql");
  assert.deepEqual((await request()).data.events, beforeReseed, "Seed migration must preserve participants' edits");
  const deletion = history.at(-1);
  const restored = await env.DB.prepare(restoreSQL(deletion.id, "before", 0)).first();
  assert.equal(restored.id, first.id);
  assert.equal(restored.version, replaced.data.event.version + 1, "Restoration must invalidate all old versions");
  assert.equal((await env.DB.prepare("SELECT contact_email FROM events WHERE id=?").bind(first.id).first()).contact_email, "replacement@example.test");
  assert.equal(await env.DB.prepare(restoreSQL(deletion.id, "before", 0)).first(), null, "Do not overwrite an event recreated since review");
  assert.equal(await env.DB.prepare(restoreSQL(deletion.id, "before", restored.version - 1)).first(), null);
  const reverted = await env.DB.prepare(restoreSQL(history[0].id, "after", restored.version)).first();
  assert.equal(reverted.version, restored.version + 1);
  assert.equal((await env.DB.prepare("SELECT title FROM events WHERE id=?").bind(first.id).first()).title, draft.title);
  assert.equal((await request("PUT", path, replaced.data.event)).status, 409, "Pre-deletion clients cannot overwrite a restored event");

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
  assert.match(race.find(result => result.status === 422).data.error, /At most 3 sessions/);
  assert.equal((await request("PUT", `/api/meetups/${third.id}`, { ...third, title: "Edited at capacity" })).status, 200, "An edit must not count itself twice");
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
    assert.equal((await request("PUT", `/api/meetups/${event.id}`, { ...slot, version: event.version, contact_email: "rejected@example.test" })).status, 422);
    assert.equal((await env.DB.prepare("SELECT contact_email FROM events WHERE id=?").bind(event.id).first()).contact_email, draft.contact_email);
  }
  assert.deepEqual((await request()).data, beforeEdit, "Rejected edits preserve the event and its version");
  assert.deepEqual(await historyCount(), journalBeforeEdit);
  assert.equal((await request("DELETE", `/api/meetups/${third.id}`, { version: 2 })).status, 200);
  const editRace = await Promise.all(adjacent.map(event => request("PUT", `/api/meetups/${event.id}`, { ...slot, version: event.version })));
  assert.deepEqual(editRace.map(result => result.status).sort(), [200, 422], "Concurrent edits also share the last place");
  const removed = await env.DB.prepare("SELECT id FROM event_changes WHERE event_id=? AND action='deleted'").bind(third.id).first();
  await assert.rejects(env.DB.prepare(restoreSQL(removed.id, "before", 0)).first(), /MQSF_MAX_PARALLEL_SESSIONS/, "Restores cannot exceed capacity");
  for (const [start, end] of [["17:00", "18:00"], ["18:00", "19:00"], ["19:00", "20:00"], ["17:00", "20:00"]]) {
    assert.equal((await request("POST", "/api/meetups", { ...slot, start, end })).status, 201, "Count simultaneous sessions, not total intersecting events");
  }

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
