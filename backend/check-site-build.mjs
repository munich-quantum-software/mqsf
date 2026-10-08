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
    for (const path of ["index.html", "2026/index.html", "2026/program/index.html", "background/index.html", "logos/index.html", "assets/brand.css"]) {
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

  const wave = readFileSync("assets/waves.js", "utf8");
  let darkPoints;
  for (const light of [false, true]) for (const reduced of [false, true]) {
    const stops = [];
    const points = [];
    const layers = [];
    let frames = 0;
    const paint = {
      createLinearGradient: () => ({ addColorStop: (offset, color) => stops.push([offset, color]) }),
      fillRect() {}, clearRect() {}, beginPath() {}, fill() {}, moveTo() {}, lineTo() {}, stroke() {},
      arc: (...point) => points.push(point),
    };
    const canvas = {
      getContext: () => paint,
      parentElement: { getBoundingClientRect: () => ({ width: 1000, height: 1000 }), append: layer => layers.push(layer) },
    };
    const document = {
      documentElement: { dataset: {} }, hidden: false, addEventListener() {},
      querySelectorAll: () => [canvas],
      createElement: () => ({ getContext: () => paint, setAttribute() {}, style: {} }),
    };
    runInNewContext(wave, {
      document, location: { search: light ? "?theme=light" : "" }, URLSearchParams,
      matchMedia: () => ({ matches: reduced, addEventListener() {} }),
      devicePixelRatio: 1, window: { addEventListener() {} },
      requestAnimationFrame: () => ++frames, cancelAnimationFrame() {},
    });
    assert.equal(document.documentElement.dataset.theme, light ? "light" : "dark");
    assert.equal(frames, reduced ? 0 : 1, "Reduced motion schedules no animation");
    assert.equal(canvas.hidden, reduced && !light);
    assert(layers.every(layer => layer.hidden === canvas.hidden));
    if (reduced && !light) {
      assert.equal(points.length, 0, "Dark reduced motion retains the original static image");
    } else {
      assert.deepEqual(stops.slice(-3), [[0, light ? "#ffffff" : "#171f39"], [.55, light ? "#f3f5f8" : "#17213c"], [1, light ? "#eaf0f6" : "#18233c"]]);
      assert.equal(paint.fillStyle, light ? "#bfd6e4" : "#1d3951");
      assert.equal(paint.strokeStyle, paint.fillStyle, "Nodes and edges share one opaque color");
      if (light) assert.equal(JSON.stringify(points), darkPoints, "Light and dark retain identical network geometry");
      else darkPoints = JSON.stringify(points);
    }
  }
  console.log("Site packaging checks passed: public files only, unchanged production, isolated read-only previews.");
} finally {
  rmSync(directory, { recursive: true, force: true });
}
