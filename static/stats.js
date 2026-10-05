// Коробки Лейтнера: карточки раскладываются по тому, как надолго их отложили.
const BOXES = [
  { key: "new", label: "Новые", note: "ещё не повторяли" },
  { key: "relearn", label: "Учу заново", note: "забыли недавно" },
  { key: "week", label: "До недели", note: "вернутся в ближайшие дни" },
  { key: "month", label: "До месяца", note: "вернутся через 1–4 недели" },
  { key: "long", label: "Месяц и дольше", note: "знаете хорошо" },
];

function boxOf(card) {
  if (!card.due_at) return "new";
  const days = card.interval_days || 0;
  if (days < 1) return "relearn";
  if (days < 7) return "week";
  if (days < 30) return "month";
  return "long";
}

async function loadStats() {
  let cards, stats;
  try {
    const [cardsRes, statsRes] = await Promise.all([fetch("/api/cards"), fetch("/api/stats")]);
    cards = await cardsRes.json();
    stats = await statsRes.json();
  } catch {
    document.getElementById("stats-empty").hidden = false;
    document.querySelector("#stats-empty p").textContent =
      "Статистика не загрузилась: сервер не отвечает. Запустите его и обновите страницу.";
    return;
  }

  const content = document.getElementById("stats-content");
  const empty = document.getElementById("stats-empty");

  if (cards.length === 0) {
    content.hidden = true;
    empty.hidden = false;
    return;
  }
  content.hidden = false;
  empty.hidden = true;

  const learnedCards = cards.filter((c) => c.learned);
  const notLearnedCards = cards.filter((c) => !c.learned);

  renderLead(cards.length, learnedCards.length, stats);
  renderBoxes(cards);
  renderHeatmap(stats.activity);

  document.getElementById("not-learned-count").textContent = notLearnedCards.length;
  document.getElementById("learned-count").textContent = learnedCards.length;
  renderWordList("not-learned-list", notLearnedCards);
  renderWordList("learned-list", learnedCards);
}

function renderLead(total, learned, stats) {
  const parts = [`Выучено ${learned} из ${total} ${pluralRu(total, "слова", "слов", "слов")}.`];
  if (stats.streak > 1) {
    parts.push(`Вы повторяете слова ${stats.streak} ${pluralRu(stats.streak, "день", "дня", "дней")} подряд.`);
  }
  parts.push(stats.reviewed_today
    ? `Сегодня повторено ${stats.reviewed_today} ${pluralRu(stats.reviewed_today, "карточка", "карточки", "карточек")}.`
    : "Сегодня повторений ещё не было.");
  document.getElementById("stats-lead").textContent = parts.join(" ");
}

function renderBoxes(cards) {
  const counts = Object.fromEntries(BOXES.map((b) => [b.key, 0]));
  cards.forEach((c) => counts[boxOf(c)]++);
  const max = Math.max(...Object.values(counts), 1);

  document.getElementById("boxes").innerHTML = BOXES.map((b) => {
    const n = counts[b.key];
    // Высота стопки пропорциональна числу карточек, но не больше 16 «листов».
    const sheets = n === 0 ? 0 : Math.max(2, Math.round((n / max) * 16));
    return `
      <figure class="box">
        <div class="box-well" aria-hidden="true">
          <div class="stack">${"<i></i>".repeat(sheets)}</div>
        </div>
        <figcaption>
          <span class="box-count">${n}</span>
          <span class="box-label">${b.label}</span>
          <span class="box-note">${b.note}</span>
        </figcaption>
      </figure>`;
  }).join("");
}

function heatLevel(count, max) {
  if (count === 0) return 0;
  const ratio = count / Math.max(max, 1);
  if (ratio > 0.75) return 4;
  if (ratio > 0.5) return 3;
  if (ratio > 0.25) return 2;
  return 1;
}

// Сетка как на GitHub: столбцы — недели, строки — дни недели (пн…вс).
function renderHeatmap(activity) {
  const heatmap = document.getElementById("heatmap");
  const max = Math.max(0, ...activity.map((d) => d.count));
  const totalReviews = activity.reduce((s, d) => s + d.count, 0);
  const activeDays = activity.filter((d) => d.count > 0).length;
  document.getElementById("activity-sub").textContent = totalReviews
    ? `За 15 недель ${totalReviews} ${pluralRu(totalReviews, "повторение", "повторения", "повторений")} в ${activeDays} ${pluralRu(activeDays, "день", "дня", "дней")}.`
    : "Повторений пока не было. Они появятся здесь после первого круга.";

  const first = new Date(activity[0].date + "T00:00:00");
  const offset = (first.getDay() + 6) % 7; // понедельник = 0
  const cells = [];
  for (let i = 0; i < offset; i++) cells.push(`<i class="cell-pad"></i>`);
  activity.forEach((d, i) => {
    const date = new Date(d.date + "T00:00:00");
    const label = date.toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
    const isToday = i === activity.length - 1;
    cells.push(
      `<i class="l${heatLevel(d.count, max)}${isToday ? " is-today" : ""}" title="${label}: ${d.count} ${pluralRu(d.count, "повторение", "повторения", "повторений")}"></i>`
    );
  });
  heatmap.innerHTML = cells.join("");
}

function renderWordList(containerId, cards) {
  const container = document.getElementById(containerId);
  if (cards.length === 0) {
    container.innerHTML = `<li class="word-list-empty">Пока ни одного слова</li>`;
    return;
  }
  container.innerHTML = [...cards]
    .sort((a, b) => a.word.localeCompare(b.word, "en"))
    .map((c) => `<li><b>${escapeHtml(c.word)}</b> <span>${escapeHtml(c.translation)}</span></li>`)
    .join("");
}

loadStats();
