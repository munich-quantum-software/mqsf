function renderTextHighlights() {
  const svgNS = 'http://www.w3.org/2000/svg';
  document.querySelectorAll('.TextShape-node').forEach((node) => node.remove());

  document.querySelectorAll('script.TextAttributes-props').forEach((data) => {
    const content = data.closest('.sqs-block-content');
    const origin = content.getBoundingClientRect();
    if (getComputedStyle(content).position === 'static') content.style.position = 'relative';

    for (const spec of JSON.parse(data.textContent)) {
      if (spec.type !== 'highlight') continue;
      const span = content.querySelector(`span[data-text-attribute-id="${spec.id}"]`);
      if (!span) continue;
      const fontSize = parseFloat(getComputedStyle(span).fontSize);

      const lines = [];
      for (const rect of span.getClientRects()) {
        if (!rect.width || !rect.height) continue;
        const line = lines.find((candidate) => Math.abs(candidate.top - rect.top) < 1);
        if (line) {
          line.left = Math.min(line.left, rect.left);
          line.right = Math.max(line.right, rect.right);
          line.width = line.right - line.left;
        } else {
          lines.push({ left: rect.left, right: rect.right, top: rect.top, width: rect.width, height: rect.height });
        }
      }
      for (const rect of lines) {
        const circle = spec.shape === 'circle';
        const width = Math.ceil(rect.width + (circle ? -0.15 : 0.15) * fontSize);
        const height = Math.ceil(rect.height);
        const node = document.createElement('span');
        node.className = 'TextShape-node';
        node.dataset.textAttributeId = spec.id;
        node.dataset.shape = spec.shape;
        node.dataset.fontSize = Math.floor(fontSize);
        node.dataset.isFront = spec.isFront;
        Object.assign(node.style, {
          fontSize: `${Math.floor(fontSize)}px`,
          width: `${width}px`,
          height: `${height}px`,
          left: `${Math.ceil(rect.left - origin.left - 0.1 * fontSize)}px`,
          top: `${Math.ceil(rect.top - origin.top)}px`,
          opacity: '1',
          transform: 'scale(1)',
        });
        const palette = spec.color.sitePaletteColor;
        node.style.setProperty('--stroke', palette
          ? `hsla(var(--${palette.colorName}-hsl), ${palette.alphaModifier})`
          : 'var(--text-highlight-color)');
        node.style.setProperty('--stroke-width', `${spec.thickness.value}${spec.thickness.unit}`);
        node.style.setProperty('--stroke-linecap', spec.linecap);
        node.style.setProperty('--stroke-linejoin', circle ? 'bevel' : 'round');
        node.style.setProperty('--blend', 'none');

        const svg = document.createElementNS(svgNS, 'svg');
        svg.setAttribute('aria-hidden', 'true');
        const path = document.createElementNS(svgNS, 'path');
        if (circle) {
          svg.setAttribute('viewBox', '0 0 398 48');
          svg.setAttribute('preserveAspectRatio', 'none');
          path.setAttribute('vector-effect', 'non-scaling-stroke');
          path.setAttribute('d', 'M136.3,50.1 C221.572,52.652 408,49.52 408,25.16 C408,4.57 285.108,0 197.328,0 S-5.82,4.57 -5.82,24.464 S90.738,55.262 299.32,52.652');
        } else {
          path.setAttribute('d', `M0,${0.99 * height} c${0.125 * width},${-0.0275 * height} ${0.25 * width},${-0.085 * height} ${0.5 * width},${-0.11 * height} c${0.25 * width},${-0.025 * height} ${0.38 * width},0 ${0.5 * width},${0.01 * height} c${0.024 * width},${0.002 * height} ${-0.019 * width},${0.0285 * height} ${-0.02 * width},${0.03 * height}`);
        }
        svg.append(path);
        node.append(svg);
        content.append(node);
      }
    }
  });
}

document.fonts.ready.then(() => {
  renderTextHighlights();
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const reveals = document.querySelectorAll('.sqs-html-content h2, .sqs-html-content h3, .sqs-html-content h4, .sqs-html-content p, .sqs-background-enabled, .fluid-image-animation-wrapper, .sqs-video-wrapper');
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(({ target, isIntersecting }) => target.classList.toggle('flexIn', isIntersecting));
  });
  reveals.forEach((element) => {
    element.classList.add('preFlex');
    element.style.transitionTimingFunction = 'cubic-bezier(0.19, 1, 0.22, 1)';
    element.style.transitionDuration = '0.8s';
    observer.observe(element);
  });
});
window.addEventListener('resize', renderTextHighlights);

document.querySelectorAll('.sqs-video-wrapper').forEach((wrapper) => {
  const play = wrapper.querySelector('.sqs-video-icon');
  play.setAttribute('role', 'button');
  play.setAttribute('tabindex', '0');
  play.setAttribute('aria-label', 'Play');
  const start = () => {
    const template = document.createElement('template');
    template.innerHTML = wrapper.dataset.html;
    const iframe = template.content.querySelector('iframe');
    const url = new URL(iframe.src);
    url.searchParams.set('autoplay', '1');
    iframe.src = url.href;
    wrapper.replaceChildren(iframe);
  };
  play.addEventListener('click', start);
  play.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      start();
    }
  });
});
