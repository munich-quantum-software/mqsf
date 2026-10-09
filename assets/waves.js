(() => {
  const theme = new URLSearchParams(location.search).get("theme");
  const colorScheme = matchMedia("(prefers-color-scheme: light)");
  let light = theme === "light" || (theme === "auto" && colorScheme.matches);
  document.documentElement.dataset.theme = light ? "light" : "dark";
  document.querySelectorAll(".wave-canvas").forEach((canvas) => {
    const context = canvas.getContext("2d");
    if (!context) return;
    const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
    let time = 0;
    let previous = 0;
    let frame;
    let width;
    let height;
    let side;

    // Image-guided rest positions; depth gives each point a genuine world position.
    const rows = [
      [
        [-0.1, 0.14],
        [0.0, 0.15],
        [0.1, 0.16],
        [0.21, 0.17],
        [0.32, 0.16],
        [0.42, 0.13],
        [0.51, 0.12],
        [0.61, 0.14],
        [0.7, 0.16],
        [0.8, 0.17],
        [0.9, 0.16],
        [1, 0.14],
        [1.1, 0.13],
      ],
      [
        [-0.1, 0.19],
        [0.02, 0.21],
        [0.12, 0.22],
        [0.23, 0.23],
        [0.34, 0.22],
        [0.44, 0.2],
        [0.55, 0.2],
        [0.65, 0.21],
        [0.75, 0.22],
        [0.86, 0.23],
        [0.96, 0.23],
        [1.06, 0.21],
        [1.16, 0.2],
      ],
      [
        [-0.12, 0.25],
        [-0.02, 0.27],
        [0.08, 0.28],
        [0.18, 0.29],
        [0.28, 0.3],
        [0.39, 0.3],
        [0.48, 0.23],
        [0.55, 0.214],
        [0.62, 0.21],
        [0.69, 0.225],
        [0.78, 0.207],
        [0.86, 0.213],
        [1.04, 0.29],
      ],
      [
        [-0.13, 0.34],
        [-0.02, 0.33],
        [0.045, 0.305],
        [0.15, 0.299],
        [0.267, 0.316],
        [0.401, 0.337],
        [0.441, 0.283],
        [0.526, 0.275],
        [0.609, 0.27],
        [0.686, 0.276],
        [0.754, 0.296],
        [0.837, 0.3],
        [1.02, 0.31],
      ],
      [
        [-0.13, 0.46],
        [-0.06, 0.43],
        [0.015, 0.381],
        [0.104, 0.364],
        [0.195, 0.346],
        [0.295, 0.361],
        [0.403, 0.414],
        [0.515, 0.404],
        [0.63, 0.43],
        [0.737, 0.418],
        [0.795, 0.414],
        [0.866, 0.413],
        [1.03, 0.36],
      ],
      [
        [-0.18, 0.53],
        [-0.05, 0.46],
        [0.085, 0.421],
        [0.19, 0.392],
        [0.31, 0.396],
        [0.388, 0.447],
        [0.485, 0.447],
        [0.575, 0.451],
        [0.677, 0.468],
        [0.789, 0.45],
        [0.872, 0.447],
        [0.953, 0.453],
        [1.09, 0.45],
      ],
      [
        [-0.22, 0.68],
        [-0.08, 0.57],
        [0.049, 0.518],
        [0.178, 0.48],
        [0.299, 0.455],
        [0.414, 0.501],
        [0.515, 0.499],
        [0.637, 0.524],
        [0.779, 0.548],
        [0.89, 0.498],
        [0.979, 0.507],
        [1.12, 0.51],
        [1.26, 0.53],
      ],
      [
        [-0.32, 0.8],
        [-0.16, 0.73],
        [0.003, 0.627],
        [0.137, 0.602],
        [0.254, 0.559],
        [0.346, 0.532],
        [0.465, 0.579],
        [0.583, 0.668],
        [0.772, 0.64],
        [0.909, 0.571],
        [1.065, 0.603],
        [1.23, 0.64],
        [1.4, 0.69],
      ],
      [
        [-0.42, 0.94],
        [-0.24, 0.87],
        [-0.07, 0.8],
        [0.075, 0.726],
        [0.176, 0.68],
        [0.3, 0.638],
        [0.364, 0.711],
        [0.546, 0.797],
        [0.761, 0.73],
        [0.97, 0.662],
        [1.15, 0.74],
        [1.35, 0.78],
        [1.52, 0.84],
      ],
      [
        [-0.5, 1.14],
        [-0.29, 1.06],
        [-0.08, 0.94],
        [0.065, 0.947],
        [0.204, 0.765],
        [0.241, 0.817],
        [0.493, 0.879],
        [0.688, 0.812],
        [0.914, 0.751],
        [1.08, 0.865],
        [1.32, 0.92],
        [1.53, 1.02],
        [1.74, 1.12],
      ],
      [
        [-0.62, 1.39],
        [-0.37, 1.3],
        [-0.1, 1.21],
        [0.11, 1.15],
        [0.31, 1.04],
        [0.48, 1.01],
        [0.68, 0.983],
        [0.887, 0.949],
        [1.14, 1.07],
        [1.38, 1.19],
        [1.62, 1.24],
        [1.9, 1.31],
        [2.1, 1.42],
      ],
    ];
    const depths = [18, 15, 12, 10, 8.5, 7, 5.8, 4.8, 3.8, 3, 2.4];
    const blur = [9, 11, 10, 6, 2.5, 0.65, 0.7, 2.2, 5.5, 10, 14];
    // Keep the scattered layout identical across previews and embedded pages.
    let seed = 20261015;
    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    const nodes = rows.flatMap((row, r) =>
      row.map(([x, y]) => {
        x += (random() - 0.5) * 0.09;
        y += (random() - 0.5) * 0.06;
        const z = depths[r];
        const scale = 1.9 / z;
        return {
          x: (x - 0.5) / scale,
          y: 0.95 - (y - 0.11) / scale,
          z,
          radius: (r < 4 ? 6.5 : 1.2 + 19 / z) * 1.3,
          blur: blur[r] + Math.max(0, Math.abs(x - 0.5) - 0.35) * 10,
        };
      }),
    );
    const edges = [];
    const columns = rows[0].length;
    for (let r = 0; r < rows.length; r++) {
      for (let c = 0; c < columns; c++) {
        const i = r * columns + c;
        if (c + 1 < columns) edges.push([i, i + 1]);
        if (r + 1 < rows.length) {
          edges.push([i, i + columns]);
          if (c + 1 < columns) {
            edges.push(
              (r + c) % 3 === 0 ? [i + 1, i + columns] : [i, i + columns + 1],
            );
          }
        }
      }
    }

    const blurLevels = [1.2, 1.8, 2.6, 4.5, 7, 10, 14, 19];
    const layers = blurLevels.map(() => {
      const layer = document.createElement("canvas");
      layer.setAttribute("aria-hidden", "true");
      layer.hidden = true;
      return { canvas: layer, paint: layer.getContext("2d") };
    });
    if (layers.some((layer) => !layer.paint)) return;
    layers.forEach((layer) => canvas.parentElement.append(layer.canvas));
    const buckets = blurLevels.map(() => []);
    const bucket = (value) =>
      blurLevels.reduce(
        (best, level, i) =>
          Math.abs(level - value) < Math.abs(blurLevels[best] - value)
            ? i
            : best,
        0,
      );
    edges.forEach(([a, b]) => {
      for (let step = 0; step < 6; step++) {
        const start = step / 6;
        const end = (step + 1) / 6;
        const blend = (start + end) / 2;
        buckets[
          bucket(nodes[a].blur * (1 - blend) + nodes[b].blur * blend)
        ].push({ a, b, start, end });
      }
    });
    nodes.forEach((node, index) => buckets[bucket(node.blur)].push({ index }));

    function draw() {
      const useStaticImage = reducedMotion.matches && !light;
      canvas.hidden = useStaticImage;
      layers.forEach((layer) => {
        layer.canvas.hidden = useStaticImage;
      });
      if (useStaticImage) return;
      const unit = side / 1000;
      const offsetX = (width - side) / 2;
      const offsetY = (height - side) / 2;
      const points = nodes.map((node) => {
        // Both harmonics travel together, carrying one continuous crest across the grid.
        const phase = node.x * 1.45 + node.z * 0.38 - time * 0.92;
        const wave = 0.105 * Math.sin(phase) + 0.017 * Math.sin(phase * 2);
        const scale = 1.9 / node.z;
        return {
          x: offsetX + (0.5 + node.x * scale) * side,
          y: offsetY + (0.11 + (0.95 - node.y - wave) * scale) * side,
        };
      });
      const background = context.createLinearGradient(0, 0, 0, height);
      const backgroundColors = light
        ? ["#ffffff", "#f3f5f8", "#eaf0f6"]
        : ["#171f39", "#17213c", "#18233c"];
      background.addColorStop(0, backgroundColors[0]);
      background.addColorStop(0.55, backgroundColors[1]);
      background.addColorStop(1, backgroundColors[2]);
      context.fillStyle = background;
      context.fillRect(0, 0, width, height);
      buckets.forEach((items, i) => {
        const { paint } = layers[i];
        paint.clearRect(0, 0, width, height);
        // Opaque, pre-blended color keeps overlapping lines and nodes the same color.
        paint.fillStyle = paint.strokeStyle = light ? "#bfd6e4" : "#1d3951";
        paint.lineCap = "round";
        items.forEach((item) => {
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
            paint.lineWidth =
              (1.2 + 14 / ((nodeA.z + nodeB.z) / 2)) * unit * 1.3;
            paint.beginPath();
            paint.moveTo(
              a.x + (b.x - a.x) * item.start,
              a.y + (b.y - a.y) * item.start,
            );
            paint.lineTo(
              a.x + (b.x - a.x) * item.end,
              a.y + (b.y - a.y) * item.end,
            );
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
        layer.canvas.style.filter = `blur(${(blurLevels[i] * side) / ratio / 1000}px)`;
      });
      draw();
    }
    function animate(now) {
      time += previous ? (Math.min(now - previous, 50) / 1000) * 0.56 : 0;
      previous = now;
      draw();
      frame = requestAnimationFrame(animate);
    }
    function updateMotion() {
      cancelAnimationFrame(frame);
      previous = 0;
      draw();
      if (!reducedMotion.matches && !document.hidden)
        frame = requestAnimationFrame(animate);
    }
    reducedMotion.addEventListener("change", updateMotion);
    if (theme === "auto")
      colorScheme.addEventListener("change", () => {
        light = colorScheme.matches;
        document.documentElement.dataset.theme = light ? "light" : "dark";
        draw();
      });
    document.addEventListener("visibilitychange", updateMotion);
    window.addEventListener("resize", resize, { passive: true });
    resize();
    updateMotion();
  });
})();
