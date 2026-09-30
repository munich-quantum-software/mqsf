import conference from "../side-events/conference.json" with { type: "json" };
import { notifyChanges } from "./notifications.mjs";
import { createHash, timingSafeEqual } from "node:crypto";

const fields = { date: 10, start: 5, end: 5, title: 120, description: 3000, audience: 300, organizers: 200 };
const publicColumns = [...Object.keys(fields), "id", "version", "updated_at", "table_number"].join(", ");
class RequestError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function organizerAccess(request, env) {
  const authorization = request.headers.get("Authorization");
  if (!authorization) return false;
  const secret = env.ORGANIZER_ACCESS_KEY;
  if (typeof secret !== "string" || !/^[!-~]{32,256}$/.test(secret)) {
    throw new RequestError(503, "Organizer access is not configured. Contact the MQSF organizers.");
  }
  const key = /^Bearer ([!-~]{32,256})$/.exec(authorization)?.[1];
  const digest = value => createHash("sha256").update(value).digest();
  if (!key || !timingSafeEqual(digest(key), digest(secret))) {
    throw new RequestError(401, "Organizer access key is invalid. Sign in again or sign out to use the contact email.");
  }
  return true;
}

function validate(data) {
  const event = {};
  for (const [key, limit] of Object.entries(fields)) {
    const value = data[key];
    if (typeof value !== "string" || !value.trim() || value.length > limit) {
      throw new RequestError(400, `${key} is required (maximum ${limit} characters).`);
    }
    event[key] = value.trim();
  }
  const day = conference.days.find(day => day.date === event.date);
  if (!day) throw new RequestError(400, "Choose 14 or 15 October 2026.");
  if (![event.start, event.end].every(time => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time))) {
    throw new RequestError(400, "Use a time between 00:00 and 23:59.");
  }
  if (event.start >= event.end) throw new RequestError(400, "The end time must be after the start time on the same day.");
  if ((day.start && event.start < day.start) || (day.end && event.end > day.end)) {
    throw new RequestError(400, `Choose a time within the published hours for ${event.date}.`);
  }
  return event;
}

function contactEmail(data) {
  const value = data.contact_email === undefined ? "" : data.contact_email;
  if (typeof value !== "string" || value.length > 254 || /[\r\n]/.test(value)) {
    throw new RequestError(400, "Enter a valid private contact email address.");
  }
  const email = value.trim();
  if (!/^[^\s<>@,;]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,}$/.test(email)) {
    throw new RequestError(400, "Enter a valid private contact email address.");
  }
  return email;
}

async function readData(request) {
  if (request.headers.get("Content-Type")?.split(";")[0].trim() !== "application/json") {
    throw new RequestError(415, "Send JSON using Content-Type: application/json.");
  }
  const reader = request.body?.getReader(), chunks = [];
  let size = 0;
  if (!reader) throw new RequestError(400, "Send an event as a JSON object.");
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 20000) { await reader.cancel(); throw new RequestError(413, "The event is too large."); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  try {
    const data = JSON.parse(await new Blob(chunks).text());
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error();
    return data;
  } catch { throw new RequestError(400, "Send an event as a valid JSON object."); }
}

export default {
  async scheduled(controller, env) {
    await notifyChanges(env, 10);
  },
  async fetch(request, env, ctx) {
    const url = new URL(request.url), origin = request.headers.get("Origin");
    const allowed = !origin || origin === url.origin || (env.ALLOWED_ORIGINS || "").split(",").includes(origin);
    const headers = {
      "Cache-Control": "no-store", "Vary": "Origin", "X-Content-Type-Options": "nosniff",
      ...(origin && allowed ? { "Access-Control-Allow-Origin": origin } : {}),
    };
    const reply = (status, data) => Response.json(data, { status, headers });
    try {
      const match = /^\/api\/(?:meetups|events)(?:\/([a-f0-9-]{36}))?$/.exec(url.pathname);
      const login = url.pathname === "/api/organizer";
      if (!match && !login) throw new RequestError(404, "Not found.");
      if (!allowed) throw new RequestError(403, "This website is not configured to edit the calendar.");
      const id = match?.[1], method = request.method;
      if (method === "OPTIONS") return new Response(null, { status: 204, headers: {
        ...headers, "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      } });
      if (login) {
        if (method !== "POST") throw new RequestError(405, "Method not allowed.");
        if (!organizerAccess(request, env)) throw new RequestError(401, "Enter the organizer access key.");
        return reply(200, { organizer: true });
      }
      if (method === "GET" && !id) {
        const { results } = await env.DB.prepare(`SELECT ${publicColumns} FROM events ORDER BY date, start, end, id`).all();
        return reply(200, { events: results, demo: false });
      }
      if (!["POST", "PUT", "DELETE"].includes(method) || (method === "POST") === Boolean(id)) {
        throw new RequestError(405, "Method not allowed.");
      }
      const organizer = organizerAccess(request, env);
      const data = await readData(request);
      if (id && (!Number.isSafeInteger(data.version) || data.version < 1)) {
        throw new RequestError(400, "The event version is missing. Reload the event and try again.");
      }
      const email = organizer && id ? "" : contactEmail(data);
      const assignTable = organizer && Object.hasOwn(data, "table_number");
      const table = assignTable ? data.table_number : null;
      if (assignTable && ![null, 1, 2, 3].includes(table)) throw new RequestError(400, "Choose table 1, 2, 3, or not assigned.");
      let saved;
      if (method === "DELETE") {
        saved = await env.DB.prepare("DELETE FROM events WHERE id=? AND version=? AND (? OR contact_email=? COLLATE NOCASE) RETURNING id")
          .bind(id, data.version, Number(organizer), email).first();
      } else {
        const event = validate(data), values = Object.keys(fields).map(key => event[key]);
        const updated = new Date().toISOString();
        if (method === "POST") {
          // Choose and reserve a free table in the same statement, including concurrent saves.
          saved = await env.DB.prepare(`WITH assignment AS (
            SELECT COALESCE(?, (SELECT MIN(number) FROM (SELECT 1 AS number UNION ALL SELECT 2 UNION ALL SELECT 3) AS tables
              WHERE NOT EXISTS (SELECT 1 FROM events WHERE date=? AND start<? AND end>? AND table_number=tables.number))) AS number
          ) INSERT INTO events
            (date, start, end, title, description, audience, organizers, contact_email, updated_at, id, table_number)
            SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, number FROM assignment WHERE number IS NOT NULL
            RETURNING ${publicColumns}`).bind(table, event.date, event.end, event.start, ...values, email, updated, crypto.randomUUID()).first();
          if (!saved) throw new RequestError(422, "No table is free for this entire time slot. At most 3 sessions can run at the same time. Choose another time or contact the MQSF organizers.");
        } else {
          saved = await env.DB.prepare(`UPDATE events SET date=?, start=?, end=?, title=?, description=?, audience=?, organizers=?,
            table_number=CASE WHEN ? THEN ? ELSE table_number END, updated_at=?, version=version+1
            WHERE id=? AND version=? AND (? OR contact_email=? COLLATE NOCASE) RETURNING ${publicColumns}`)
            .bind(...values, Number(assignTable), table, updated, id, data.version, Number(organizer), email).first();
        }
      }
      if (!saved) {
        const exists = await env.DB.prepare("SELECT contact_email=? COLLATE NOCASE AS verified FROM events WHERE id=?").bind(email, id).first();
        if (!exists) throw new RequestError(404, "This event was removed. Your changes have not been saved.");
        if (!organizer && !exists.verified) throw new RequestError(403, "The contact email does not match this event. Enter the address used to create it, or contact the MQSF organizers.");
        throw new RequestError(409, "Someone changed this event. Load the latest version before saving or deleting it.");
      }
      ctx?.waitUntil(notifyChanges(env));
      return reply(method === "POST" ? 201 : 200, method === "DELETE" ? { deleted: id } : { event: saved });
    } catch (error) {
      if (error instanceof RequestError) return reply(error.status, { error: error.message });
      if (error.message?.includes("MQSF_MAX_PARALLEL_SESSIONS")) {
        return reply(422, { error: "At most 3 sessions can run at the same time. Choose another time. Your changes have not been saved." });
      }
      if (error.message?.includes("MQSF_TABLE_OCCUPIED")) {
        return reply(422, { error: "The assigned table is already occupied at that time. Choose another time or ask the MQSF organizers to change the table assignment. Your changes have not been saved." });
      }
      return reply(503, { error: "The calendar could not save or load events. Please try again. Your draft is still here." });
    }
  },
};
