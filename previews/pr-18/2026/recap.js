// Keep links from the original event page pointing to the archived program.
const legacySections = new Map([
  ["#program", "program/"],
  ["#day-1", "program/#day-1"],
  ["#day-2", "program/#day-2"],
  ["#side-events", "program/#side-events"],
]);
const legacyTarget = legacySections.get(location.hash);
if (legacyTarget) {
  const target = new URL(legacyTarget, location.href);
  target.search = location.search;
  location.replace(target.href);
} else if (location.hash === "#registration") {
  location.replace(`${location.pathname}${location.search}#overview`);
}

for (const card of document.querySelectorAll(".survey-pie")) {
  const buttons = [...card.querySelectorAll(".survey-legend button")];
  const paths = [...card.querySelectorAll(".survey-graphic path")];
  const status = card.querySelector(".survey-detail");
  const hint = status.textContent;
  let selected = null;
  function select(index) {
    selected = selected === index ? null : index;
    card.toggleAttribute("data-selected", selected !== null);
    buttons.forEach((button, i) => {
      button.setAttribute("aria-pressed", String(i === selected));
      paths[i].classList.toggle("is-selected", i === selected);
    });
    status.textContent =
      selected === null ? hint : buttons[selected].dataset.detail;
  }
  buttons.forEach((button, index) => {
    button.disabled = false;
    button.addEventListener("click", () => select(index));
    paths[index].addEventListener("click", () => select(index));
  });
  card.addEventListener("keydown", (event) => {
    if (event.key === "Escape") select(null);
  });
  card.dataset.interactive = "true";
  status.hidden = false;
}
const viewSwitch = document.querySelector(".survey-view-switch");
if (viewSwitch) {
  const inputs = [...viewSwitch.querySelectorAll("input")];
  const cards = document.querySelectorAll(".survey-pie");
  function updateView() {
    const view = inputs.find((input) => input.checked).value;
    cards.forEach((card) => {
      card.dataset.view = view;
    });
  }
  inputs.forEach((input) => input.addEventListener("change", updateView));
  updateView();
  viewSwitch.hidden = false;
}

function countHighlights() {
  const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const active = new Map();
  const finish = () => {
    for (const [element, run] of active) {
      cancelAnimationFrame(run.frame);
      element.textContent = run.final;
    }
    active.clear();
  };
  if (motion.matches || !("IntersectionObserver" in window)) return;
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const element = entry.target;
        observer.unobserve(element);
        const target = Number(element.dataset.count);
        const digits = Number(element.dataset.decimals);
        const suffix = element.dataset.suffix ?? "";
        const final = element.textContent ?? "";
        const formatter = new Intl.NumberFormat("en-US", {
          minimumFractionDigits: digits,
          maximumFractionDigits: digits,
        });
        const start = performance.now();
        const run = { frame: 0, final };
        active.set(element, run);
        const tick = (now) => {
          const progress = Math.min(1, (now - start) / 3500);
          if (progress === 1) {
            element.textContent = final;
            active.delete(element);
            return;
          }
          element.textContent =
            formatter.format(target * (1 - (1 - progress) ** 3)) + suffix;
          run.frame = requestAnimationFrame(tick);
        };
        tick(start);
      }
    },
    { threshold: 0.8 },
  );
  document.querySelectorAll("[data-count]").forEach((element) => {
    observer.observe(element);
  });
  motion.addEventListener("change", () => {
    if (!motion.matches) return;
    observer.disconnect();
    finish();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) finish();
  });
}
countHighlights();
