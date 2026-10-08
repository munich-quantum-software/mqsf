import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { layoutEvents, minutes, clock, selectionRange, maxParallelSessions } from "../2026/meetups/calendar.mjs";

// Check deployed relative links, including GitHub Pages' repository prefix.
const root = new URL("../", import.meta.url);
function checkLinks(directory) {
  for (const entry of readdirSync(new URL(directory, root), { withFileTypes: true })) {
    const path = `${directory}${entry.name}`;
    if (entry.isDirectory()) {
      checkLinks(`${path}/`);
    } else if (/\.(html|css)$/.test(path)) {
      const source = readFileSync(new URL(path, root), "utf8");
      for (const match of source.matchAll(/(?:src|href)="([^"]+)"|url\(['"]?([^)'"\s]+)/g)) {
        const reference = match[1] || match[2];
        if (/^(?:https?:|data:|mailto:|#)/.test(reference)) continue;
        const url = new URL(reference, new URL(path, root));
        url.search = "";
        url.hash = "";
        assert(existsSync(url), `${path}: missing ${reference}`);
        if (statSync(url).isDirectory()) assert(existsSync(new URL("index.html", url)), `${path}: missing index for ${reference}`);
      }
    }
  }
}
for (const directory of ["2026/", "assets/", "background/", "logos/"]) checkLinks(directory);
const home = readFileSync(new URL("index.html", root), "utf8");
assert.match(home, /http-equiv="refresh" content="0; url=2026\/"/);
assert(existsSync(new URL("2026/index.html", root)));

const programStyles = readFileSync(new URL("2026/program/styles.css", root), "utf8");
const meetupStyles = readFileSync(new URL("2026/meetups/styles.css", root), "utf8");
const brandStyles = readFileSync(new URL("assets/brand.css", root), "utf8");
const eventStyles = readFileSync(new URL("2026/event.css", root), "utf8");
assert.match(eventStyles, /\.brand-panel, \.intro-panel \{[^}]*border: 1px solid var\(--line\);/, "Hero boxes use the shared panel border");
const logoStyles = readFileSync(new URL("logos/styles.css", root), "utf8");
const fontSizes = [...`${brandStyles}\n${eventStyles}\n${programStyles}\n${meetupStyles}\n${logoStyles}`.matchAll(/font-size:\s*([^;]+);/g)].map(match => match[1]);
assert.deepEqual([...new Set(fontSizes)].sort(), ["var(--font-body)", "var(--font-heading)", "var(--font-small)"], "All pages share only three font sizes");
for (const [name, size] of [["small", ".875rem"], ["body", "1rem"], ["heading", "1.75rem"]]) {
  assert(brandStyles.includes(`--font-${name}: ${size};`), `Define the shared ${name} type size`);
}
assert.match(brandStyles, /@media \(max-width: 700px\)\s*\{\s*:root\s*\{\s*--font-heading: var\(--font-body\);/, "Mobile uses only the two smaller sizes");
for (const path of ["2026/index.html", "2026/program/index.html", "logos/index.html"]) {
  const html = readFileSync(new URL(path, root), "utf8");
  assert.match(html, /<link rel="stylesheet" href="(?:\.\.\/)+assets\/brand\.css\?v=1">/, `${path} loads the shared identity`);
  for (const [, href] of html.matchAll(/<link\b[^>]*\bhref="([^"]+)"/g)) {
    assert.notEqual(new URL(href, new URL(path, root)).hostname, "fonts.googleapis.com", `${path} uses the local fonts`);
  }
}

const input = [
  { id: "long", start: "09:00", end: "12:00" },
  { id: "a", start: "09:30", end: "10:30" },
  { id: "b", start: "10:00", end: "11:00" },
  { id: "c", start: "10:30", end: "11:30" },
  { id: "after", start: "12:00", end: "12:01" },
];
const layout = layoutEvents(input);
assert.equal(layout.length, input.length);
assert.equal(layout.find(e => e.id === "after").columns, 1, "Touching events use separate groups");
assert.equal(layout.find(e => e.id === "a").column, layout.find(e => e.id === "c").column, "Reuse lanes when possible");
for (const a of layout) for (const b of layout) {
  if (a.id !== b.id && a.from < b.to && b.from < a.to) {
    assert.notEqual(a.column, b.column, "Overlapping events must never cover each other");
    assert.equal(a.columns, b.columns);
  }
}
assert.deepEqual(layoutEvents([...input].reverse()), layout, "Stable layout regardless of server order");
assert.equal(input[0].column, undefined, "Do not mutate event records");
assert.deepEqual(layoutEvents([]), []);
const dated = input.map(event => ({ ...event, date: "2026-10-14" }));
assert.equal(maxParallelSessions(dated, { date: "2026-10-14", start: "10:00", end: "11:00" }), 4);
assert.equal(maxParallelSessions(dated, dated[1]), 3, "Editing excludes the original record");
assert.equal(maxParallelSessions(dated, { date: "2026-10-15", start: "10:00", end: "11:00" }), 1);
assert.equal(maxParallelSessions(dated, { date: "2026-10-14", start: "11:30", end: "12:00" }), 2, "Ignore peaks outside the proposed interval");
const staggered = [9, 10, 11].map(hour => ({ id: String(hour), date: "2026-10-14", start: clock(hour * 60), end: clock((hour + 1) * 60) }));
assert.equal(maxParallelSessions(staggered, { date: "2026-10-14", start: "09:00", end: "12:00" }), 2, "Three staggered intersections only need two simultaneous places");
assert.equal(clock(minutes("23:59")), "23:59");
assert.equal(clock(1440), "24:00");
for (const [anchor, cursor, min, max, start, end] of [
  [780, 900, 480, 1200, "13:00", "15:00"],
  [900, 780, 480, 1200, "13:00", "15:00"],
  [783, 893, 480, 1200, "13:00", "15:00"],
  [780, 780, 480, 1200, "13:00", "13:15"],
  [780, 0, 480, 1200, "08:00", "13:00"],
  [1200, 1500, 480, 1200, "19:45", "20:00"],
  [1439, 1440, 480, 1439, "23:44", "23:59"],
]) assert.deepEqual(selectionRange(anchor, cursor, min, max), { start, end });
console.log("Calendar checks passed: overlap layout, drag direction, snapping, minimum duration, and day boundaries.");
