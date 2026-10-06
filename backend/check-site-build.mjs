import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInNewContext } from "node:vm";

const directory = mkdtempSync(join(tmpdir(), "mqsf-site-test-"));
try {
  for (const preview of [false, true]) {
    const output = join(directory, preview ? "preview" : "production");
    execFileSync(process.execPath, [".github/scripts/package-site.mjs", output, ...(preview ? ["--preview"] : [])]);
    for (const path of ["index.html", "2026/index.html", "2026/program/index.html", "background/index.html"]) {
      assert(existsSync(join(output, path)), path);
    }
    assert.equal(existsSync(join(output, ".nojekyll")), !preview);
    for (const path of ["backend", "cloudflare", ".github", "node_modules", ".data", "background-preview"]) {
      assert(!existsSync(join(output, path)), `${path} must not be published`);
    }
    const config = readFileSync(join(output, "2026/meetups/config.js"), "utf8");
    const html = readFileSync(join(output, "2026/program/index.html"), "utf8");
    if (preview) {
      assert.equal(config, "window.MQSF_PREVIEW = true;\n");
      assert(html.includes('name="robots" content="noindex, nofollow"'));
      assert(html.includes("PR preview · Read-only calendar"));
    } else {
      assert.equal(config, readFileSync("2026/meetups/config.js", "utf8"));
      assert.equal(html, readFileSync("2026/program/index.html", "utf8"));
    }
  }
  const source = readFileSync("2026/meetups/app.mjs", "utf8");
  const api = source.slice(source.indexOf("async function api("), source.indexOf("\nfunction chooseDay("));
  const context = { window: { MQSF_PREVIEW: true }, organizerKey: "", fetch: () => { throw new Error("Preview contacted network"); } };
  const call = runInNewContext(`${api}; api`, context);
  assert.equal(JSON.stringify(await call()), JSON.stringify({ events: [], demo: true }));
  for (const method of ["POST", "PUT", "DELETE"]) {
    await assert.rejects(call("/meetups", { method }), /read-only/);
  }
  await assert.rejects(call("/organizer", { method: "POST" }), /read-only/);
  console.log("Site packaging checks passed: public files only, unchanged production, isolated read-only previews.");
} finally {
  rmSync(directory, { recursive: true, force: true });
}
