import { minutes, clock, layoutEvents, selectionRange, maxParallelSessions } from "./calendar.mjs?v=2";

const $ = id => document.getElementById(id);
const fields = ["title", "organizers", "contact_email", "date", "start", "end", "description", "audience"];
const form = $("event-form"), editor = $("editor-dialog"), details = $("details-dialog");
const apiBase = (window.MQSF_API_BASE || new URL("./api", import.meta.url).href).replace(/\/$/, "");
const scale = 1.3;
let config, events = [], loaded = false, saving = false, editing = null, viewingId = null;
let selectedDay = "2026-10-14", initialDraft = "", readSerial = 0, signature = "", toastTimer;
let selection = null;

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

async function api(path = "", options = {}) {
  const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(`${apiBase}/meetups${path}`, {
      ...options, credentials: "omit", cache: "no-store", signal: controller.signal,
      headers: options.body ? { "Content-Type": "application/json" } : {},
    });
    const data = await response.json();
    if (!response.ok) {
      const error = new Error(data.error || "The calendar is unavailable. Please try again.");
      error.status = response.status;
      throw error;
    }
    return data;
  } catch (error) {
    if (error.status) throw error;
    throw new Error("The shared calendar could not be reached. Please check your connection and try again.");
  } finally { clearTimeout(timeout); }
}

function chooseDay(date) {
  selectedDay = date;
  $("calendar").querySelectorAll(".day-heading, .day-column").forEach(node => node.classList.toggle("active-day", node.dataset.day === date));
  document.querySelectorAll(".mobile-days button").forEach(button => button.setAttribute("aria-pressed", String(button.dataset.day === date)));
}

function tone(id) { return [...id].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 5; }

function renderCalendar() {
  if (!config) return;
  const focusedEvent = document.activeElement?.dataset.eventId;
  const earliest = Math.min(minutes(config.viewStart), ...events.map(e => minutes(e.start)));
  const latest = Math.max(minutes(config.viewEnd), ...events.map(e => minutes(e.end)));
  const from = Math.floor(earliest / 60) * 60, to = Math.min(1440, Math.ceil(latest / 60) * 60);
  $("calendar-grid").style.setProperty("--grid-height", `${(to - from) * scale}px`);
  $("time-axis").replaceChildren();
  for (let time = from; time <= to; time += 60) {
    const label = element("span", "time-label", clock(time));
    label.style.setProperty("--top", `${(time - from) * scale}px`);
    $("time-axis").append(label);
  }
  for (const day of config.days) {
    const container = $(`day-${day.date}`), dayEvents = events.filter(e => e.date === day.date);
    container.dataset.from = from;
    container.dataset.to = to;
    container.replaceChildren();
    $(`count-${day.date}`).textContent = `${dayEvents.length} ${dayEvents.length === 1 ? "event" : "events"}`;
    for (const [start, end] of [[from, day.start ? minutes(day.start) : from], [day.end ? minutes(day.end) : to, to]]) {
      if (start >= end) continue;
      const shade = element("div", "unavailable");
      shade.style.setProperty("--top", `${(start - from) * scale}px`);
      shade.style.setProperty("--height", `${(end - start) * scale}px`);
      container.append(shade);
    }
    for (const event of layoutEvents(dayEvents)) {
      const duration = event.to - event.from;
      const button = element("button", `event tone-${tone(event.id)}${duration < 30 ? " short" : ""}${duration < 10 ? " tiny" : ""}`);
      button.type = "button";
      button.dataset.eventId = event.id;
      button.style.setProperty("--top", `${(event.from - from) * scale}px`);
      button.style.setProperty("--height", `${Math.max(3, duration * scale - 3)}px`);
      button.style.setProperty("--column", event.column);
      button.style.setProperty("--columns", event.columns);
      button.setAttribute("aria-label", `${event.start} to ${event.end}: ${event.title}. View or edit event.`);
      button.title = `${event.start}–${event.end} · ${event.title}`;
      button.append(element("span", "event-time", `${event.start}–${event.end}`), element("span", "event-title", event.title));
      if (duration >= 70) button.append(element("span", "event-audience", event.audience));
      button.addEventListener("click", () => openDetails(event.id));
      container.append(button);
    }
    if (!dayEvents.length && loaded) {
      const empty = element("div", "empty-day");
      const add = element("button", "button button-secondary", "+ Add the first event");
      add.addEventListener("click", () => openEditor(null, day.date));
      empty.append(element("p", "", "Room for your next idea."), add);
      container.append(empty);
    }
  }
  $("event-count").textContent = loaded ? `${events.length} ${events.length === 1 ? "event" : "events"}` : "";
  $("calendar-grid").setAttribute("aria-busy", "false");
  chooseDay(selectedDay);
  if (focusedEvent) document.querySelector(`[data-event-id="${focusedEvent}"]`)?.focus({ preventScroll: true });
}

async function refresh() {
  const serial = ++readSerial;
  try {
    const data = await api();
    if (serial !== readSerial || selection) return false;
    if (!Array.isArray(data.events)) throw new Error("The server did not return a calendar.");
    const nextSignature = JSON.stringify(data.events);
    events = data.events; loaded = true;
    $("demo-note").hidden = !data.demo;
    $("connection-error").hidden = true;
    $("sync-status").textContent = "Up to date";
    if (signature !== nextSignature) { signature = nextSignature; renderCalendar(); }
    if (editor.open) updateTimeHints();
    if (details.open) showDetails(events.find(e => e.id === viewingId));
    return true;
  } catch (error) {
    if (serial !== readSerial) return false;
    $("connection-message").textContent = loaded ? "Updates are temporarily unavailable. Showing the last loaded events." : error.message;
    $("connection-error").hidden = false;
    $("sync-status").textContent = "Connection unavailable";
    $("calendar-grid").setAttribute("aria-busy", "false");
    return false;
  }
}

function dateLabel(date) {
  return new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(date + "T12:00:00Z"));
}

function showDetails(event) {
  if (!event) { details.close(); toast("This event has been removed."); return; }
  $("details-title").textContent = event.title;
  $("details-time").textContent = `${dateLabel(event.date)} · ${event.start}–${event.end} CEST`;
  $("details-organizers").textContent = event.organizers || "Not specified yet";
  $("details-table").textContent = event.table_number ? `Table ${event.table_number}` : "To be assigned by the MQSF organizers";
  $("details-description").textContent = event.description;
  $("details-audience").textContent = event.audience;
  const updated = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: config.timezone }).format(new Date(event.updated_at));
  $("details-updated").textContent = `Last updated ${updated} · Munich time`;
}

function openDetails(id) {
  const event = events.find(e => e.id === id);
  if (!event) return;
  viewingId = id;
  showDetails(event); details.showModal();
}

function draft() { return Object.fromEntries(fields.map(key => [key, form.elements.namedItem(key).value])); }
function dirty() { return JSON.stringify(draft()) !== initialDraft; }

function openEditor(event = null, date = selectedDay, range = {}) {
  details.close();
  editing = event ? { ...event } : null;
  form.reset();
  ["form-error", "load-latest", "discard-confirm", "delete-confirm"].forEach(id => $(id).hidden = true);
  const day = config.days.find(d => d.date === (event?.date || date));
  const start = day.start || "10:00";
  const defaults = { date, start, end: clock(Math.min(minutes(start) + 60, day.end ? minutes(day.end) : 1439)), title: "", organizers: "", description: "", audience: "", ...range };
  for (const key of fields) form.elements.namedItem(key).value = (event || defaults)[key] || "";
  $("event-contact-email").value = "";
  $("event-contact-email").required = !event;
  $("contact-edit-hint").hidden = !event;
  $("editor-title").textContent = event ? "Edit event" : "Add an event";
  $("save-event").textContent = event ? "Save changes" : "Add event";
  $("delete-event").hidden = !event;
  updateTimeHints();
  initialDraft = JSON.stringify(draft());
  if (!editor.open) editor.showModal();
  $("event-title").focus();
}

function updateTimeHints() {
  const data = draft(), day = config.days.find(d => d.date === data.date);
  $("event-start").min = $("event-end").min = day.start || "00:00";
  $("event-start").max = $("event-end").max = day.end || "23:59";
  $("time-hint").textContent = `Munich time · CEST (UTC+2)${day.start && day.end ? ` · Available ${day.start}–${day.end}` : day.start ? ` · From ${day.start}, open end` : ""}`;
  $("event-end").setCustomValidity(data.start && data.end && data.end <= data.start ? "End time must be after start time on the same day." : "");
  const peak = maxParallelSessions(events, { ...data, id: editing?.id });
  $("overlap-note").hidden = !data.start || !data.end || data.end <= data.start;
  $("overlap-note").textContent = peak > 3
    ? "This time would exceed the limit of 3 simultaneous sessions. Choose another time."
    : `Up to ${peak} ${peak === 1 ? "session" : "sessions"} would run at once, including yours. Maximum: 3.`;
}

function requestClose() {
  if (saving) return;
  if (dirty()) { $("discard-confirm").hidden = false; $("keep-editing").focus(); }
  else editor.close();
}

function setSaving(value) {
  saving = value;
  $("event-fields").disabled = value;
  editor.querySelectorAll("button").forEach(button => button.disabled = value);
  $("save-event").textContent = value ? "Saving…" : editing ? "Save changes" : "Add event";
}

function showError(error) {
  $("form-error").textContent = error.message;
  $("form-error").hidden = false;
  $("load-latest").hidden = error.status !== 409;
  $("form-error").scrollIntoView({ block: "nearest" });
}

function toast(message) {
  clearTimeout(toastTimer);
  $("toast").textContent = message; $("toast").hidden = false;
  toastTimer = setTimeout(() => $("toast").hidden = true, 5000);
}

function updateSelection(clientY) {
  const { column, anchor, min, max, preview } = selection;
  const from = Number(column.dataset.from);
  const cursor = from + (clientY - column.getBoundingClientRect().top) / scale;
  selection.range = selectionRange(anchor, cursor, min, max);
  const { start, end } = selection.range;
  preview.style.top = `${(minutes(start) - from) * scale}px`;
  preview.style.height = `${(minutes(end) - minutes(start)) * scale}px`;
  preview.textContent = `${start}–${end}`;
}

function cancelSelection() {
  if (!selection) return;
  const { column, pointerId, preview } = selection;
  selection = null;
  preview.remove();
  document.body.classList.remove("selecting-time");
  if (column.hasPointerCapture(pointerId)) column.releasePointerCapture(pointerId);
}

document.querySelectorAll(".day-column").forEach(column => {
  column.addEventListener("pointerdown", event => {
    // Touch gestures remain native page scrolling; the Add button works on all devices.
    if (event.pointerType !== "mouse" || event.button !== 0 || !config || selection || event.target.closest("button")) return;
    const day = config.days.find(day => day.date === column.dataset.day);
    const min = Math.max(Number(column.dataset.from), minutes(day.start || "00:00"));
    const max = Math.min(Number(column.dataset.to), minutes(day.end || "23:59"));
    const anchor = Number(column.dataset.from) + (event.clientY - column.getBoundingClientRect().top) / scale;
    if (max - min < 15 || anchor < min || anchor > max) return;
    event.preventDefault();
    const preview = element("div", "time-selection");
    preview.setAttribute("aria-hidden", "true");
    selection = { column, pointerId: event.pointerId, anchor, min, max, preview };
    column.append(preview);
    column.setPointerCapture(event.pointerId);
    document.body.classList.add("selecting-time");
    updateSelection(event.clientY);
  });
  column.addEventListener("pointermove", event => {
    if (selection?.pointerId === event.pointerId && selection.column === column) updateSelection(event.clientY);
  });
  column.addEventListener("pointerup", event => {
    if (selection?.pointerId !== event.pointerId || selection.column !== column) return;
    updateSelection(event.clientY);
    const { range } = selection;
    cancelSelection();
    openEditor(null, column.dataset.day, range);
  });
  for (const type of ["pointercancel", "lostpointercapture"]) column.addEventListener(type, cancelSelection);
});
document.addEventListener("keydown", event => { if (event.key === "Escape") cancelSelection(); });
window.addEventListener("blur", cancelSelection);

form.addEventListener("submit", async event => {
  event.preventDefault();
  updateTimeHints();
  if (saving || !form.reportValidity()) return;
  $("form-error").hidden = true; setSaving(true);
  const wasEditing = Boolean(editing);
  try {
    const data = await api(editing ? `/${editing.id}` : "", {
      method: editing ? "PUT" : "POST", body: JSON.stringify({ ...draft(), ...(editing ? { version: editing.version } : {}) }),
    });
    ++readSerial;
    events = [...events.filter(e => e.id !== data.event.id), data.event];
    loaded = true; signature = "";
    editor.close(); renderCalendar(); chooseDay(data.event.date);
    toast(wasEditing ? "Changes saved to the calendar." : "Event added to the calendar.");
    refresh();
  } catch (error) { showError(error); }
  finally { setSaving(false); }
});

$("confirm-delete").addEventListener("click", async () => {
  if (!editing || saving) return;
  setSaving(true);
  try {
    await api(`/${editing.id}`, { method: "DELETE", body: JSON.stringify({ version: editing.version }) });
    ++readSerial;
    events = events.filter(e => e.id !== editing.id); signature = "";
    editor.close(); renderCalendar(); toast("Event deleted from the calendar."); refresh();
  } catch (error) { $("delete-confirm").hidden = true; showError(error); }
  finally { setSaving(false); }
});

$("add-event").addEventListener("click", () => openEditor());
$("edit-event").addEventListener("click", () => {
  const event = events.find(e => e.id === viewingId);
  if (event) openEditor(event);
});
for (const id of ["close-details", "details-done"]) $(id).addEventListener("click", () => details.close());
details.addEventListener("close", () => { if (!editor.open) (document.querySelector(`[data-event-id="${viewingId}"]`) || $("add-event")).focus({ preventScroll: true }); });
editor.addEventListener("close", () => (document.querySelector(`[data-event-id="${editing?.id}"]`) || $("add-event")).focus({ preventScroll: true }));
details.addEventListener("click", event => { if (event.target === details) { const rect = details.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) details.close(); } });
for (const id of ["close-editor", "cancel-editor"]) $(id).addEventListener("click", requestClose);
editor.addEventListener("cancel", event => { event.preventDefault(); requestClose(); });
$("keep-editing").addEventListener("click", () => { $("discard-confirm").hidden = true; $("event-title").focus(); });
$("discard-draft").addEventListener("click", () => editor.close());
$("delete-event").addEventListener("click", () => { $("delete-confirm").hidden = false; $("keep-event").focus(); });
$("keep-event").addEventListener("click", () => { $("delete-confirm").hidden = true; $("delete-event").focus(); });
$("load-latest").addEventListener("click", async () => {
  if (!await refresh()) return;
  const latest = events.find(e => e.id === editing?.id);
  if (latest) openEditor(latest);
  else showError(new Error("This event has been removed. Your unsaved draft is still shown."));
});
for (const id of ["event-date", "event-start", "event-end"]) $(id).addEventListener("input", updateTimeHints);
document.querySelectorAll(".mobile-days button").forEach(button => button.addEventListener("click", () => chooseDay(button.dataset.day)));
$("retry").addEventListener("click", () => config ? refresh() : initialize());
window.addEventListener("beforeunload", event => { if (editor.open && dirty()) { event.preventDefault(); event.returnValue = ""; } });
function refreshIfVisible() { if (!document.hidden && config) refresh(); }
document.addEventListener("visibilitychange", refreshIfVisible);
setInterval(refreshIfVisible, 15000);

async function initialize() {
  try {
    const response = await fetch(new URL("./conference.json", import.meta.url), { cache: "no-store" });
    if (!response.ok) throw new Error("Could not load the conference dates. Please try again.");
    config = await response.json();
    $("hours-note").textContent = config.hoursNote || "Side events run alongside the main program.";
    $("add-event").disabled = false;
    renderCalendar(); await refresh();
  } catch (error) {
    $("connection-message").textContent = error.message; $("connection-error").hidden = false;
    $("sync-status").textContent = "Calendar unavailable";
  }
}

chooseDay(selectedDay);
initialize();
