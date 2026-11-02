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
        const final = element.textContent;
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
          element.textContent = (target * (1 - (1 - progress) ** 3)).toFixed(0);
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
