document.querySelectorAll("[data-video]").forEach((button) => {
  button.addEventListener("click", () => {
    const iframe = document.createElement("iframe");
    iframe.src = `https://www.youtube-nocookie.com/embed/${button.dataset.video}?autoplay=1`;
    iframe.title = button.getAttribute("aria-label");
    iframe.allow = "autoplay; encrypted-media; picture-in-picture";
    iframe.allowFullscreen = true;
    iframe.referrerPolicy = "strict-origin-when-cross-origin";
    button.replaceWith(iframe);
    iframe.focus();
  });
});

if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
  const observer = new IntersectionObserver((entries) => {
    for (const { target, isIntersecting } of entries) {
      if (isIntersecting) {
        target.classList.add("is-visible");
        observer.unobserve(target);
      }
    }
  });
  document
    .querySelectorAll(
      ".hero-content img, .hero-content nav, .intro-panel h1, .intro-panel p, .section .content h2, .section .content h3, .section .content p, .section .content li, .section .content img, .section .content .video-preview, .section .content .logo-row a, .site-footer > *",
    )
    .forEach((element) => {
      if (element.tagName === "P" && element.closest("li")) return;
      if (
        element.tagName === "IMG" &&
        element.closest(".video-preview, .logo-row")
      )
        return;
      element.classList.add("reveal");
      observer.observe(element);
    });
  document
    .querySelectorAll(".title-mark.animated")
    .forEach((title) => observer.observe(title));
}
