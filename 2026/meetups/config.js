// Local previews use their local database; the published site uses Cloudflare.
// This public API address contains no secret or access token.
window.MQSF_API_BASE = ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname)
  ? ""
  : "https://mqsf-2026-calendar.mqsf-2026-program.workers.dev/api";
