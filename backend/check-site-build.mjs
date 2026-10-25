import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";

function checkRecap(output) {
  const page = join(output, "2026/index.html");
  const recap = readFileSync(page, "utf8");
  const countClass = (tag, className) =>
    [
      ...recap.matchAll(new RegExp(`<${tag}\\b[^>]*class="([^"]*)"`, "g")),
    ].filter(([, classes]) => classes.split(/\s+/).includes(className)).length;
  assert.equal(
    countClass("details", "talk"),
    16,
    "All 16 talks remain available",
  );
  const sessions = [
    ...recap.matchAll(
      /<article\b[^>]*id="pitch-session-\d+"[^>]*>([\s\S]*?)<\/article>/g,
    ),
  ];
  assert.equal(sessions.length, 4, "Keep all four pitch sessions");
  assert.equal(
    sessions.reduce(
      (sum, [, html]) => sum + [...html.matchAll(/<li\b/g)].length,
      0,
    ),
    44,
    "Keep all 44 pitches",
  );
  assert.equal(
    countClass("section", "survey-pie") + countClass("section", "survey-bars"),
    13,
    "Keep all 13 structured questionnaire results",
  );
  assert.doesNotMatch(
    recap,
    /http-equiv="refresh"/i,
    "The edition contains the recap, not another redirect",
  );
  assert.doesNotMatch(
    recap,
    /id="meetups"/,
    "Meet-ups stay in the program archive",
  );
  for (const year of [2025, 2024, 2023])
    assert(
      recap.includes(
        `https://www.cda.cit.tum.de/research/quantum/${year}_mqsf_summary/`,
      ),
      `Keep the ${year} summary link`,
    );

  const routing = readFileSync(join(output, "2026/recap.js"), "utf8").split(
    "\nfor (const card",
  )[0];
  for (const prefix of ["/mqsf/2026/", "/mqsf/previews/pr-18/2026/"]) {
    for (const [hash, expected] of [
      ["#program", "program/?utm_source=mqsf"],
      ["#day-2", "program/?utm_source=mqsf#day-2"],
      ["#side-events", "program/?utm_source=mqsf#side-events"],
      ["#registration", "?utm_source=mqsf#overview"],
      ["#events", null],
    ]) {
      const href = `https://munich-quantum-software.github.io${prefix}?utm_source=mqsf${hash}`;
      let destination;
      runInNewContext(routing, {
        URL,
        location: {
          href,
          hash,
          search: "?utm_source=mqsf",
          pathname: prefix,
          replace: (value) => (destination = new URL(value, href).href),
        },
      });
      assert.equal(
        destination,
        expected === null ? undefined : new URL(expected, href).href,
        `Keep legacy recap link ${href}`,
      );
    }
  }

  const pageUrl = pathToFileURL(page);
  const references = [...recap.matchAll(/\b(?:href|src)="([^"]+)"/g)].map(
    (match) => match[1],
  );
  for (const reference of references) {
    if (/^(?:https?:|mailto:|data:)/.test(reference)) continue;
    assert(
      !reference.startsWith("/"),
      `Use preview-safe relative URL: ${reference}`,
    );
    const url = new URL(reference, pageUrl);
    const target = fileURLToPath(url);
    assert(
      existsSync(target),
      `Recap is missing local asset or page: ${reference}`,
    );
    if (reference.startsWith("#"))
      assert(
        recap.includes(`id="${reference.slice(1)}"`),
        `Missing recap anchor: ${reference}`,
      );
    if (url.pathname.endsWith(".css")) {
      for (const [, asset] of readFileSync(target, "utf8").matchAll(
        /url\(["']?([^)'"\s]+)/g,
      )) {
        if (/^(?:https?:|data:|#)/.test(asset)) continue;
        assert(!asset.startsWith("/"), `Use preview-safe CSS URL: ${asset}`);
        assert(
          existsSync(fileURLToPath(new URL(asset, url))),
          `Missing recap CSS asset: ${asset}`,
        );
      }
    }
  }
}

const recapScript = readFileSync("2026/recap.js", "utf8");
const counterScript =
  recapScript.slice(
    recapScript.indexOf("function countHighlights()"),
    recapScript.indexOf("\ncountHighlights();"),
  ) + "\ncountHighlights();";
for (const scenario of ["reduced motion", "complete", "preference change"]) {
  const counter = {
    textContent: "400",
    dataset: { count: "400" },
  };
  let intersect,
    frame,
    preferenceChange,
    disconnected = false;
  const motion = {
    matches: scenario === "reduced motion",
    addEventListener: (_, listener) => (preferenceChange = listener),
  };
  class IntersectionObserver {
    constructor(callback) {
      intersect = callback;
    }
    observe(element) {
      assert.equal(element, counter);
    }
    unobserve() {}
    disconnect() {
      disconnected = true;
    }
  }
  runInNewContext(counterScript, {
    document: { querySelectorAll: () => [counter], addEventListener() {} },
    window: { matchMedia: () => motion, IntersectionObserver },
    IntersectionObserver,
    performance: { now: () => 0 },
    requestAnimationFrame: (callback) => {
      frame = callback;
      return 1;
    },
    cancelAnimationFrame: () => {
      frame = undefined;
    },
  });
  if (scenario === "reduced motion") {
    assert.equal(counter.textContent, "400");
    assert.equal(intersect, undefined);
    assert.equal(frame, undefined);
    continue;
  }
  intersect([{ target: counter, isIntersecting: false }]);
  assert.equal(counter.textContent, "400");
  intersect([{ target: counter, isIntersecting: true }]);
  assert.equal(counter.textContent, "0");
  frame(1750);
  assert(Number(counter.textContent) > 0 && Number(counter.textContent) < 400);
  if (scenario === "complete") {
    const finish = frame;
    frame = undefined;
    finish(3500);
  } else {
    motion.matches = true;
    preferenceChange();
    assert(disconnected);
  }
  assert.equal(counter.textContent, "400");
  assert.equal(frame, undefined, "Finished counters leave no queued animation");
}

const directory = mkdtempSync(join(tmpdir(), "mqsf-site-test-"));
try {
  for (const preview of [false, true]) {
    const output = join(directory, preview ? "preview" : "production");
    execFileSync(process.execPath, [
      ".github/scripts/package-site.mjs",
      output,
      ...(preview ? ["--preview"] : []),
    ]);
    for (const path of [
      "index.html",
      "2026/index.html",
      "2026/program/index.html",
      "background/index.html",
      "logos/index.html",
      "assets/brand.css",
      "assets/images/brand/logo-q-light.svg",
    ]) {
      assert(existsSync(join(output, path)), path);
    }
    assert.equal(existsSync(join(output, ".nojekyll")), !preview);
    checkRecap(output);
    assert.equal(
      JSON.parse(
        readFileSync(join(output, "2026/meetups/conference.json"), "utf8"),
      ).archived,
      true,
    );
    for (const path of [
      "backend",
      "cloudflare",
      ".github",
      "node_modules",
      ".data",
      "background-preview",
    ]) {
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
  const api = source.slice(
    source.indexOf("async function api("),
    source.indexOf("\nfunction chooseDay("),
  );
  const context = {
    window: { MQSF_PREVIEW: true },
    config: { archived: false },
    organizerKey: "",
    fetch: () => {
      throw new Error("Preview contacted network");
    },
  };
  const call = runInNewContext(`${api}; api`, context);
  assert.equal(
    JSON.stringify(await call()),
    JSON.stringify({ events: [], demo: true }),
  );
  for (const method of ["POST", "PUT", "DELETE"]) {
    await assert.rejects(call("/meetups", { method }), /read-only/);
  }
  await assert.rejects(call("/organizer", { method: "POST" }), /read-only/);

  const archive = JSON.parse(readFileSync("2026/meetups/archive.json", "utf8"));
  assert.equal(archive.events.length, 19, "Keep all archived meet-ups");
  for (const event of archive.events) {
    assert.equal(Object.hasOwn(event, "contact_email"), false);
    assert(["2026-10-14", "2026-10-15"].includes(event.date));
  }
  const fetched = [];
  for (const preview of [false, true]) {
    const archivedCall = runInNewContext(`${api}; api`, {
      window: { MQSF_PREVIEW: preview },
      config: { archived: true },
      organizerKey: "",
      archiveUrl: "https://archive.example/2026/meetups/archive.json",
      AbortController,
      setTimeout,
      clearTimeout,
      fetch: async (url) => {
        fetched.push(url);
        return { ok: true, json: async () => archive };
      },
    });
    assert.equal((await archivedCall()).events.length, archive.events.length);
    for (const method of ["POST", "PUT", "DELETE"])
      await assert.rejects(archivedCall("/meetups", { method }), /read-only/);
    await assert.rejects(
      archivedCall("/organizer", { method: "POST" }),
      /read-only/,
    );
  }
  assert.deepEqual(
    fetched,
    Array(2).fill("https://archive.example/2026/meetups/archive.json"),
  );
  const wave = readFileSync("assets/waves.js", "utf8");
  let darkPoints;
  for (const [search, light] of [
    ["", false],
    ["?theme=light", true],
    ["?theme=auto", false],
    ["?theme=auto", true],
  ])
    for (const reduced of [false, true]) {
      const stops = [];
      const points = [];
      const layers = [];
      let frames = 0;
      let preferenceChange;
      const colorScheme = {
        matches: search === "?theme=auto" ? light : !light,
        addEventListener: (_, listener) => {
          preferenceChange = listener;
        },
      };
      const paint = {
        createLinearGradient: () => ({
          addColorStop: (offset, color) => stops.push([offset, color]),
        }),
        fillRect() {},
        clearRect() {},
        beginPath() {},
        fill() {},
        moveTo() {},
        lineTo() {},
        stroke() {},
        arc: (...point) => points.push(point),
      };
      const canvas = {
        getContext: () => paint,
        parentElement: {
          getBoundingClientRect: () => ({ width: 1000, height: 1000 }),
          append: (layer) => layers.push(layer),
        },
      };
      const document = {
        documentElement: { dataset: {} },
        hidden: false,
        addEventListener() {},
        querySelectorAll: () => [canvas],
        createElement: () => ({
          getContext: () => paint,
          setAttribute() {},
          style: {},
        }),
      };
      runInNewContext(wave, {
        document,
        location: { search },
        URLSearchParams,
        matchMedia: (query) =>
          query.includes("prefers-color-scheme")
            ? colorScheme
            : { matches: reduced, addEventListener() {} },
        devicePixelRatio: 1,
        window: { addEventListener() {} },
        requestAnimationFrame: () => ++frames,
        cancelAnimationFrame() {},
      });
      assert.equal(
        document.documentElement.dataset.theme,
        light ? "light" : "dark",
      );
      assert.equal(
        frames,
        reduced ? 0 : 1,
        "Reduced motion schedules no animation",
      );
      assert.equal(canvas.hidden, reduced && !light);
      assert(layers.every((layer) => layer.hidden === canvas.hidden));
      if (reduced && !light) {
        assert.equal(
          points.length,
          0,
          "Dark reduced motion retains the original static image",
        );
      } else {
        assert.deepEqual(stops.slice(-3), [
          [0, light ? "#ffffff" : "#171f39"],
          [0.55, light ? "#f3f5f8" : "#17213c"],
          [1, light ? "#eaf0f6" : "#18233c"],
        ]);
        assert.equal(paint.fillStyle, light ? "#bfd6e4" : "#1d3951");
        assert.equal(
          paint.strokeStyle,
          paint.fillStyle,
          "Nodes and edges share one opaque color",
        );
        if (light)
          assert.equal(
            JSON.stringify(points),
            darkPoints,
            "Light and dark retain identical network geometry",
          );
        else darkPoints = JSON.stringify(points);
      }
      if (search === "?theme=auto") {
        colorScheme.matches = !light;
        preferenceChange();
        assert.equal(
          document.documentElement.dataset.theme,
          light ? "dark" : "light",
        );
        assert.equal(canvas.hidden, reduced && light);
        if (!(reduced && light))
          assert.equal(paint.strokeStyle, light ? "#1d3951" : "#bfd6e4");
        assert.equal(
          frames,
          reduced ? 0 : 1,
          "Changing color scheme does not restart the wave",
        );
      } else {
        assert.equal(
          preferenceChange,
          undefined,
          "Explicit and default themes stay fixed",
        );
      }
    }
  assert(
    readFileSync("2026/program/index.html", "utf8").includes(
      "background/index.html?v=7&amp;theme=auto",
    ),
    "The program follows the browser color scheme",
  );
  const colorScheme = {
    matches: false,
    addEventListener: (_, listener) => {
      colorScheme.change = listener;
    },
  };
  const programDocument = {
    documentElement: { dataset: {} },
    querySelectorAll: () => [],
    getElementById: () => null,
  };
  runInNewContext(readFileSync("2026/program/script.js", "utf8"), {
    document: programDocument,
    matchMedia: () => colorScheme,
    location: { hash: "" },
    window: { addEventListener() {} },
  });
  assert.equal(programDocument.documentElement.dataset.theme, "dark");
  colorScheme.matches = true;
  colorScheme.change();
  assert.equal(
    programDocument.documentElement.dataset.theme,
    "light",
    "Program colors follow browser preference changes",
  );
  colorScheme.matches = false;
  colorScheme.change();
  assert.equal(programDocument.documentElement.dataset.theme, "dark");
  console.log(
    "Site packaging checks passed: public files only, unchanged production, isolated read-only previews.",
  );
} finally {
  rmSync(directory, { recursive: true, force: true });
}
