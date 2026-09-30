# Cloudflare hosting

GitHub Pages serves the website. A Cloudflare Worker handles `/api/meetups` and saves events in D1.
The deployed API is <https://mqsf-2026-calendar.mqsf-2026-program.workers.dev/api/meetups>.
The old `/api/events` route remains an alias for open tabs. New clients use `/api/meetups` to avoid
EasyPrivacy's `||workers.dev/api/event` rule, which also blocks `/api/events` on Workers subdomains.
The `mqsf-2026-calendar` database is already provisioned in the EU; its binding is in `wrangler.jsonc`.
There are no participant accounts. Anyone can add an event; editing or deleting requires its original contact email. Revision checks protect concurrent edits.
At most three sessions may run simultaneously. Database triggers enforce this for additions, edits, and restores,
including concurrent requests. An event ending exactly when another begins does not overlap it.
Organizer names are public. Contact emails are private: only the organizers can read them in D1 and their private Discord channel.
The public API explicitly selects public fields, including in save responses. There are no public history or moderation endpoints.
No cookies, analytics, or application visitor logs are collected.
The hosting providers may keep their own infrastructure logs.

## Development

Use Node.js 22 or newer and run `npm ci` from the repository root.

```sh
npm test
npx wrangler d1 migrations apply DB --local --config cloudflare/wrangler.jsonc
npm run dev:api
```

Tests use an isolated, temporary D1 database. The existing Python preview remains available with
`python3 backend/server.py --demo --port 8030`; it uses its own local sample database.

## Deploy

1. Sign in with `npx wrangler login --use-keyring --scopes account:read user:read workers_scripts:write d1:write`.
2. For a new installation, create a database with `npx wrangler d1 create mqsf-2026-calendar --jurisdiction eu`.
   Put its ID in `cloudflare/wrangler.jsonc`. Do not recreate an existing database.
3. Apply the schema and five example events:

   ```sh
   npx wrangler d1 migrations apply DB --remote --config cloudflare/wrangler.jsonc
   npm run deploy:api
   ```

4. Set the published API URL in `side-events/config.js`. Local previews should continue using their local API.
5. Push the website to the repository's `main` branch to publish it with GitHub Pages.

Migrations run once. The example titles are marked `(example)`; they are editable placeholders.
Deployment does not reset the database or recreate deleted examples. Never put tokens or passwords in this repository.
The Workers/D1 free plan has daily limits, so check usage in the Cloudflare dashboard during the event.

For later backend updates, run the tests, apply any new migrations, then `npm run deploy:api`.
For migration 0004, deploy the Worker first so it can explain capacity errors, then apply the migration and publish the frontend.
The migration only adds capacity checks; it does not change existing events. Check for existing overlaps above three before applying it.
For migration 0005, apply the migration first, then deploy the Worker and frontend. Existing sessions start unassigned.
**Exception for migration 0003:** back up first, deploy the new Worker **before** applying the migration, then publish the form.
The older Worker returned `SELECT *`, so it must be replaced before private columns exist. Reads continue to work;
writes may return a temporary 503 until migration 0003 finishes. Never roll back to the old `SELECT *` Worker after this migration.
Conference dates and hours are bundled from `side-events/conference.json`, so changes to that file need a Worker redeploy.

## Backups

Export before maintenance or after the event. Exports contain **private contact addresses and full history**:

```sh
npx wrangler d1 export DB --remote --config cloudflare/wrangler.jsonc --output .data/mqsf-backup.sql
```

Keep exports outside Git. Cloudflare also provides D1 Time Travel recovery.


## Private contacts and Discord notifications

New events require a contact email. Updates and deletions require entering the same address, including through the legacy `/api/events` route.
The API checks the email and revision in the database mutation itself. It trims surrounding spaces and ignores ASCII letter case; public edits cannot replace the address.
The address stays hidden in public responses, forms, and error messages. This checks knowledge of the address, not ownership of the mailbox.
Legacy or example events without a saved address cannot be edited or deleted publicly; organizers can manage them directly through Cloudflare.
The form explains the purpose and offers direct contact via robert@mq.sc as an alternative.

1. Create a private **text channel on a Discord server** accessible only to Simon, Robert, and trusted server administrators.
   Group DMs do not support incoming webhooks. Set the channel's notification preference to **All Messages** for both organizers.
2. In channel settings, open **Integrations → Webhooks**, create an incoming webhook, and copy its URL.
3. In Cloudflare, open **mqsf-2026-calendar → Settings → Variables and Secrets** and add a **Secret** named `DISCORD_WEBHOOK_URL` in **Production**.
   Save/deploy it. Do not put the value in this repository, a command argument, or chat.
4. Deploy the Worker. Without the secret, changes remain queued and will be sent after it is configured.

Notifications distinguish added (green), changed (blue), and deleted (red) meet-ups. Changes show each affected field before and after.
Every notification includes the full event details, private contact, and a change ID directly in rich messages, without attachments.
Long text spans numbered fields/messages to stay within Discord limits without truncation.
Participant text cannot ping users or roles. The webhook is stored only by Cloudflare, never sent to the browser.
The local Python preview does **not** send Discord messages.

Database triggers record every creation, update, and deletion atomically. The same rows form the delivery queue.
The Worker attempts delivery after changes and checks pending rows every minute. Failures retry with backoff; the history is retained.
A lease on the oldest pending change keeps notifications in recorded order, including when edits happen in quick succession.
Later changes wait if an earlier delivery is in progress or awaiting retry. Delivery is at least once: a timeout or failure in a later message part can cause
previously delivered parts to repeat. Use the change ID and part number to identify duplicates. Failed deliveries and pending rows are visible with the moderation command below.
If delivery repeatedly fails, check channel/webhook permissions and the `notify_error` status; response bodies are not logged.

## Review and recover changes

Run these from the repository root using an authorized Wrangler login. No admin secret or history is exposed on the website.
The change ID is included in every Discord notification.

```sh
node cloudflare/moderate.mjs list
node cloudflare/moderate.mjs show CHANGE_ID
node cloudflare/moderate.mjs restore CHANGE_ID before CURRENT_VERSION
# After reviewing the snapshot and the dry run:
node cloudflare/moderate.mjs restore CHANGE_ID before CURRENT_VERSION --apply
```

Use `before` to undo an edit/deletion, or `after` to recover a selected saved state. For a deleted event use current version `0`;
otherwise use `current_version` from `list`. A stale version or missing snapshot returns no rows and changes nothing.
Restoration generates a new revision and history entry, so stale browser drafts cannot overwrite it, and the restore is also notified.
`show` contains private addresses. Do not paste its output, private Discord messages, or database exports into public issues.

## Assign tables

Each session has an optional `table_number` (1, 2, or 3). Assign it later using the existing organizer login:

```sh
node cloudflare/moderate.mjs tables
node cloudflare/moderate.mjs assign-table EVENT_ID 1 CURRENT_VERSION
# After reviewing the dry run:
node cloudflare/moderate.mjs assign-table EVENT_ID 1 CURRENT_VERSION --apply
```

Use `none` instead of a number to clear an assignment. Get the event ID and current version from `tables`.
Assignments appear in event details and Discord notifications. Only organizers with database access can change them;
public event edits preserve the saved table. The database rejects overlapping sessions at the same table, including
time changes and restored events. Back-to-back sessions and sessions on different days can reuse a table.
Assignments increment the event revision and are included in the private change history, so they can be undone with `restore`.

History and contacts are retained for moderation; there is no automatic deletion job. After event follow-up, remove private data
from D1, private Discord notifications, and any local exports according to the organizers' retention decision.
