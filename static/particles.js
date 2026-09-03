(function () {
  const canvas = document.getElementById("particle-canvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");

  let width, height;
  let nodes = [];
  let beams = [];
  const chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ@#$%&*()".split("");
  const mouse = { x: -1000, y: -1000 };
  const ACCENT = "99, 102, 241";

  function resize() {
    width = canvas.clientWidth;
    height = canvas.clientHeight;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);
  }

  function initParticles() {
    const nodeCount = Math.max(40, Math.round((width * height) / 22000));
    nodes = Array.from({ length: nodeCount }).map(() => ({
      x: Math.random() * width,
      y: Math.random() * height,
      vy: Math.random() * 0.35 + 0.08,
      char: chars[Math.floor(Math.random() * chars.length)],
    }));
    beams = Array.from({ length: 16 }).map(() => ({
      x: Math.random() * width,
      y: Math.random() * height,
      length: Math.random() * 100 + 50,
      speed: Math.random() * 4 + 2,
      opacity: Math.random() * 0.35 + 0.2,
    }));
  }

  window.addEventListener("resize", () => {
    resize();
    initParticles();
  });
  window.addEventListener("mousemove", (e) => {
    mouse.x = e.clientX;
    mouse.y = e.clientY;
  });
  window.addEventListener("mouseleave", () => {
    mouse.x = -1000;
    mouse.y = -1000;
  });

  resize();
  initParticles();

  function draw() {
    ctx.clearRect(0, 0, width, height);

    beams.forEach((b) => {
      b.y -= b.speed;
      if (b.y + b.length < 0) {
        b.y = height + 100;
        b.x = Math.random() * width;
      }
      const g = ctx.createLinearGradient(b.x, b.y, b.x, b.y + b.length);
      g.addColorStop(0, `rgba(${ACCENT}, ${b.opacity})`);
      g.addColorStop(1, "transparent");
      ctx.strokeStyle = g;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(b.x, b.y);
      ctx.lineTo(b.x, b.y + b.length);
      ctx.stroke();
    });

    ctx.font = "12px monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    ctx.lineWidth = 0.5;
    for (let i = 0; i < nodes.length; i++) {
      const n1 = nodes[i];
      for (let j = i + 1; j < nodes.length; j++) {
        const n2 = nodes[j];
        const d = Math.hypot(n1.x - n2.x, n1.y - n2.y);
        if (d < 120) {
          ctx.strokeStyle = `rgba(156, 163, 175, ${0.12 * (1 - d / 120)})`;
          ctx.beginPath();
          ctx.moveTo(n1.x, n1.y);
          ctx.lineTo(n2.x, n2.y);
          ctx.stroke();
        }
      }
    }

    nodes.forEach((n) => {
      n.y += n.vy;
      if (n.y > height + 20) {
        n.y = -20;
        n.x = Math.random() * width;
      }

      const dist = Math.hypot(mouse.x - n.x, mouse.y - n.y);
      if (dist < 160 || Math.random() > 0.985) {
        n.char = chars[Math.floor(Math.random() * chars.length)];
      }

      if (dist < 160) {
        ctx.strokeStyle = `rgba(${ACCENT}, ${0.4 * (1 - dist / 160)})`;
        ctx.beginPath();
        ctx.moveTo(n.x, n.y);
        ctx.lineTo(mouse.x, mouse.y);
        ctx.stroke();
      }

      ctx.fillStyle = dist < 160 ? "#818cf8" : "rgba(156, 163, 175, 0.35)";
      ctx.fillText(n.char, n.x, n.y);
    });

    requestAnimationFrame(draw);
  }
  draw();
})();