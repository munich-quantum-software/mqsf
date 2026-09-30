import conference from "../side-events/conference.json" with { type: "json" };
import { notifyChanges } from "./notifications.mjs";

const fields = { date: 10, start: 5, end: 5, title: 120, description: 3000, audience: 300, organizers: 200 };
const publicColumns = [...Object.keys(fields), "id", "version", "updated_at"].join(", ");
class RequestError extends Error {
  constructor(status, message) { super(message); this.status = status; }
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

function contactEmail(data, required) {
  const value = data.contact_email === undefined ? "" : data.contact_email;
  if (typeof value !== "string" || value.length > 254 || /[\r\n]/.test(value)) {
    throw new RequestError(400, "Enter a valid private contact email address.");
  }
  const email = value.trim();
  if (!email && !required) return "";
  if (!/^[^\s<>@,;]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,}$/.test(email)) {
    throw new RequestError(400, "Enter a private contact email address, or contact robert@mq.sc to arrange your event directly.");
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
      if (!match) throw new RequestError(404, "Not found.");
      if (!allowed) throw new RequestError(403, "This website is not configured to edit the calendar.");
      const id = match[1], method = request.method;
      if (method === "OPTIONS") return new Response(null, { status: 204, headers: {
        ...headers, "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      } });
      if (method === "GET" && !id) {
        const { results } = await env.DB.prepare(`SELECT ${publicColumns} FROM events ORDER BY date, start, end, id`).all();
        return reply(200, { events: results, demo: false });
      }
      if (!["POST", "PUT", "DELETE"].includes(method) || (method === "POST") === Boolean(id)) {
        throw new RequestError(405, "Method not allowed.");
      }
      const data = await readData(request);
      if (id && (!Number.isSafeInteger(data.version) || data.version < 1)) {
        throw new RequestError(400, "The event version is missing. Reload the event and try again.");
      }
      let saved;
      if (method === "DELETE") {
        saved = await env.DB.prepare("DELETE FROM events WHERE id=? AND version=? RETURNING id").bind(id, data.version).first();
      } else {
        const event = validate(data), values = Object.keys(fields).map(key => event[key]);
        const email = contactEmail(data, method === "POST");
        const updated = new Date().toISOString();
        if (method === "POST") {
          saved = await env.DB.prepare(`INSERT INTO events
            (date, start, end, title, description, audience, organizers, contact_email, updated_at, id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING ${publicColumns}`).bind(...values, email, updated, crypto.randomUUID()).first();
        } else {
          saved = await env.DB.prepare(`UPDATE events SET date=?, start=?, end=?, title=?, description=?, audience=?, organizers=?,
            contact_email=COALESCE(NULLIF(?, ''), contact_email), updated_at=?, version=version+1
            WHERE id=? AND version=? RETURNING ${publicColumns}`).bind(...values, email, updated, id, data.version).first();
        }
      }
      if (!saved) {
        const exists = await env.DB.prepare("SELECT id FROM events WHERE id=?").bind(id).first();
        if (!exists) throw new RequestError(404, "This event was removed. Your changes have not been saved.");
        throw new RequestError(409, "Someone changed this event. Load the latest version before saving or deleting it.");
      }
      ctx?.waitUntil(notifyChanges(env));
      return reply(method === "POST" ? 201 : 200, method === "DELETE" ? { deleted: id } : { event: saved });
    } catch (error) {
      if (error instanceof RequestError) return reply(error.status, { error: error.message });
      return reply(503, { error: "The calendar could not save or load events. Please try again. Your draft is still here." });
    }
  },
};
