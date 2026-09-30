const labels = { title: "Title", date: "Day", start: "Start time", end: "End time", organizers: "Organizer(s)", contact_email: "Contact email (private)", description: "Description", audience: "Intended audience", table_number: "Table" };
function display(value) {
  return String(value || "Not supplied").replace(/[\\`*_~|\[\]()<>]/g, "\\$&");
}

function textFields(name, value) {
  const chunks = [""];
  for (const character of String(value || "Not supplied")) {
    const escaped = display(character);
    if (chunks.at(-1).length + escaped.length > 1000) chunks.push("");
    chunks[chunks.length - 1] += escaped;
  }
  return chunks.map((value, index) => ({ name: name + (chunks.length > 1 ? ` (${index + 1}/${chunks.length})` : ""), value }));
}

export function discordMessages(change) {
  const before = JSON.parse(change.before_json), after = JSON.parse(change.after_json), event = after || before;
  const appearance = { created: ["➕ Meet-up added", 0x238636], updated: ["✏️ Meet-up changed", 0x2563eb], deleted: ["🗑️ Meet-up deleted", 0xd1242f] };
  const [title, color] = appearance[change.action];
  const date = new Date(`${event.date}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Berlin" });
  const fields = [
    { name: "Organizer(s)", value: display(event.organizers), inline: true },
    { name: "Contact email (private)", value: display(event.contact_email), inline: true },
  ];
  if (before && after) {
    for (const [key, label] of Object.entries(labels)) {
      if ((before[key] ?? null) !== (after[key] ?? null)) {
        const empty = key === "table_number" ? "Not assigned" : null;
        const value = `**Before**\n${display(before[key] ?? empty)}\n\n**After**\n${display(after[key] ?? empty)}`;
        if (value.length <= 1024) fields.push({ name: `${label} changed`, value });
        else fields.push(...textFields(`${label} · Before`, before[key]), ...textFields(`${label} · After`, after[key]));
      }
    }
    if (fields.length === 2) fields.push({ name: "No content changes", value: "The event was saved without changing its details." });
  }
  if (event.table_number != null && (!before || !after || before.table_number === after.table_number)) {
    fields.push({ name: "Table", value: String(event.table_number), inline: true });
  }
  for (const key of ["description", "audience"]) {
    if (!before || !after || before[key] === after[key]) fields.push(...textFields(labels[key], event[key]));
  }
  const base = { title, color, description: `**${display(event.title)}**\n${date} · ${event.start}–${event.end} (Munich time)`,
    footer: { text: `Private · Change ${change.id}` }, timestamp: change.created_at };
  const baseSize = title.length + base.description.length + base.footer.text.length;
  const groups = [[]];
  let size = baseSize;
  for (const field of fields) {
    const length = field.name.length + field.value.length;
    if (groups.at(-1).length === 25 || size + length > 5500) { groups.push([]); size = baseSize; }
    groups.at(-1).push(field);
    size += length;
  }
  return groups.map((fields, index) => ({
    username: "MQSF Community", allowed_mentions: { parse: [] },
    embeds: [{ ...base, title: title + (groups.length > 1 ? ` (${index + 1}/${groups.length})` : ""), fields }],
  }));
}

// A private audit row is also the outbox entry, so failed delivery never loses a change.
export async function notifyChanges(env, limit = 1) {
  if (!env.DISCORD_WEBHOOK_URL) return;
  let url;
  try { url = new URL(env.DISCORD_WEBHOOK_URL); } catch { /* Never include a malformed secret in an error. */ }
  if (!url || url.origin !== "https://discord.com" || url.username || url.password || !/^\/api\/(?:v\d+\/)?webhooks\/\d+\/[\w-]+$/.test(url.pathname)) {
    throw new Error("Configure a Discord incoming webhook in DISCORD_WEBHOOK_URL.");
  }
  url.search = "?wait=true";
  for (let count = 0; count < limit; count++) {
    const now = Math.floor(Date.now() / 1000), lease = now + 120;
    const change = await env.DB.prepare(`UPDATE event_changes SET notify_lease_until=?, notify_attempts=notify_attempts+1
      WHERE id=(SELECT id FROM event_changes WHERE notified_at IS NULL ORDER BY created_at, rowid LIMIT 1)
        AND notify_after<=? AND notify_lease_until<=? RETURNING *`).bind(lease, now, now).first();
    if (!change) return;
    let error = null, stage = "request", retry = Math.min(3600, 60 * 2 ** Math.min(change.notify_attempts - 1, 6));
    try {
      // ponytail: retry the whole notification; a rare multi-part message may repeat a delivered part.
      for (const message of discordMessages(change)) {
        stage = "request";
        // Workers support manual redirects; never forward private payloads to a redirected URL.
        const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify(message), redirect: "manual", signal: AbortSignal.timeout(8000) });
        stage = `HTTP ${response.status} confirmation`;
        if (response.ok && typeof (await response.json()).id === "string") continue;
        error = `Discord HTTP ${response.status}`;
        if (response.status === 429) {
          const seconds = Number((await response.json()).retry_after);
          if (Number.isFinite(seconds)) retry = Math.max(retry, Math.ceil(seconds));
        }
        break;
      }
      if (!error) {
        stage = "record delivery";
        await env.DB.prepare(`UPDATE event_changes SET notified_at=?, notify_lease_until=0, notify_error=NULL
          WHERE id=? AND notify_lease_until=?`).bind(new Date().toISOString(), change.id, lease).run();
        continue;
      }
    } catch (failure) {
      const kind = ["TypeError", "SyntaxError", "TimeoutError", "AbortError"].includes(failure.name) ? failure.name : "Error";
      error = `${stage}: ${kind}`; // Never include exception messages, bodies, contacts, or webhook URLs.
    }
    await env.DB.prepare(`UPDATE event_changes SET notify_after=?, notify_lease_until=0, notify_error=?
      WHERE id=? AND notify_lease_until=?`).bind(Math.floor(Date.now() / 1000) + retry, error, change.id, lease).run();
    return; // Back off for the channel, including rate limits and revoked webhooks.
  }
}
