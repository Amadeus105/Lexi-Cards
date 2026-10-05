// Пиксельный кот Lexi.
// Позы: "lie" (лежит клубком), "stand" (стоит), "walk" (идёт).
// Настроения: "sleep", "watch", "happy", "sad", "content", "bored".
// Награды за серию: подушка (видна, когда кот лежит), шарф, шапка.
// Кот рисуется из простых фигур в сетке 48×31 «пикселей», контур считается
// автоматически, а холст растягивается без сглаживания. В неоновой теме кот белый.
const LexiCat = (() => {
  const W = 48;
  const H = 31;
  const TICK_MS = 140;

  const PALETTES = {
    paper: {
      outline: "#6b4423", fur: "#eaa04a", stripe: "#c97d2e", light: "#f6c47c",
      white: "#fff7ec", pink: "#f4a3b4", eye: "#3a2618", shine: "#ffffff",
      cushion: "#c0504d", cushionTop: "#de7a6e", hat: "#4f7cff", hatRib: "#3a5fd0", pompom: "#fff7ec",
    },
    neon: {
      outline: "#6d7499", fur: "#eef1fb", stripe: "#c4cae4", light: "#ffffff",
      white: "#ffffff", pink: "#ff9ec4", eye: "#2b3150", shine: "#ffffff",
      cushion: "#6366f1", cushionTop: "#818cf8", hat: "#22d3ee", hatRib: "#0ea5c6", pompom: "#ff9ec4",
    },
  };
  const FX = {
    tear: "#7cc7ff", heart: "#ff6b8a", zzz: "#b9c3ff", cloud: "#c9d3e6",
    dots: "#a3aec6", scarf: "#e5484d", scarfDark: "#b8323a",
  };

  // Слои по глубине: линия контура рисуется на том, что ближе к зрителю.
  const CUSHION = 1, BACK = 2, BODY = 3, FRONT = 4, HEAD = 5, PAW = 6, SCARF = 7, HAT = 8;

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  canvas.className = "pixel-cat";
  canvas.setAttribute("aria-hidden", "true");
  const ctx = canvas.getContext("2d");

  let pose = "lie";
  let mood = "sleep";
  let restingMood = null; // куда вернуться после короткой реакции
  let gear = { cushion: false, scarf: false, hat: false };
  let t = 0;
  let moodStart = 0;
  let timer = null;
  const tickListeners = [];

  const inEllipse = (x, y, cx, cy, rx, ry) => {
    const dx = (x + 0.5 - cx) / rx;
    const dy = (y + 0.5 - cy) / ry;
    return dx * dx + dy * dy <= 1;
  };

  function inTriangle(x, y, [ax, ay], [bx, by], [cx, cy]) {
    const px = x + 0.5, py = y + 0.5;
    const d1 = (px - bx) * (ay - by) - (ax - bx) * (py - by);
    const d2 = (px - cx) * (by - cy) - (bx - cx) * (py - cy);
    const d3 = (px - ax) * (cy - ay) - (cx - ax) * (py - ay);
    const neg = d1 < 0 || d2 < 0 || d3 < 0;
    const pos = d1 > 0 || d2 > 0 || d3 > 0;
    return !(neg && pos);
  }

  // Уменьшенный треугольник — розовая внутренность уха.
  function shrink(tri, k) {
    const cx = (tri[0][0] + tri[1][0] + tri[2][0]) / 3;
    const cy = (tri[0][1] + tri[1][1] + tri[2][1]) / 3;
    return tri.map(([x, y]) => [cx + (x - cx) * k, cy + (y - cy) * k]);
  }

  function sprite(rows, ox, oy, color, put) {
    rows.forEach((row, dy) => {
      [...row].forEach((ch, dx) => {
        if (ch === "X") put(ox + dx, oy + dy, color);
      });
    });
  }

  function draw() {
    const P = document.documentElement.dataset.theme === "neon" ? PALETTES.neon : PALETTES.paper;
    const color = new Array(W * H).fill(null);
    const layer = new Array(W * H).fill(0);
    const idx = (x, y) => y * W + x;
    const inside = (x, y) => x >= 0 && y >= 0 && x < W && y < H;
    const put = (x, y, c, l) => {
      x = Math.round(x);
      y = Math.round(y);
      if (!inside(x, y)) return;
      color[idx(x, y)] = c;
      if (l) layer[idx(x, y)] = l;
    };
    const fill = (test, paint, l) => {
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          if (test(x, y)) put(x, y, paint(x, y), l);
        }
      }
    };

    const since = t - moodStart;
    const sad = mood === "sad";
    const happy = mood === "happy";
    const smiling = happy || mood === "content";
    const lying = pose === "lie";

    const breath = Math.sin(t / (sad || mood === "bored" ? 9 : mood === "sleep" ? 7 : 5)) > 0 ? 0.7 : 0;
    // Радость: несколько прыжков сразу после правильного ответа или поглаживания.
    const hop = happy && since < 14 && since % 4 < 2 ? -2 : 0;
    const oy = hop + (lying && gear.cushion ? -2 : 0);

    let hx, hy;
    const stripeAt = (x, y, top) => y < top && (x + Math.floor(y * 0.6)) % 5 === 0;

    if (lying) {
      // ---------- кот лежит клубком ----------
      if (gear.cushion) {
        fill((x, y) => inEllipse(x, y, 23, 27.6, 21.5, 2.6), (x, y) => (y < 27 ? P.cushionTop : P.cushion), CUSHION);
      }
      const bodyRy = 8 + breath;
      const bodyCy = 26.5 - bodyRy + oy;
      fill(
        (x, y) => inEllipse(x, y, 21, bodyCy, 17, bodyRy),
        (x, y) => {
          if (inEllipse(x, y, 29, 23.5 + oy, 8, 3.6)) return P.white;
          if (y > bodyCy + bodyRy * 0.5) return P.light;
          return stripeAt(x, y, bodyCy + 2) ? P.stripe : P.fur;
        },
        BODY
      );
      // хвост вдоль низа: виляет от радости, лениво дёргается от скуки
      let wag = 0;
      if (happy) wag = t % 4 < 2 ? 1.5 : -1;
      else if (mood === "bored" && t % 24 < 3) wag = 1.5;
      fill(
        (x, y) => y >= 24 + oy && inEllipse(x, y, 14, 25.3 + oy, 11 + wag, 2.4),
        (x) => (x % 4 === 0 ? P.stripe : P.fur),
        FRONT
      );
      hx = 37;
      hy = 19 + oy + (sad ? 1 : 0);
    } else {
      // ---------- кот стоит или идёт (смотрит вправо) ----------
      const walking = pose === "walk";
      const step = walking ? t % 4 : -1;
      const bob = walking && step % 2 === 1 ? -1 : 0;
      const bodyCy = 17.5 + bob + oy;

      // хвост поднят и покачивается
      const sway = Math.round(Math.sin(t / 3) * 1.5);
      const tail = [[10, bodyCy - 1], [2, bodyCy - 4], [5 + sway, 4 + oy]];
      for (let k = 0; k <= 24; k++) {
        const s = k / 24;
        const tx = (1 - s) ** 2 * tail[0][0] + 2 * (1 - s) * s * tail[1][0] + s * s * tail[2][0];
        const ty = (1 - s) ** 2 * tail[0][1] + 2 * (1 - s) * s * tail[1][1] + s * s * tail[2][1];
        fill((x, y) => inEllipse(x, y, tx, ty, 1.7, 1.7), () => (s > 0.8 ? P.stripe : P.fur), BACK);
      }

      // лапы: дальние темнее и позади тела, ближние — перед ним
      const legShift = (pair) => {
        if (!walking) return 0;
        const swing = [-1.5, 0, 1.5, 0][step];
        return pair === 0 ? swing : -swing;
      };
      const leg = (x0, pair, near) => {
        const dx = legShift(pair);
        fill(
          (x, y) => {
            if (y < bodyCy + 2 || y > 28 + oy) return false;
            const k = (y - (bodyCy + 2)) / (28 + oy - (bodyCy + 2));
            const cx = x0 + dx * k;
            return x + 0.5 >= cx - 1.5 && x + 0.5 <= cx + 1.5;
          },
          (x, y) => (y >= 27 + oy ? P.white : near ? P.fur : P.stripe),
          near ? FRONT : BACK
        );
      };
      leg(15, 1, false);
      leg(30, 0, false);
      leg(12, 0, true);
      leg(27, 1, true);

      fill(
        (x, y) => inEllipse(x, y, 21, bodyCy, 12.5, 5.4 + breath * 0.5),
        (x, y) => {
          if (inEllipse(x, y, 30, bodyCy + 1, 4, 3.6)) return P.white;
          if (y > bodyCy + 2.5 && x > 15) return P.white;
          return stripeAt(x, y, bodyCy + 1) ? P.stripe : P.fur;
        },
        BODY
      );
      hx = 35;
      hy = 12 + bob + oy + (sad ? 1 : 0);
    }

    // ---------- голова и уши (общие для всех поз) ----------
    const twitch = mood === "watch" && t % 22 < 2 ? 1 : 0;
    const ears = sad
      ? [[[hx - 7, hy - 1.5], [hx - 8.7, hy - 7.5], [hx - 2, hy - 5]], [[hx + 2.5, hy - 5], [hx + 9.2, hy - 7.5], [hx + 7.5, hy - 1.5]]]
      : [[[hx - 6.5, hy - 2], [hx - 4.7, hy - 11.5], [hx, hy - 5]], [[hx + 0.5, hy - 5], [hx + 5.7 + twitch, hy - 11.5 + twitch], [hx + 7, hy - 2]]];
    for (const ear of ears) {
      const inner = shrink(ear, 0.45);
      fill((x, y) => inTriangle(x, y, ...ear), (x, y) => (inTriangle(x, y, ...inner) ? P.pink : P.fur), HEAD);
    }
    fill(
      (x, y) => inEllipse(x, y, hx, hy, 7.2, 6.4),
      (x, y) => {
        if (inEllipse(x, y, hx, hy + 3, 4.2, 2.6)) return P.white;
        if (y < hy - 2 && y > hy - 6 && (x === hx - 2 || x === hx || x === hx + 2)) return P.stripe;
        return P.fur;
      },
      HEAD
    );

    // лапки перед мордой — только когда кот лежит
    if (lying) {
      fill(
        (x, y) => inEllipse(x, y, 32.5, 25.8 + oy, 2.8, 1.5) || inEllipse(x, y, 40.5, 26 + oy, 2.5, 1.4),
        () => P.white,
        PAW
      );
    }

    // шарф: полоса вокруг шеи и свисающий конец
    if (gear.scarf) {
      const scarfColor = (x, y) => ((y + x) % 3 === 0 ? FX.scarfDark : FX.scarf);
      fill(
        (x, y) => x < hx - 2 && y > hy - 1 && inEllipse(x, y, hx, hy, 9.8, 9) && !inEllipse(x, y, hx, hy, 7.2, 6.4),
        scarfColor,
        SCARF
      );
      fill((x, y) => x >= hx - 10 && x <= hx - 8 && y >= hy + 2 && y <= hy + 7, scarfColor, SCARF);
    }

    // вязаная шапка с помпоном
    if (gear.hat) {
      fill(
        (x, y) => y < hy - 3 && inEllipse(x, y, hx, hy - 3.2, 5.8, 6),
        (x, y) => (y >= hy - 5 ? P.hatRib : x % 2 === 0 ? P.hat : P.hatRib),
        HAT
      );
      fill((x, y) => inEllipse(x, y, hx, hy - 10, 2, 2), () => P.pompom, HAT);
    }

    // ---------- контур: снаружи фигуры и там, где ближний слой лежит на дальнем ----------
    const outline = [];
    const neighbours = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = idx(x, y);
        const near = neighbours.filter(([dx, dy]) => inside(x + dx, y + dy)).map(([dx, dy]) => idx(x + dx, y + dy));
        if (color[i] === null) {
          if (near.some((j) => color[j] !== null)) outline.push(i);
        } else if (near.some((j) => layer[j] !== 0 && layer[j] < layer[i])) {
          outline.push(i);
        }
      }
    }
    outline.forEach((i) => (color[i] = P.outline));

    // ---------- морда ----------
    const ey = Math.round(hy);
    const ex1 = hx - 3, ex2 = hx + 3;
    const eye = (x, y) => put(x, y, P.eye);
    const blink = (mood === "watch" || mood === "bored") && t % 30 === 0;
    if (mood === "sleep" || blink) {
      eye(ex1 - 1, ey); eye(ex1, ey);
      eye(ex2, ey); eye(ex2 + 1, ey);
    } else if (mood === "watch") {
      for (const ex of [ex1 - 1, ex2]) {
        eye(ex, ey - 1); eye(ex + 1, ey - 1); eye(ex, ey); eye(ex + 1, ey);
        put(ex, ey - 1, P.shine);
      }
    } else if (mood === "bored") {
      // полуприкрытые глаза: веко сверху, зрачки снизу
      for (const ex of [ex1 - 1, ex2]) {
        put(ex, ey - 1, P.outline); put(ex + 1, ey - 1, P.outline);
        eye(ex, ey); eye(ex + 1, ey);
      }
    } else if (smiling) {
      eye(ex1 - 2, ey); eye(ex1 - 1, ey - 1); eye(ex1, ey);
      eye(ex2, ey); eye(ex2 + 1, ey - 1); eye(ex2 + 2, ey);
      put(ex1 - 2, ey + 2, P.pink); put(ex2 + 2, ey + 2, P.pink);
    } else if (sad) {
      eye(ex1 - 2, ey - 1); eye(ex1 - 1, ey); eye(ex1, ey);
      eye(ex2, ey); eye(ex2 + 1, ey); eye(ex2 + 2, ey - 1);
    }
    put(hx - 1, hy + 2, P.pink);
    put(hx, hy + 2, P.pink);
    if (happy) {
      put(hx - 1, hy + 3, P.pink);
      put(hx, hy + 3, P.pink);
    } else if (sad) {
      put(hx - 2, hy + 4, P.outline); put(hx - 1, hy + 3, P.outline);
      put(hx, hy + 3, P.outline); put(hx + 1, hy + 4, P.outline);
    } else if (mood === "bored") {
      put(hx - 1, hy + 4, P.outline); put(hx, hy + 4, P.outline);
    }

    // ---------- эффекты над котом ----------
    const top = Math.max(0, Math.round(hy) - 12);
    const HEART = [".X.X.", "XXXXX", ".XXX.", "..X.."];
    if (mood === "sleep") {
      const Z = ["XXXX", "..X.", ".X..", "XXXX"];
      for (let k = 0; k < 2; k++) {
        const phase = (Math.floor(t / 2) + k * 5) % 10;
        if (phase < 8) sprite(Z, hx + 7 - k * 4 + (phase > 4 ? 1 : 0), top + 7 - phase, FX.zzz, put);
      }
    } else if (happy) {
      for (let k = 0; k < 3; k++) {
        const phase = (since + k * 4) % 12;
        if (phase < 10) sprite(HEART, hx - 10 + k * 7, top + 9 - phase + (k === 1 ? -1 : 0), FX.heart, put);
      }
    } else if (mood === "content" && lying) {
      // изредка одно сердечко — кот доволен жизнью
      const phase = t % 36;
      if (phase < 10) sprite(HEART, hx + 5, top + 8 - phase, FX.heart, put);
    } else if (mood === "bored" && lying) {
      // «…» появляется по точке
      const shown = Math.floor(t / 4) % 5;
      for (let k = 0; k < Math.min(shown, 3); k++) put(hx + 4 + k * 2, top + 5, FX.dots);
    } else if (sad) {
      const tearY = ey + 1 + (since % 6);
      if (tearY < ey + 6) put(ex2 + 1, tearY, FX.tear);
      sprite(["..XXX....", ".XXXXXX..", "XXXXXXXXX"], hx - 5, top + 1, FX.cloud, put);
      for (let k = 0; k < 3; k++) put(hx - 4 + k * 3, top + 4 + ((t + k * 2) % 5), FX.tear);
    }

    ctx.clearRect(0, 0, W, H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const c = color[idx(x, y)];
        if (!c) continue;
        ctx.fillStyle = c;
        ctx.fillRect(x, y, 1, 1);
      }
    }
  }

  function tick() {
    if (!canvas.isConnected) {
      stop();
      return;
    }
    t++;
    // короткая реакция закончилась — возвращаемся к прежнему настроению
    if (restingMood && t - moodStart > 18) {
      mood = restingMood;
      restingMood = null;
      moodStart = t;
    }
    tickListeners.forEach((fn) => fn(t));
    draw();
  }

  function start() {
    if (timer || reducedMotion) return;
    timer = setInterval(tick, TICK_MS);
  }

  function stop() {
    clearInterval(timer);
    timer = null;
  }

  // Перекрашиваем кота сразу при смене темы.
  new MutationObserver(() => draw()).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });

  return {
    canvas,
    mount(container) {
      container.appendChild(canvas);
      draw();
      start();
    },
    setMood(next) {
      restingMood = null;
      if (next === mood) return;
      mood = next;
      moodStart = t;
      draw();
    },
    setPose(next) {
      if (next === pose) return;
      pose = next;
      draw();
    },
    // Короткая радость (например, кота погладили), потом прежнее настроение.
    react() {
      if (!restingMood) restingMood = mood;
      mood = "happy";
      moodStart = t;
      draw();
    },
    setGear(next) {
      gear = { ...gear, ...next };
      draw();
    },
    onTick(fn) {
      tickListeners.push(fn);
    },
    get mood() {
      return mood;
    },
    get reacting() {
      return restingMood !== null;
    },
  };
})();
