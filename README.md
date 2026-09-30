# MQSF 2026 Program

Static event website for 14–15 October 2026.

## Meet-ups

The [public calendar](https://munich-quantum-software.github.io/mqsf-2026-program/#side-events)
lets participants create shared meet-ups without an account. Editing or deleting a meet-up requires entering the contact email used to create it.
Drag across empty calendar space to prefill a meet-up's time range, or use **Add meet-up**.

The editable two-day calendar is integrated into the main page after Day 2 and before Sponsors.
Run `python3 backend/server.py --demo` to review it at <http://127.0.0.1:8030/#side-events>
with labelled sample meet-ups. Existing `/side-events/` links redirect to this section.
See [the local preview guide](backend/README.md) for development and program hours.
For production storage, deployment, and backups, see [Cloudflare Workers and D1](cloudflare/README.md).
Organizers can use the unlisted [organizer sign-in](https://munich-quantum-software.github.io/mqsf-2026-program/#organizer)
to edit all meet-ups and assign tables with a private access key. See the Cloudflare guide for setup.
