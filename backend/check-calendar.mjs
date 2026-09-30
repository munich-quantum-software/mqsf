import assert from "node:assert/strict";
import { layoutEvents, minutes, clock, selectionRange, maxParallelSessions } from "../side-events/calendar.mjs";

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
