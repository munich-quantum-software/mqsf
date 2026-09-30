(() => {
  const imageURL = new URL('./images/brand/grey-waves-wallpaper.png', document.currentScript.src);

  // Control points follow visible intersections in the original square artwork.
  const anchors = [
    [0.045, 0.305], [0.150, 0.299], [0.267, 0.316], [0.401, 0.337],
    [0.441, 0.283], [0.526, 0.275], [0.609, 0.270], [0.686, 0.276],
    [0.754, 0.296], [0.837, 0.300], [0.924, 0.274],
    [0.015, 0.381], [0.085, 0.421], [0.190, 0.392], [0.195, 0.346],
    [0.310, 0.396], [0.388, 0.447], [0.403, 0.414], [0.515, 0.404],
    [0.485, 0.447], [0.575, 0.451], [0.630, 0.430], [0.677, 0.468],
    [0.737, 0.418], [0.795, 0.414], [0.872, 0.447], [0.953, 0.453],
    [0.049, 0.518], [0.299, 0.455], [0.414, 0.501], [0.515, 0.499],
    [0.637, 0.524], [0.789, 0.450], [0.890, 0.498], [0.979, 0.507],
    [0.137, 0.602], [0.254, 0.559], [0.376, 0.530], [0.465, 0.579],
    [0.779, 0.548], [0.909, 0.571], [0.003, 0.627], [0.176, 0.680],
    [0.300, 0.638], [0.583, 0.668], [0.772, 0.640], [0.970, 0.662],
    [0.075, 0.726], [0.204, 0.765], [0.364, 0.711], [0.914, 0.751],
    [0.241, 0.817], [0.493, 0.879], [0.688, 0.812], [0.897, 0.859],
  ];

  document.querySelectorAll('.wave-canvas').forEach((canvas) => {
    const gl = canvas.getContext('webgl', { alpha: true, antialias: false, depth: false });
    if (!gl) return;

    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
    let frame = 0;
    let previousTime = 0;
    let motionTime = 0;
    let unavailable = false;

    function showOriginal() {
      unavailable = true;
      cancelAnimationFrame(frame);
      canvas.hidden = true;
    }

    canvas.addEventListener('webglcontextlost', (event) => {
      event.preventDefault();
      showOriginal();
    });

    async function start() {
      const vertexSource = `
        attribute vec2 a_uv;
        uniform vec2 u_scale;
        uniform vec4 u_nodes[${anchors.length}];
        varying vec2 v_uv;
        void main() {
          vec2 offset = vec2(0.0);
          float total = 0.0;
          for (int i = 0; i < ${anchors.length}; i++) {
            vec2 distance = (a_uv - u_nodes[i].xy) / 0.115;
            float influence = max(0.0, 1.0 - dot(distance, distance));
            influence *= influence;
            offset += u_nodes[i].zw * influence;
            total += influence;
          }
          vec2 edge = smoothstep(vec2(0.0), vec2(0.035), a_uv)
                    * smoothstep(vec2(0.0), vec2(0.035), 1.0 - a_uv);
          vec2 position = a_uv + offset / max(1.0, total) * edge.x * edge.y;
          gl_Position = vec4((position * 2.0 - 1.0) * u_scale * vec2(1.0, -1.0), 0.0, 1.0);
          v_uv = a_uv;
        }`;
      const fragmentSource = `
        precision highp float;
        uniform sampler2D u_image;
        varying vec2 v_uv;
        void main() { gl_FragColor = texture2D(u_image, v_uv); }`;

      function compile(type, source) {
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
          throw new Error(gl.getShaderInfoLog(shader));
        }
        return shader;
      }

      const program = gl.createProgram();
      gl.attachShader(program, compile(gl.VERTEX_SHADER, vertexSource));
      gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragmentSource));
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
      gl.useProgram(program);

      const divisions = 96;
      const vertices = [];
      const indices = [];
      for (let y = 0; y <= divisions; y++) {
        for (let x = 0; x <= divisions; x++) vertices.push(x / divisions, y / divisions);
      }
      for (let y = 0; y < divisions; y++) {
        for (let x = 0; x < divisions; x++) {
          const a = y * (divisions + 1) + x;
          const b = a + divisions + 1;
          indices.push(a, b, a + 1, a + 1, b, b + 1);
        }
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);
      const uv = gl.getAttribLocation(program, 'a_uv');
      gl.enableVertexAttribArray(uv);
      gl.vertexAttribPointer(uv, 2, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(indices), gl.STATIC_DRAW);

      const image = new Image();
      image.crossOrigin = 'anonymous';
      image.src = imageURL.href;
      await image.decode();
      if (unavailable) return;
      gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
      gl.uniform1i(gl.getUniformLocation(program, 'u_image'), 0);

      const scaleUniform = gl.getUniformLocation(program, 'u_scale');
      const nodeUniform = gl.getUniformLocation(program, 'u_nodes[0]');
      const nodes = new Float32Array(anchors.length * 4);

      function draw() {
        if (unavailable) return;
        canvas.hidden = reducedMotion.matches || motionTime === 0;
        if (reducedMotion.matches) return;
        anchors.forEach(([x, y], index) => {
          const phase = index * 2.39996 + x * 4;
          const frequency = 0.95 + (index % 7) * 0.065;
          const amplitude = 0.006 + y * 0.011;
          const ramp = Math.min(1, motionTime / 1.2);
          nodes[index * 4] = x;
          nodes[index * 4 + 1] = y;
          nodes[index * 4 + 2] = Math.sin(motionTime * frequency * 0.7 + phase) * amplitude * 0.18 * ramp;
          nodes[index * 4 + 3] = Math.sin(motionTime * frequency + phase) * amplitude * ramp;
        });
        gl.uniform4fv(nodeUniform, nodes);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.drawElements(gl.TRIANGLES, indices.length, gl.UNSIGNED_SHORT, 0);
      }

      function resize() {
        if (unavailable) return;
        const width = canvas.parentElement.clientWidth;
        const height = canvas.parentElement.clientHeight;
        if (!width || !height) return;
        const dpr = Math.min(devicePixelRatio || 1, 2);
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
        gl.viewport(0, 0, canvas.width, canvas.height);
        const side = Math.max(width, height);
        gl.uniform2f(scaleUniform, side / width, side / height);
        draw();
      }

      function animate(time) {
        if (previousTime) motionTime += Math.min(time - previousTime, 50) / 1000;
        previousTime = time;
        draw();
        frame = requestAnimationFrame(animate);
      }

      function update() {
        if (unavailable) return;
        cancelAnimationFrame(frame);
        previousTime = 0;
        draw();
        if (!reducedMotion.matches && !document.hidden) frame = requestAnimationFrame(animate);
      }

      reducedMotion.addEventListener('change', update);
      document.addEventListener('visibilitychange', update);
      window.addEventListener('resize', resize, { passive: true });
      resize();
      update();
    }

    start().catch((error) => {
      console.error('MQSF background:', error);
      showOriginal();
    });
  });
})();
