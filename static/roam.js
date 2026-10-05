// Кот гуляет по низу экрана: ходит, останавливается, ложится отдохнуть и засыпает.
// Настроение и награды зависят от занятий: занимались сегодня — доволен, нет — скучает;
// за серию дней подряд — подушка, шарф и шапка. Нажмите на кота, чтобы погладить.
// На странице повторения кот может «запрыгнуть» на карточку — тогда здесь он скрыт.
const LexiRoam = (() => {
  const SCALE = 3;
  const CAT_W = 48 * SCALE;
  const STEP_PX = SCALE; // один «пиксель» кота за такт
  const GEAR = [
    { key: "cushion", label: "подушка", days: 3 },
    { key: "scarf", label: "шарф", days: 7 },
    { key: "hat", label: "шапка", days: 14 },
  ];

  const el = document.createElement("div");
  el.className = "cat-roamer";
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "cat-roamer-btn";
  btn.setAttribute("aria-label", "Погладить кота");
  el.appendChild(btn);
  document.body.appendChild(el);

  let x = Math.random() * Math.max(0, document.documentElement.clientWidth - CAT_W);
  let dir = Math.random() < 0.5 ? -1 : 1;
  let action = "lie";
  let left = 20; // сколько тактов осталось до следующего решения
  let baseMood = "content";

  const rand = (a, b) => a + Math.floor(Math.random() * (b - a + 1));

  function place() {
    el.style.transform = `translateX(${Math.round(x)}px)`;
    el.classList.toggle("facing-left", dir < 0);
  }

  function setAction(next) {
    action = next;
    if (next === "walk") {
      left = rand(25, 70);
      LexiCat.setPose("walk");
      LexiCat.setMood("watch");
    } else if (next === "stand") {
      left = rand(12, 30);
      LexiCat.setPose("stand");
      LexiCat.setMood(baseMood === "bored" ? "bored" : "watch");
    } else {
      left = rand(90, 260);
      LexiCat.setPose("lie");
      LexiCat.setMood(baseMood);
    }
  }

  function decide() {
    if (action === "walk") {
      const r = Math.random();
      if (r < 0.45) setAction("stand");
      else if (r < 0.75) setAction("lie");
      else {
        dir = -dir;
        setAction("walk");
      }
    } else if (action === "stand") {
      if (Math.random() < 0.5) dir = -dir;
      setAction("walk");
    } else {
      setAction("stand");
    }
  }

  // Скучающий кот чаще лежит; довольный — больше гуляет.
  function onTick() {
    if (LexiCat.canvas.parentElement !== btn) {
      el.hidden = true;
      return;
    }
    el.hidden = false;
    if (LexiCat.reacting) return; // пока радуется — стоит на месте

    if (action === "walk") {
      const max = Math.max(0, document.documentElement.clientWidth - CAT_W);
      if (max === 0) return; // окно слишком узкое — гулять негде
      x += dir * STEP_PX;
      if (x <= 0 || x >= max) {
        x = Math.min(Math.max(x, 0), max);
        dir = -dir;
      }
      place();
    } else if (action === "lie" && LexiCat.mood === baseMood && left < 60) {
      LexiCat.setMood("sleep"); // долго лежит — засыпает
    }

    left -= baseMood === "bored" && action === "walk" ? 2 : 1;
    if (left <= 0) decide();
  }

  // Если кот был на карточке, а карточка исчезла или скрыта — возвращаем его гулять.
  function adopt() {
    const c = LexiCat.canvas;
    if (c.parentElement === btn) return;
    if (c.isConnected && c.offsetParent !== null) return;
    LexiCat.mount(btn);
    setAction("stand");
    place();
  }

  btn.addEventListener("click", () => {
    if (action === "lie") setAction("stand");
    LexiCat.react();
  });

  window.addEventListener("resize", () => {
    x = Math.min(x, Math.max(0, document.documentElement.clientWidth - CAT_W));
    place();
  });

  async function loadMood() {
    try {
      const res = await fetch("/api/stats");
      if (!res.ok) return;
      const s = await res.json();
      baseMood = s.reviewed_today > 0 ? "content" : "bored";
      LexiCat.setGear(Object.fromEntries(GEAR.map((g) => [g.key, s.streak >= g.days])));
      if (action === "lie") LexiCat.setMood(baseMood);

      const next = GEAR.find((g) => s.streak < g.days);
      const streak = s.streak
        ? `Серия: ${s.streak} ${pluralRu(s.streak, "день", "дня", "дней")} подряд.`
        : "Серии пока нет.";
      const reward = next
        ? ` Через ${next.days - s.streak} ${pluralRu(next.days - s.streak, "день", "дня", "дней")} кот получит: ${next.label}.`
        : " У кота уже есть всё.";
      const today = s.reviewed_today ? " Сегодня вы уже занимались." : " Сегодня ещё не занимались — коту скучно.";
      btn.title = `${streak}${reward}${today} Нажмите, чтобы погладить.`;
    } catch {
      /* без статистики кот просто гуляет */
    }
  }

  LexiCat.mount(btn);
  LexiCat.onTick(onTick);
  setAction("lie");
  place();
  setInterval(adopt, 500);
  loadMood();

  return { reloadMood: loadMood };
})();
