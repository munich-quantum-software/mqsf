export function minutes(time) {
  const [hours, minute] = time.split(":").map(Number);
  return hours * 60 + minute;
}

export function clock(value) {
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}

// Snap in either direction, keeping even a click inside the day's available hours.
export function selectionRange(anchor, cursor, min, max) {
  const snap = (value) =>
    Math.max(min, Math.min(max, Math.round(value / 15) * 15));
  const start = Math.min(snap(anchor), snap(cursor), max - 15);
  return {
    start: clock(start),
    end: clock(Math.max(start + 15, snap(anchor), snap(cursor))),
  };
}

export function maxParallelSessions(events, candidate) {
  // Clip to the candidate's interval: peaks outside it must not count.
  const overlaps = events
    .filter(
      (event) =>
        event.id !== candidate.id &&
        event.date === candidate.date &&
        event.start < candidate.end &&
        event.end > candidate.start,
    )
    .map((event) => ({
      ...event,
      start: event.start < candidate.start ? candidate.start : event.start,
      end: event.end > candidate.end ? candidate.end : event.end,
    }));
  return (
    1 +
    layoutEvents(overlaps).reduce(
      (peak, event) => Math.max(peak, event.columns),
      0,
    )
  );
}

// Interval partitioning: overlapping events get separate lanes; touching events do not overlap.
export function layoutEvents(events) {
  const sorted = events
    .map((event) => ({
      ...event,
      from: minutes(event.start),
      to: minutes(event.end),
    }))
    .sort((a, b) => a.from - b.from || b.to - a.to || a.id.localeCompare(b.id));
  const result = [];
  let group = [],
    ends = [],
    groupEnd = -1;
  function finishGroup() {
    result.push(...group.map((event) => ({ ...event, columns: ends.length })));
    group = [];
    ends = [];
    groupEnd = -1;
  }
  for (const event of sorted) {
    if (event.from >= groupEnd) finishGroup();
    let column = ends.findIndex((end) => end <= event.from);
    if (column < 0) column = ends.length;
    ends[column] = event.to;
    group.push({ ...event, column });
    groupEnd = Math.max(groupEnd, event.to);
  }
  finishGroup();
  return result;
}
