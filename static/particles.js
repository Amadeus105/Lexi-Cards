// «Живой» фон неоновой темы: падающие символы, световые лучи и связи с курсором.
// Работает только при <html data-theme="neon">; в «Бумаге» полностью остановлен.
(function () {
  const root = document.documentElement;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const canvas = document.createElement("canvas");
  canvas.id = "particle-canvas";
  canvas.setAttribute("aria-hidden", "true");
  document.body.prepend(canvas);
  const ctx = canvas.getContext("2d");

  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz".split("");
  const mouse = { x: -1000, y: -1000 };
  const ACCENT = "99, 102, 241";
  const CYAN = "34, 211, 238";

  let width = 0, height = 0;
  let nodes = [];
  let beams = [];
  let frame = null;

  function resize() {
    width = canvas.clientWidth;
    height = canvas.clientHeight;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function initParticles() {
    const nodeCount = Math.max(40, Math.round((width * height) / 22000));
    nodes = Array.from({ length: nodeCount }, () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      vy: Math.random() * 0.35 + 0.08,
      char: chars[Math.floor(Math.random() * chars.length)],
    }));
    beams = Array.from({ length: 16 }, () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      length: Math.random() * 100 + 50,
      speed: Math.random() * 4 + 2,
      opacity: Math.random() * 0.35 + 0.2,
      color: Math.random() > 0.5 ? ACCENT : CYAN,
    }));
  }

  function draw() {
    ctx.clearRect(0, 0, width, height);

    beams.forEach((b) => {
      b.y -= b.speed;
      if (b.y + b.length < 0) {
        b.y = height + 100;
        b.x = Math.random() * width;
      }
      const g = ctx.createLinearGradient(b.x, b.y, b.x, b.y + b.length);
      g.addColorStop(0, `rgba(${b.color}, ${b.opacity})`);
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

    frame = requestAnimationFrame(draw);
  }

  function isNeon() {
    return root.dataset.theme === "neon";
  }

  function start() {
    if (frame || reducedMotion || document.hidden || !isNeon()) return;
    resize();
    if (nodes.length === 0) initParticles();
    frame = requestAnimationFrame(draw);
  }

  function stop() {
    if (frame) cancelAnimationFrame(frame);
    frame = null;
    ctx.clearRect(0, 0, width, height);
  }

  function sync() {
    if (isNeon()) start();
    else stop();
  }

  window.addEventListener("resize", () => {
    if (!isNeon()) return;
    resize();
    initParticles();
  });
  window.addEventListener("mousemove", (e) => {
    mouse.x = e.clientX;
    mouse.y = e.clientY;
  });
  document.addEventListener("mouseleave", () => {
    mouse.x = -1000;
    mouse.y = -1000;
  });
  // Во фоновой вкладке не тратим процессор.
  document.addEventListener("visibilitychange", () => (document.hidden ? stop() : sync()));
  // Переключатель темы меняет атрибут — следим за ним.
  new MutationObserver(sync).observe(root, { attributes: true, attributeFilter: ["data-theme"] });

  sync();
})();
