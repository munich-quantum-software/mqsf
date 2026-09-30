// Maintainer-only CLI. Uses Wrangler's existing Cloudflare login, never a public admin endpoint.
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

export function assignTableSQL(id, table, expectedVersion) {
  if (!/^[a-f0-9-]{36}$/.test(id) || ![null, 1, 2, 3].includes(table)
      || !Number.isSafeInteger(expectedVersion) || expectedVersion < 1) throw new Error("Invalid table assignment.");
  return `UPDATE events SET table_number=${table === null ? "NULL" : table}, version=version+1,
    updated_at=strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE id='${id}' AND version=${expectedVersion} AND table_number IS NOT ${table === null ? "NULL" : table}
    RETURNING id, title, date, start, end, table_number, version;`;
}

export function restoreSQL(id, snapshot, expectedVersion) {
  if (!/^[a-f0-9]{32}$/.test(id) || !["before", "after"].includes(snapshot)
      || !Number.isSafeInteger(expectedVersion) || expectedVersion < 0) throw new Error("Invalid restore arguments.");
  const fields = ["date", "start", "end", "title", "description", "audience", "organizers", "contact_email", "table_number"];
  const source = `${snapshot}_json`;
  return `INSERT INTO events (id, ${fields.join(", ")}, version, updated_at)
    SELECT event_id, ${fields.map(key => `json_extract(${source}, '$.${key}')`).join(", ")},
      (SELECT COALESCE(MAX(MAX(COALESCE(json_extract(before_json, '$.version'), 0),
        COALESCE(json_extract(after_json, '$.version'), 0))), 0) + 1 FROM event_changes h WHERE h.event_id=c.event_id),
      strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    FROM event_changes c WHERE id='${id}' AND ${source} IS NOT NULL
      AND COALESCE((SELECT version FROM events WHERE id=c.event_id), 0)=${expectedVersion}
    ON CONFLICT(id) DO UPDATE SET ${fields.map(key => `${key}=excluded.${key}`).join(", ")},
      version=excluded.version, updated_at=excluded.updated_at
    WHERE events.version=${expectedVersion}
    RETURNING id, title, version;`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [command, id, snapshot, version, apply] = process.argv.slice(2);
  let sql;
  if (command === "list") {
    sql = `SELECT c.id AS change_id, event_id, action, created_at,
      json_extract(COALESCE(after_json, before_json), '$.title') AS title,
      COALESCE((SELECT version FROM events WHERE id=c.event_id), 0) AS current_version,
      notified_at, notify_error FROM event_changes c ORDER BY created_at DESC, rowid DESC LIMIT 100`;
  } else if (command === "tables") {
    sql = "SELECT id, title, date, start, end, table_number, version FROM events ORDER BY date, start, end, id";
  } else if (command === "assign-table" && /^(?:[1-3]|none)$/.test(snapshot || "") && /^\d+$/.test(version || "")) {
    sql = assignTableSQL(id, snapshot === "none" ? null : Number(snapshot), Number(version));
    if (apply !== "--apply") {
      console.log(sql + "\nDry run. Add --apply to assign the table. No returned row means the version changed, the event was removed, or the table is already assigned.");
      process.exit(0);
    }
  } else if (command === "show" && /^[a-f0-9]{32}$/.test(id)) {
    sql = `SELECT id, action, created_at, before_json, after_json FROM event_changes WHERE id='${id}'`;
  } else if (command === "restore" && /^\d+$/.test(version || "")) {
    sql = restoreSQL(id, snapshot, Number(version));
    if (apply !== "--apply") {
      console.log(sql + "\nDry run. Review the snapshot with 'show'; add --apply to restore. No returned row means the expected version no longer matches.");
      process.exit(0);
    }
  } else {
    console.error("Usage: node cloudflare/moderate.mjs list | tables | assign-table EVENT_ID 1|2|3|none CURRENT_VERSION [--apply] | show CHANGE_ID | restore CHANGE_ID before|after CURRENT_VERSION [--apply]\nUse version 0 only for an event that is currently deleted. 'show' contains private contact details.");
    process.exit(1);
  }
  const output = execFileSync(process.execPath, ["node_modules/wrangler/bin/wrangler.js", "d1", "execute", "DB",
    "--remote", "--config", "cloudflare/wrangler.jsonc", "--command", sql, "--json"],
  { cwd: fileURLToPath(new URL("../", import.meta.url)), encoding: "utf8", stdio: ["inherit", "pipe", "inherit"] });
  console.log(output);
}
