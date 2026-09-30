document.querySelectorAll('[data-video]').forEach((button) => {
  button.addEventListener('click', () => {
    const iframe = document.createElement('iframe');
    iframe.src = `https://www.youtube-nocookie.com/embed/${button.dataset.video}?autoplay=1`;
    iframe.title = button.getAttribute('aria-label');
    iframe.allow = 'autoplay; encrypted-media; picture-in-picture';
    iframe.allowFullscreen = true;
    iframe.referrerPolicy = 'strict-origin-when-cross-origin';
    button.replaceWith(iframe);
    iframe.focus();
  });
});

if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
  const observer = new IntersectionObserver((entries) => {
    for (const { target, isIntersecting } of entries) {
      if (isIntersecting) {
        target.classList.add('is-visible');
        observer.unobserve(target);
      }
    }
  });
  document.querySelectorAll('.section .content').forEach((section) => {
    section.classList.add('reveal');
    observer.observe(section);
  });
  document.querySelectorAll('.title-mark.animated').forEach((title) => observer.observe(title));
}
