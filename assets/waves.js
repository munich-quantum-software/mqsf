(() => {
  const light = new URLSearchParams(location.search).get('theme') === 'light';
  document.documentElement.dataset.theme = light ? 'light' : 'dark';
  const backgroundColors = light ? ['#ffffff', '#f3f5f8', '#eaf0f6'] : ['#171f39', '#17213c', '#18233c'];
  const networkColor = light ? '#bfd6e4' : '#1d3951';
  document.querySelectorAll('.wave-canvas').forEach((canvas) => {
    const context = canvas.getContext('2d');
    if (!context) return;
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
    let time = 0;
    let previous = 0;
    let frame;
    let width;
    let height;
    let side;

    // Image-guided rest positions; depth gives each point a genuine world position.
    const rows = [
      [[-.10,.14],[.00,.15],[.10,.16],[.21,.17],[.32,.16],[.42,.13],[.51,.12],[.61,.14],[.70,.16],[.80,.17],[.90,.16],[1,.14],[1.10,.13]],
      [[-.10,.19],[.02,.21],[.12,.22],[.23,.23],[.34,.22],[.44,.20],[.55,.20],[.65,.21],[.75,.22],[.86,.23],[.96,.23],[1.06,.21],[1.16,.20]],
      [[-.12,.25],[-.02,.27],[.08,.28],[.18,.29],[.28,.30],[.39,.30],[.48,.23],[.55,.214],[.62,.210],[.69,.225],[.78,.207],[.86,.213],[1.04,.29]],
      [[-.13,.34],[-.02,.33],[.045,.305],[.15,.299],[.267,.316],[.401,.337],[.441,.283],[.526,.275],[.609,.270],[.686,.276],[.754,.296],[.837,.300],[1.02,.31]],
      [[-.13,.46],[-.06,.43],[.015,.381],[.104,.364],[.195,.346],[.295,.361],[.403,.414],[.515,.404],[.630,.430],[.737,.418],[.795,.414],[.866,.413],[1.03,.36]],
      [[-.18,.53],[-.05,.46],[.085,.421],[.190,.392],[.310,.396],[.388,.447],[.485,.447],[.575,.451],[.677,.468],[.789,.450],[.872,.447],[.953,.453],[1.09,.45]],
      [[-.22,.68],[-.08,.57],[.049,.518],[.178,.480],[.299,.455],[.414,.501],[.515,.499],[.637,.524],[.779,.548],[.890,.498],[.979,.507],[1.12,.51],[1.26,.53]],
      [[-.32,.80],[-.16,.73],[.003,.627],[.137,.602],[.254,.559],[.346,.532],[.465,.579],[.583,.668],[.772,.640],[.909,.571],[1.065,.603],[1.23,.64],[1.40,.69]],
      [[-.42,.94],[-.24,.87],[-.07,.80],[.075,.726],[.176,.680],[.300,.638],[.364,.711],[.546,.797],[.761,.730],[.970,.662],[1.15,.74],[1.35,.78],[1.52,.84]],
      [[-.50,1.14],[-.29,1.06],[-.08,.94],[.065,.947],[.204,.765],[.241,.817],[.493,.879],[.688,.812],[.914,.751],[1.08,.865],[1.32,.92],[1.53,1.02],[1.74,1.12]],
      [[-.62,1.39],[-.37,1.30],[-.10,1.21],[.11,1.15],[.31,1.04],[.48,1.01],[.68,.983],[.887,.949],[1.14,1.07],[1.38,1.19],[1.62,1.24],[1.90,1.31],[2.10,1.42]],
    ];
    const depths = [18, 15, 12, 10, 8.5, 7, 5.8, 4.8, 3.8, 3, 2.4];
    const blur = [9, 11, 10, 6, 2.5, .65, .7, 2.2, 5.5, 10, 14];
    // Keep the scattered layout identical across previews and embedded pages.
    let seed = 20261015;
    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    const nodes = rows.flatMap((row, r) => row.map(([x, y]) => {
      x += (random() - .5) * .09;
      y += (random() - .5) * .06;
      const z = depths[r];
      const scale = 1.9 / z;
      return {
        x: (x - .5) / scale, y: .95 - (y - .11) / scale, z,
        radius: (r < 4 ? 6.5 : 1.2 + 19 / z) * 1.3,
        blur: blur[r] + Math.max(0, Math.abs(x - .5) - .35) * 10,
      };
    }));
    const edges = [];
    const columns = rows[0].length;
    for (let r = 0; r < rows.length; r++) {
      for (let c = 0; c < columns; c++) {
        const i = r * columns + c;
        if (c + 1 < columns) edges.push([i, i + 1]);
        if (r + 1 < rows.length) {
          edges.push([i, i + columns]);
          if (c + 1 < columns) {
            edges.push((r + c) % 3 === 0 ? [i + 1, i + columns] : [i, i + columns + 1]);
          }
        }
      }
    }

    const blurLevels = [1.2, 1.8, 2.6, 4.5, 7, 10, 14, 19];
    const layers = blurLevels.map(() => {
      const layer = document.createElement('canvas');
      layer.setAttribute('aria-hidden', 'true');
      layer.hidden = true;
      return { canvas: layer, paint: layer.getContext('2d') };
    });
    if (layers.some(layer => !layer.paint)) return;
    layers.forEach(layer => canvas.parentElement.append(layer.canvas));
    const buckets = blurLevels.map(() => []);
    const bucket = value => blurLevels.reduce((best, level, i) =>
      Math.abs(level - value) < Math.abs(blurLevels[best] - value) ? i : best, 0);
    edges.forEach(([a, b]) => {
      for (let step = 0; step < 6; step++) {
        const start = step / 6;
        const end = (step + 1) / 6;
        const blend = (start + end) / 2;
        buckets[bucket(nodes[a].blur * (1 - blend) + nodes[b].blur * blend)].push({ a, b, start, end });
      }
    });
    nodes.forEach((node, index) => buckets[bucket(node.blur)].push({ index }));

    function draw() {
      const useStaticImage = reducedMotion.matches && !light;
      canvas.hidden = useStaticImage;
      layers.forEach(layer => { layer.canvas.hidden = useStaticImage; });
      if (useStaticImage) return;
      const unit = side / 1000;
      const offsetX = (width - side) / 2;
      const offsetY = (height - side) / 2;
      const points = nodes.map(node => {
        // Both harmonics travel together, carrying one continuous crest across the grid.
        const phase = node.x * 1.45 + node.z * .38 - time * .92;
        const wave = .105 * Math.sin(phase) + .017 * Math.sin(phase * 2);
        const scale = 1.9 / node.z;
        return {
          x: offsetX + (.5 + node.x * scale) * side,
          y: offsetY + (.11 + (.95 - node.y - wave) * scale) * side,
        };
      });
      const background = context.createLinearGradient(0, 0, 0, height);
      background.addColorStop(0, backgroundColors[0]);
      background.addColorStop(.55, backgroundColors[1]);
      background.addColorStop(1, backgroundColors[2]);
      context.fillStyle = background;
      context.fillRect(0, 0, width, height);
      buckets.forEach((items, i) => {
        const { paint } = layers[i];
        paint.clearRect(0, 0, width, height);
        // Opaque, pre-blended color keeps overlapping lines and nodes the same color.
        paint.fillStyle = paint.strokeStyle = networkColor;
        paint.lineCap = 'round';
        items.forEach(item => {
          if (item.index !== undefined) {
            const node = nodes[item.index];
            const point = points[item.index];
            paint.beginPath();
            paint.arc(point.x, point.y, node.radius * unit, 0, Math.PI * 2);
            paint.fill();
          } else {
            const a = points[item.a];
            const b = points[item.b];
            const nodeA = nodes[item.a];
            const nodeB = nodes[item.b];
            paint.lineWidth = (1.2 + 14 / ((nodeA.z + nodeB.z) / 2)) * unit * 1.3;
            paint.beginPath();
            paint.moveTo(a.x + (b.x - a.x) * item.start, a.y + (b.y - a.y) * item.start);
            paint.lineTo(a.x + (b.x - a.x) * item.end, a.y + (b.y - a.y) * item.end);
            paint.stroke();
          }
        });
      });
    }

    function resize() {
      const rect = canvas.parentElement.getBoundingClientRect();
      const ratio = Math.min(devicePixelRatio, 1.5);
      width = canvas.width = Math.round(rect.width * ratio);
      height = canvas.height = Math.round(rect.height * ratio);
      side = Math.max(width, height);
      layers.forEach((layer, i) => {
        layer.canvas.width = width;
        layer.canvas.height = height;
        layer.canvas.style.filter = `blur(${blurLevels[i] * side / ratio / 1000}px)`;
      });
      draw();
    }
    function animate(now) {
      time += previous ? Math.min(now - previous, 50) / 1000 * .56 : 0;
      previous = now;
      draw();
      frame = requestAnimationFrame(animate);
    }
    function updateMotion() {
      cancelAnimationFrame(frame);
      previous = 0;
      draw();
      if (!reducedMotion.matches && !document.hidden) frame = requestAnimationFrame(animate);
    }
    reducedMotion.addEventListener('change', updateMotion);
    document.addEventListener('visibilitychange', updateMotion);
    window.addEventListener('resize', resize, { passive: true });
    resize();
    updateMotion();
  });
})();
