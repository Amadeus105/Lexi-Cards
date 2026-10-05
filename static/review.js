const directionSelect = document.getElementById("direction-select");
const countSelect = document.getElementById("count-select");
const backToDirectionBtn = document.getElementById("back-to-direction-btn");
const scopeToggle = document.getElementById("scope-toggle");
const countGrid = document.getElementById("count-grid");
const reviewSession = document.getElementById("review-session");
const settingsLabel = document.getElementById("review-settings-label");
const changeSettingsBtn = document.getElementById("change-settings-btn");
const progressEl = document.getElementById("progress");
const progressFill = document.getElementById("progress-fill");
const cardArea = document.getElementById("review-card-area");
const emptyState = document.getElementById("review-empty");
const dueBanner = document.getElementById("due-banner");
const kbdHint = document.getElementById("kbd-hint");

const COUNT_OPTIONS = [10, 20, 30, 40, 50];
const DIRECTION_LABEL = { "en-ru": "английский — русский", "ru-en": "русский — английский", audio: "на слух" };
const MODE_LABEL = { flip: "переворот", type: "письменно", dictation: "диктант" };
const SCOPE_LABEL = { due: "пора повторить", all: "все слова", today: "добавленные сегодня" };
const GRADES = [
  { key: "again", label: "Забыл", cls: "grade-again" },
  { key: "hard", label: "Трудно", cls: "grade-hard" },
  { key: "good", label: "Помню", cls: "grade-good" },
  { key: "easy", label: "Легко", cls: "grade-easy" },
];

let fullDeck = [];
let queue = [];
let direction = null;
let reviewSize = null;
let reviewMode = "flip"; // "flip" | "type"
let reviewScope = "due"; // "due" | "all" | "today"
let cycleTotal = 0;
let finished = new Set();
let tally = { again: 0, hard: 0, good: 0, easy: 0 };
let keyHandler = null; // клавиатурные сокращения текущей карточки

// ---------- helpers ----------

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function normalize(str) {
  return (str || "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .trim()
    .replace(/[.,!?;:"'()«»]/g, "")
    .replace(/\s+/g, " ");
}

function isAnswerCorrect(userInput, target) {
  const normUser = normalize(userInput);
  if (!normUser) return false;
  const variants = (target || "")
    .split(/[,;/]/)
    .map(normalize)
    .filter(Boolean);
  return variants.includes(normUser);
}

function isToday(dateStr) {
  const d = parseUtc(dateStr);
  return d ? isSameLocalDay(d, new Date()) : false;
}

// Повторяет логику app/srs.py, чтобы подписать кнопки ожидаемым интервалом.
function previewInterval(card, grade) {
  const ef = card.ease_factor || 2.5;
  const interval = card.interval_days || 0;
  const reps = card.repetitions || 0;
  if (grade === "again") return null;
  if (grade === "hard") return Math.max(1, interval * 1.2);
  if (grade === "good") return reps === 0 ? 1 : reps === 1 ? 6 : interval * ef;
  return reps > 0 ? Math.max(interval, 1) * (ef + 0.15) * 1.3 : 4;
}

function formatInterval(days) {
  if (days == null) return "через 10 мин";
  const d = Math.round(days);
  if (days < 30) return `через ${d} ${pluralRu(d, "день", "дня", "дней")}`;
  const m = Math.round(days / 30);
  if (days < 365) return `через ${m} мес.`;
  return `через ${(days / 365).toFixed(1)} г.`;
}

function scopedDeck(scope = reviewScope) {
  const now = new Date();
  if (scope === "today") return fullDeck.filter((c) => isToday(c.created_at));
  if (scope === "due") return fullDeck.filter((c) => isDue(c, now));
  return fullDeck;
}

function setKeys(handler) {
  keyHandler = handler;
}

document.addEventListener("keydown", (e) => {
  if (!keyHandler || reviewSession.hidden) return;
  // Пробел/Enter на кнопке пусть обрабатывает сама кнопка.
  if (e.target.tagName === "BUTTON" && (e.code === "Space" || e.key === "Enter")) return;
  keyHandler(e);
});

// ---------- screens ----------

directionSelect.querySelectorAll(".mode-option").forEach((btn) => {
  btn.addEventListener("click", () => {
    direction = btn.dataset.direction;
    reviewMode = btn.dataset.mode || "flip";
    showCountSelect();
  });
});

backToDirectionBtn.addEventListener("click", showDirectionSelect);
changeSettingsBtn.addEventListener("click", showDirectionSelect);

scopeToggle.querySelectorAll(".scope-btn").forEach((btn) => {
  btn.addEventListener("click", () => selectScope(btn.dataset.scope));
});

function selectScope(scope) {
  reviewScope = scope;
  scopeToggle.querySelectorAll(".scope-btn").forEach((b) => {
    b.setAttribute("aria-pressed", String(b.dataset.scope === scope));
  });
  renderCountOptions();
}

async function loadDeck() {
  emptyState.hidden = false;
  emptyState.querySelector(".empty-text").textContent = "Загрузка…";
  emptyState.querySelector(".empty-actions").innerHTML = "";

  try {
    const res = await fetch("/api/cards");
    if (!res.ok) throw new Error(`сервер ответил ${res.status}`);
    fullDeck = await res.json();
  } catch (err) {
    showLoadError(err.message);
    return;
  }

  if (fullDeck.length === 0) {
    showNoCards();
    return;
  }

  showDirectionSelect();
}

function showLoadError(message) {
  directionSelect.hidden = true;
  countSelect.hidden = true;
  reviewSession.hidden = true;
  emptyState.hidden = false;
  emptyState.querySelector(".empty-text").textContent =
    `Картотека не загрузилась (${message}). Запустите сервер и обновите страницу.`;
  emptyState.querySelector(".empty-actions").innerHTML = "";
}

function showDirectionSelect() {
  setKeys(null);
  reviewSession.hidden = true;
  emptyState.hidden = true;
  countSelect.hidden = true;
  directionSelect.hidden = false;

  const due = scopedDeck("due").length;
  dueBanner.textContent = due
    ? `${countWords(due)} ${pluralRu(due, "ждёт", "ждут", "ждут")} повторения. Выберите, как повторять.`
    : "Все слова повторены вовремя. Можно повторить любые для закрепления.";
}

function renderCountOptions() {
  const deck = scopedDeck();
  const total = deck.length;
  countGrid.innerHTML = "";

  if (total === 0) {
    const msg = reviewScope === "due"
      ? "Сейчас повторять нечего: Lexi напомнит, когда придёт время. Можно выбрать «Все слова»."
      : "Сегодня новых слов нет. Добавьте их в картотеку или выберите «Все слова».";
    countGrid.innerHTML = `<p class="count-empty">${msg}</p>`;
    return;
  }

  COUNT_OPTIONS.filter((n) => total > n).forEach((n) => {
    const btn = document.createElement("button");
    btn.className = "count-option";
    btn.type = "button";
    btn.dataset.count = String(n);
    btn.innerHTML = `<b>${n}</b>`;
    countGrid.appendChild(btn);
  });

  const allBtn = document.createElement("button");
  allBtn.className = "count-option count-option-all";
  allBtn.type = "button";
  allBtn.dataset.count = "all";
  allBtn.innerHTML = `<b>${total}</b> все`;
  countGrid.appendChild(allBtn);

  countGrid.querySelectorAll(".count-option").forEach((btn) => {
    btn.addEventListener("click", () => {
      reviewSize = btn.dataset.count === "all" ? total : parseInt(btn.dataset.count, 10);
      startCycle();
    });
  });
}

function showCountSelect() {
  if (fullDeck.length === 0) {
    showNoCards();
    return;
  }
  directionSelect.hidden = true;
  emptyState.hidden = true;

  scopeToggle.querySelectorAll("[data-count-for]").forEach((el) => {
    el.textContent = scopedDeck(el.dataset.countFor).length;
  });
  selectScope(scopedDeck("due").length > 0 ? "due" : "all");
  countSelect.hidden = false;
}

function startCycle() {
  const deck = scopedDeck();
  if (deck.length === 0) {
    showCountSelect();
    return;
  }
  directionSelect.hidden = true;
  countSelect.hidden = true;
  emptyState.hidden = true;
  reviewSession.hidden = false;

  // В режиме «пора повторить» сначала просроченные, потом новые.
  const size = reviewSize == null ? deck.length : Math.min(reviewSize, deck.length);
  const ordered = reviewScope === "due"
    ? shuffle(deck).sort((a, b) => (a.due_at ? 0 : 1) - (b.due_at ? 0 : 1))
    : shuffle(deck);
  queue = shuffle(ordered.slice(0, size));
  cycleTotal = queue.length;
  finished = new Set();
  tally = { again: 0, hard: 0, good: 0, easy: 0 };

  settingsLabel.textContent =
    `${DIRECTION_LABEL[direction]}, ${MODE_LABEL[reviewMode]}, ${SCOPE_LABEL[reviewScope]}`;

  updateProgress();
  showCurrentCard();
}

function showNoCards() {
  directionSelect.hidden = true;
  countSelect.hidden = true;
  reviewSession.hidden = true;
  emptyState.hidden = false;
  emptyState.querySelector(".empty-text").textContent =
    "В картотеке пока нет карточек. Добавьте слова, и их можно будет повторять.";
  emptyState.querySelector(".empty-actions").innerHTML =
    `<a href="/" class="btn btn-pencil">Добавить слова</a>`;
}

function showCycleDone() {
  setKeys(null);
  reviewSession.hidden = true;
  emptyState.hidden = false;
  const remembered = tally.good + tally.easy;
  const totalGrades = remembered + tally.hard + tally.again;
  const accuracy = totalGrades ? Math.round((remembered / totalGrades) * 100) : 0;
  emptyState.querySelector(".empty-text").innerHTML = `
    <div class="done-card">
      <div class="done-stamp" aria-hidden="true">Повторено</div>
      <h1 class="done-title">${countWords(cycleTotal)} повторено</h1>
      <p class="done-sub">Верных ответов: ${accuracy}%.</p>
      <dl class="done-tally">
        <div class="grade-again"><dt>Забыл</dt><dd>${tally.again}</dd></div>
        <div class="grade-hard"><dt>Трудно</dt><dd>${tally.hard}</dd></div>
        <div class="grade-good"><dt>Помню</dt><dd>${tally.good}</dd></div>
        <div class="grade-easy"><dt>Легко</dt><dd>${tally.easy}</dd></div>
      </dl>
    </div>`;
  emptyState.querySelector(".empty-actions").innerHTML = `
    <button id="restart-btn" class="btn btn-pencil" type="button">Повторить ещё</button>
    <button id="switch-settings-btn" class="btn btn-quiet" type="button">Выбрать другой режим</button>
    <a href="/stats" class="btn btn-quiet">Открыть статистику</a>
  `;
  document.getElementById("restart-btn").addEventListener("click", startCycle);
  document.getElementById("switch-settings-btn").addEventListener("click", showDirectionSelect);
}

function updateProgress() {
  const done = finished.size;
  progressEl.textContent = `${done} из ${cycleTotal}`;
  progressFill.style.width = cycleTotal ? `${(done / cycleTotal) * 100}%` : "0%";
}

function showCurrentCard() {
  if (queue.length === 0) {
    showCycleDone();
    return;
  }
  // Иначе фокус остаётся на скрытой кнопке, и пробел нажимает её повторно.
  if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
  const card = queue[0];
  if (reviewMode === "type" || reviewMode === "dictation") renderTypeCard(card);
  else renderFlipCard(card);
}

// ---------- flip mode ----------

function renderFlipCard(card) {
  const isReversed = direction === "ru-en";
  const pos = POS_SHORT[card.part_of_speech] || "";

  const front = isReversed
    ? `<div class="card-head"><p class="card-translation">${escapeHtml(card.translation)}</p></div>
       <div class="card-lines"><p class="card-cue">Как это по-английски?</p></div>`
    : `<div class="card-head"><h2 class="card-word">${escapeHtml(card.word)}</h2>${pos ? `<span class="card-pos">${pos}</span>` : ""}</div>
       <div class="card-lines">${card.transcription ? `<p class="card-transcription">${escapeHtml(card.transcription)}</p>` : ""}</div>`;

  const backHead = isReversed
    ? `<div class="card-head"><h2 class="card-word">${escapeHtml(card.word)}</h2>${pos ? `<span class="card-pos">${pos}</span>` : ""}</div>`
    : `<div class="card-head"><p class="card-translation">${escapeHtml(card.translation)}</p></div>`;

  const backLines = `
    <div class="card-lines">
      ${isReversed && card.transcription ? `<p class="card-transcription">${escapeHtml(card.transcription)}</p>` : ""}
      <p class="card-example-en">${highlight(card.example_en, card.word)}</p>
      <p class="card-example-ru">${escapeHtml(card.example_ru)}</p>
      ${relatedBlock(card)}
    </div>`;

  const gradeButtons = GRADES.map((g, i) => `
    <button class="grade-btn ${g.cls}" data-grade="${g.key}" type="button">
      <span class="grade-label"><kbd>${i + 1}</kbd>${g.label}</span>
      <span class="grade-meta">${formatInterval(previewInterval(card, g.key))}</span>
    </button>`).join("");

  cardArea.innerHTML = `
    <article class="index-card review-card" data-pos="${escapeHtml(card.part_of_speech || "other")}">
      <div class="card-inner" id="review-card-inner">
        <div class="card-face card-front">${front}</div>
        <div class="card-face card-back">${backHead}${backLines}</div>
      </div>
      <div class="card-actions">
        <button class="card-action card-speak" type="button" title="Произношение" aria-label="Произнести слово">
          <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 8v4h3l4 3V5L6 8H3zm10.5 2a3.5 3.5 0 0 0-2-3.2v6.4a3.5 3.5 0 0 0 2-3.2z"/></svg>
        </button>
      </div>
    </article>
    <button id="reveal-btn" class="btn btn-quiet reveal-btn" type="button">Показать ответ</button>
    <div id="grade-row" class="grade-row" hidden>${gradeButtons}</div>
  `;

  const inner = document.getElementById("review-card-inner");
  const gradeRow = document.getElementById("grade-row");
  const revealBtn = document.getElementById("reveal-btn");

  function flip() {
    inner.classList.toggle("flipped");
    const shown = inner.classList.contains("flipped");
    gradeRow.hidden = !shown;
    revealBtn.hidden = shown;
  }

  inner.addEventListener("click", flip);
  revealBtn.addEventListener("click", flip);
  cardArea.querySelector(".card-speak").addEventListener("click", () => speakWord(card.word));

  gradeRow.querySelectorAll(".grade-btn").forEach((btn) => {
    btn.addEventListener("click", () => handleGrade(btn.dataset.grade));
  });

  kbdHint.innerHTML = `<kbd>Пробел</kbd> перевернуть, <kbd>1</kbd>–<kbd>4</kbd> оценить, <kbd>S</kbd> произнести`;
  setKeys((e) => {
    if (e.code === "Space" || e.key === "Enter") {
      e.preventDefault();
      flip();
    } else if (/^[1-4]$/.test(e.key) && !gradeRow.hidden) {
      handleGrade(GRADES[Number(e.key) - 1].key);
    } else if (e.key.toLowerCase() === "s" || e.key.toLowerCase() === "ы") {
      speakWord(card.word);
    }
  });
}

// ---------- type mode ----------

function renderTypeCard(card) {
  // В диктанте слово не показывается: его нужно услышать и написать.
  const isDictation = reviewMode === "dictation";
  const isReversed = direction === "ru-en";
  const frontMain = isReversed ? card.translation : card.word;
  const frontSub = isReversed ? "" : (card.transcription || "");
  const targetAnswer = isReversed || isDictation ? card.word : card.translation;
  const promptLabel = isDictation
    ? "Напишите услышанное слово"
    : isReversed ? "Напишите это слово по-английски" : "Напишите перевод на русский";

  const head = isDictation
    ? `<div class="listen-row">
         <button id="listen-btn" class="btn btn-pencil btn-sm" type="button">Прослушать</button>
         <button id="listen-slow-btn" class="btn btn-quiet btn-sm" type="button">Медленнее</button>
       </div>`
    : `<h2 class="card-word">${escapeHtml(frontMain)}</h2>`;

  cardArea.innerHTML = `
    <div class="cat-perch" id="cat-perch"></div>
    <article class="type-card" data-pos="${escapeHtml(card.part_of_speech || "other")}">
      <div class="card-head" id="type-head">${head}</div>
      <div class="card-lines">
        ${frontSub && !isDictation ? `<p class="card-transcription">${escapeHtml(frontSub)}</p>` : ""}
        <form id="type-form" class="type-form" autocomplete="off">
          <label for="type-input">${promptLabel}</label>
          <div class="type-row">
            <input id="type-input" type="text" />
            <button type="submit" class="btn btn-pencil btn-sm">Проверить</button>
          </div>
        </form>
        <button id="type-dontknow-btn" class="link-btn" type="button">Не помню, показать ответ</button>
        <div id="type-feedback" class="type-feedback" role="status" hidden></div>
        <div id="type-details" hidden></div>
      </div>
    </article>
  `;

  const form = document.getElementById("type-form");
  const input = document.getElementById("type-input");
  const dontKnowBtn = document.getElementById("type-dontknow-btn");
  const feedback = document.getElementById("type-feedback");
  const details = document.getElementById("type-details");
  const typeCard = cardArea.querySelector(".type-card");

  input.focus();
  // Кот спит, пока вы не начали печатать, и просыпается, когда начали.
  LexiCat.mount(document.getElementById("cat-perch"));
  LexiCat.setPose("lie");
  LexiCat.setMood("sleep");
  input.addEventListener("input", () => {
    LexiCat.setMood(input.value.trim() ? "watch" : "sleep");
  });
  kbdHint.innerHTML = `<kbd>Enter</kbd> проверить, ещё раз <kbd>Enter</kbd> перейти к следующей`;
  setKeys(null);

  if (isDictation) {
    document.getElementById("listen-btn").addEventListener("click", () => {
      speakWord(card.word);
      input.focus();
    });
    document.getElementById("listen-slow-btn").addEventListener("click", () => {
      speakWord(card.word, 0.6);
      input.focus();
    });
    speakWord(card.word);
  }

  function reveal(userAnswer) {
    const correct = isAnswerCorrect(userAnswer, targetAnswer);
    const grade = correct ? "good" : "again";
    LexiCat.setMood(correct ? "happy" : "sad");

    form.querySelector("button").disabled = true;
    input.disabled = true;
    dontKnowBtn.hidden = true;
    typeCard.classList.add(correct ? "is-correct" : "is-incorrect");

    feedback.hidden = false;
    feedback.className = `type-feedback ${correct ? "is-correct" : "is-incorrect"}`;
    if (isDictation) {
      // Показываем само слово, раз его не было видно.
      document.getElementById("type-head").innerHTML = `
        <h2 class="card-word">${escapeHtml(card.word)}</h2>
        <p class="card-translation dictation-translation">${escapeHtml(card.translation)}</p>`;
    }
    feedback.innerHTML = correct
      ? "Верно."
      : `Правильный ответ: <b>${escapeHtml(targetAnswer)}</b>`;

    details.hidden = false;
    details.innerHTML = `
      <p class="card-example-en">${highlight(card.example_en, card.word)}</p>
      <p class="card-example-ru">${escapeHtml(card.example_ru)}</p>
      ${relatedBlock(card)}
      <div class="type-actions">
        <button id="type-speak-btn" class="btn btn-quiet btn-sm" type="button">Произнести</button>
        <button id="type-next-btn" class="btn btn-pencil btn-sm" type="button">Следующая карточка</button>
      </div>
    `;

    document.getElementById("type-speak-btn").addEventListener("click", () => speakWord(card.word));
    document.getElementById("type-next-btn").addEventListener("click", () => handleGrade(grade));
    // Enter, нажатый для проверки, не должен сразу же пролистнуть карточку.
    setTimeout(() => {
      setKeys((e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          handleGrade(grade);
        }
      });
    }, 0);
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    reveal(input.value);
  });

  dontKnowBtn.addEventListener("click", () => reveal(""));
}

// ---------- grading ----------

function handleGrade(grade) {
  const card = queue.shift();
  setKeys(null);
  tally[grade]++;

  fetch(`/api/cards/${card.id}/review`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ grade }),
  })
    .then((res) => (res.ok ? res.json() : null))
    .then((updated) => {
      if (!updated) return;
      const idx = fullDeck.findIndex((c) => c.id === updated.id);
      if (idx !== -1) fullDeck[idx] = updated;
      Object.assign(card, updated);
    })
    .catch(() => {});

  if (grade === "again") {
    // Забытое слово вернётся через пару карточек.
    queue.splice(Math.min(queue.length, 3), 0, card);
  } else {
    finished.add(card.id);
  }

  updateProgress();
  showCurrentCard();
}

loadDeck();
