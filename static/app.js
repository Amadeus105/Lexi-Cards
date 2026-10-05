const form = document.getElementById("add-form");
const input = document.getElementById("word-input");
const addBtn = document.getElementById("add-btn");
const errorBox = document.getElementById("error");
const emptyBox = document.getElementById("empty");
const grid = document.getElementById("grid");
const toolbar = document.getElementById("toolbar");
const searchInput = document.getElementById("search-input");
const filterChips = document.getElementById("filter-chips");
const sortSelect = document.getElementById("sort-select");
const gridCount = document.getElementById("grid-count");
const letterTabs = document.getElementById("letter-tabs");
const summary = document.getElementById("summary");

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

let allCards = [];
let filter = "all";
let sort = "new";
let query = "";
let letter = null; // null — все буквы

function showError(msg) {
  errorBox.textContent = msg;
  errorBox.hidden = false;
  clearTimeout(showError.timer);
  showError.timer = setTimeout(() => (errorBox.hidden = true), 8000);
}

function firstLetter(card) {
  return (card.word || "").trim().charAt(0).toUpperCase();
}

function cardTemplate(card) {
  const pos = POS_SHORT[card.part_of_speech] || "";
  const el = document.createElement("article");
  el.className = "index-card";
  el.dataset.id = card.id;
  el.dataset.pos = card.part_of_speech || "other";
  if (isDue(card)) el.classList.add("is-due");
  el.innerHTML = `
    <div class="card-inner" tabindex="0" role="button" aria-label="${escapeHtml(card.word)}: перевернуть карточку">
      <div class="card-face card-front">
        <div class="card-head">
          <h3 class="card-word">${escapeHtml(card.word)}</h3>
          ${pos ? `<span class="card-pos">${pos}</span>` : ""}
        </div>
        <div class="card-lines">
          ${card.transcription ? `<p class="card-transcription">${escapeHtml(card.transcription)}</p>` : ""}
        </div>
      </div>
      <div class="card-face card-back">
        <div class="card-head">
          <p class="card-translation">${escapeHtml(card.translation)}</p>
        </div>
        <div class="card-lines">
          <p class="card-example-en">${highlight(card.example_en, card.word)}</p>
          <p class="card-example-ru">${escapeHtml(card.example_ru)}</p>
          ${relatedBlock(card)}
        </div>
      </div>
    </div>
    <div class="card-actions">
      <button class="card-action card-speak" type="button" title="Произношение" aria-label="Произнести ${escapeHtml(card.word)}">
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 8v4h3l4 3V5L6 8H3zm10.5 2a3.5 3.5 0 0 0-2-3.2v6.4a3.5 3.5 0 0 0 2-3.2z"/></svg>
      </button>
      <button class="card-action card-delete" type="button" title="Удалить карточку" aria-label="Удалить ${escapeHtml(card.word)}">
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5.3 4 4 5.3 8.7 10 4 14.7 5.3 16l4.7-4.7 4.7 4.7 1.3-1.3L11.3 10 16 5.3 14.7 4 10 8.7z"/></svg>
      </button>
    </div>
  `;

  const inner = el.querySelector(".card-inner");
  const flip = () => inner.classList.toggle("flipped");
  inner.addEventListener("click", flip);
  inner.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.code === "Space") {
      e.preventDefault();
      flip();
    }
  });

  el.querySelector(".card-speak").addEventListener("click", () => speakWord(card.word));

  el.querySelector(".card-delete").addEventListener("click", async () => {
    if (!confirm(`Удалить карточку «${card.word}»? Это нельзя отменить.`)) return;
    const res = await fetch(`/api/cards/${card.id}`, { method: "DELETE" }).catch(() => null);
    if (!res || !res.ok) {
      showError(`Карточка «${card.word}» не удалена: сервер не ответил. Проверьте, что он запущен.`);
      return;
    }
    allCards = allCards.filter((c) => c.id !== card.id);
    render();
    updateSummary();
  });

  return el;
}

function visibleCards() {
  const q = query.trim().toLowerCase();
  const now = new Date();
  let list = allCards.filter((c) => {
    if (letter && firstLetter(c) !== letter) return false;
    if (filter === "due" && !isDue(c, now)) return false;
    if (filter === "learning" && c.learned) return false;
    if (filter === "learned" && !c.learned) return false;
    if (!q) return true;
    return (c.word || "").toLowerCase().includes(q) || (c.translation || "").toLowerCase().includes(q);
  });
  if (sort === "old") list = [...list].reverse();
  if (sort === "az") list = [...list].sort((a, b) => a.word.localeCompare(b.word, "en"));
  return list;
}

function renderLetterTabs() {
  const counts = {};
  allCards.forEach((c) => {
    const l = firstLetter(c);
    counts[l] = (counts[l] || 0) + 1;
  });
  const tab = (value, label, count) => {
    const selected = letter === value;
    return `<button type="button" role="tab" class="letter-tab" data-letter="${value ?? ""}"
      aria-selected="${selected}" ${count === 0 ? "disabled" : ""}
      title="${count ? countWords(count) : "нет слов"}">${label}<span>${count}</span></button>`;
  };
  letterTabs.innerHTML =
    tab(null, "Все", allCards.length) + ALPHABET.map((l) => tab(l, l, counts[l] || 0)).join("");
  letterTabs.hidden = allCards.length === 0;
}

function render() {
  const list = visibleCards();
  grid.innerHTML = "";
  list.forEach((c) => grid.appendChild(cardTemplate(c)));

  renderLetterTabs();
  toolbar.hidden = allCards.length === 0;
  emptyBox.hidden = allCards.length !== 0;

  if (allCards.length === 0) {
    gridCount.textContent = "";
  } else if (list.length === 0) {
    gridCount.textContent = "Под эти условия не подходит ни одна карточка.";
  } else if (list.length === allCards.length) {
    gridCount.textContent = `${list.length} ${pluralRu(list.length, "карточка", "карточки", "карточек")}. Нажмите на карточку, чтобы увидеть перевод.`;
  } else {
    gridCount.textContent = `Показано ${list.length} из ${allCards.length}.`;
  }
}

function updateSummary() {
  if (allCards.length === 0) return;
  const due = allCards.filter((c) => isDue(c)).length;
  summary.textContent = due
    ? `В картотеке ${countWords(allCards.length)}. ${countWords(due)} ${pluralRu(due, "ждёт", "ждут", "ждут")} повторения.`
    : `В картотеке ${countWords(allCards.length)}. Все повторены вовремя.`;
  updateNavDue();
}

async function loadCards() {
  try {
    const res = await fetch("/api/cards");
    if (!res.ok) throw new Error(res.status);
    allCards = await res.json();
  } catch {
    showError("Картотека не загрузилась: сервер не отвечает. Запустите его и обновите страницу.");
    return;
  }
  render();
  updateSummary();
}

// Если есть запятые/точки с запятой/переносы — делим только по ним (так можно
// добавлять фразы вроде «give up»), иначе — по пробелам.
function parseWords(raw) {
  const separator = /[,;\n]/.test(raw) ? /[,;\n]+/ : /\s+/;
  const seen = new Set();
  return raw
    .split(separator)
    .map((w) => w.trim().replace(/\s+/g, " "))
    .filter((w) => {
      const key = w.toLowerCase();
      if (!w || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

async function addOneWord(word) {
  const res = await fetch("/api/cards", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ word }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(typeof body.detail === "string" ? body.detail : `«${word}»: карточка не создана`);
  }
  return res.json();
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const words = parseWords(input.value);
  if (words.length === 0) return;

  addBtn.disabled = true;
  const label = addBtn.querySelector(".btn-label");
  const errors = [];
  let done = 0;
  const CONCURRENCY = 5;

  label.textContent = words.length > 1 ? `Готово 0 из ${words.length}` : "Создаю карточку…";

  async function worker(queue) {
    while (queue.length) {
      const word = queue.shift();
      try {
        const card = await addOneWord(word);
        allCards.unshift(card);
        render();
        const el = grid.querySelector(`[data-id="${card.id}"]`);
        if (el) el.classList.add("is-new");
      } catch (err) {
        errors.push(err.message);
      } finally {
        done++;
        if (words.length > 1) label.textContent = `Готово ${done} из ${words.length}`;
      }
    }
  }

  const queue = [...words];
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, queue.length) }, () => worker(queue))
  );

  if (errors.length) showError(errors.join(" "));

  input.value = "";
  input.focus();
  addBtn.disabled = false;
  label.textContent = "Добавить";
  updateSummary();
});

searchInput.addEventListener("input", () => {
  query = searchInput.value;
  render();
});

filterChips.querySelectorAll(".filter-chip").forEach((btn) => {
  btn.addEventListener("click", () => {
    filter = btn.dataset.filter;
    filterChips.querySelectorAll(".filter-chip").forEach((b) => b.setAttribute("aria-pressed", String(b === btn)));
    render();
  });
});

letterTabs.addEventListener("click", (e) => {
  const btn = e.target.closest(".letter-tab");
  if (!btn || btn.disabled) return;
  letter = btn.dataset.letter || null;
  render();
});

sortSelect.addEventListener("change", () => {
  sort = sortSelect.value;
  render();
});

loadCards();
