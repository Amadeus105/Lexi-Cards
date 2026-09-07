const directionSelect = document.getElementById("direction-select");
const reviewSession = document.getElementById("review-session");
const changeDirectionBtn = document.getElementById("change-direction-btn");
const progressEl = document.getElementById("progress");
const cardArea = document.getElementById("review-card-area");
const emptyState = document.getElementById("review-empty");

let fullDeck = [];
let queue = [];
let direction = null;

function highlight(sentence, word) {
  if (!sentence || !word) return sentence || "";
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return sentence.replace(new RegExp(`(${escaped})`, "i"), "<b>$1</b>");
}

function speakWord(word) {
  if (!("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(word);
  utter.lang = "en-US";
  utter.rate = 0.95;
  window.speechSynthesis.speak(utter);
}

function chipList(items) {
  if (!items || items.length === 0) return "";
  return items.map((w) => `<span class="mini-chip">${w}</span>`).join("");
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

directionSelect.querySelectorAll(".direction-card").forEach((btn) => {
  btn.addEventListener("click", () => {
    direction = btn.dataset.direction;
    startCycle();
  });
});

changeDirectionBtn.addEventListener("click", () => {
  showDirectionSelect();
});

async function loadDeck() {
  emptyState.hidden = false;
  emptyState.querySelector(".empty-text").textContent = "Загрузка…";
  emptyState.querySelector(".empty-actions").innerHTML = "";

  try {
    const res = await fetch("/api/cards");
    if (!res.ok) throw new Error(`Сервер ответил ${res.status}`);
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
  reviewSession.hidden = true;
  emptyState.hidden = false;
  emptyState.querySelector(".empty-text").textContent =
    `Не удалось загрузить картотеку: ${message}. Проверьте, что сервер запущен, и обновите страницу.`;
  emptyState.querySelector(".empty-actions").innerHTML = "";
}

function showDirectionSelect() {
  reviewSession.hidden = true;
  emptyState.hidden = true;
  directionSelect.hidden = false;
}

function startCycle() {
  if (fullDeck.length === 0) {
    showNoCards();
    return;
  }
  directionSelect.hidden = true;
  emptyState.hidden = true;
  reviewSession.hidden = false;

  queue = shuffle(fullDeck);
  updateProgress();
  showCurrentCard();
}

function showNoCards() {
  directionSelect.hidden = true;
  reviewSession.hidden = true;
  emptyState.hidden = false;
  emptyState.querySelector(".empty-text").textContent =
    "В картотеке пока нет карточек — добавьте слова на главной странице.";
  emptyState.querySelector(".empty-actions").innerHTML =
    `<a href="/#app" class="btn btn-primary">Добавить слова</a>`;
}

function showCycleDone() {
  reviewSession.hidden = true;
  emptyState.hidden = false;
  emptyState.querySelector(".empty-text").textContent = "Круг пройден! Все слова были «Легко». 🎉";
  emptyState.querySelector(".empty-actions").innerHTML = `
    <button id="restart-btn" class="btn btn-primary">Повторить снова</button>
    <button id="switch-dir-btn" class="btn btn-ghost">Сменить направление</button>
  `;
  document.getElementById("restart-btn").addEventListener("click", startCycle);
  document.getElementById("switch-dir-btn").addEventListener("click", () => {
    emptyState.hidden = true;
    showDirectionSelect();
  });
}

function updateProgress() {
  progressEl.textContent = `Осталось в этом круге: ${queue.length}`;
}

function showCurrentCard() {
  if (queue.length === 0) {
    showCycleDone();
    return;
  }
  const card = queue[0];

  const isReversed = direction === "ru-en";

  const frontMain = isReversed ? card.translation : card.word;
  const frontSub = isReversed ? "" : (card.transcription || "");
  const letter = (frontMain || "?").charAt(0).toUpperCase();

  const backHeadline = isReversed
    ? `<div class="card-word review-back-word">${card.word}</div>${card.transcription ? `<div class="card-transcription">${card.transcription}</div>` : ""}`
    : `<div class="card-translation">${card.translation}</div>`;

  const frontSpeak = isReversed ? "" : `<button class="card-speak" title="Произношение">🔊</button>`;
  const backSpeak = isReversed ? `<button class="card-speak" title="Произношение">🔊</button>` : "";

  const synonymsBlock = card.synonyms && card.synonyms.length
    ? `<div class="mini-label">Синонимы</div><div class="mini-chips">${chipList(card.synonyms)}</div>` : "";
  const antonymsBlock = card.antonyms && card.antonyms.length
    ? `<div class="mini-label">Антонимы</div><div class="mini-chips">${chipList(card.antonyms)}</div>` : "";

  cardArea.innerHTML = `
    <div class="card-outer review-card-outer">
      <div class="card-inner" id="review-card-inner">
        <div class="card-face">
          <div class="card-tab">${letter}</div>
          ${frontSpeak}
          <div class="card-front-body">
            <div class="card-word">${frontMain}</div>
            ${frontSub ? `<div class="card-transcription">${frontSub}</div>` : ""}
          </div>
          <div class="card-hint">нажмите, чтобы перевернуть</div>
        </div>
        <div class="card-face card-back">
          ${backSpeak}
          ${backHeadline}
          <div class="card-example-wrap">
            <div class="card-example-label">Пример использования</div>
            <div class="card-example-en">${highlight(card.example_en, card.word)}</div>
            <div class="card-example-ru">${card.example_ru || ""}</div>
            ${synonymsBlock}
            ${antonymsBlock}
          </div>
        </div>
      </div>
    </div>
    <div id="grade-row" class="grade-row" hidden>
      <button class="grade-btn grade-hard" data-grade="hard">Трудно</button>
      <button class="grade-btn grade-easy" data-grade="easy">Легко</button>
    </div>
  `;

  const inner = document.getElementById("review-card-inner");
  const gradeRow = document.getElementById("grade-row");

  inner.addEventListener("click", () => {
    inner.classList.toggle("flipped");
    gradeRow.hidden = !inner.classList.contains("flipped");
  });

  cardArea.querySelectorAll(".card-speak").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      speakWord(card.word);
    });
  });

  gradeRow.querySelectorAll(".grade-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      handleGrade(btn.dataset.grade);
    });
  });
}

function handleGrade(grade) {
  const card = queue.shift();

  fetch(`/api/cards/${card.id}/learned`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ learned: grade === "easy" }),
  }).catch(() => {});

  if (grade === "hard") {
    const pos = Math.min(queue.length, 3);
    queue.splice(pos, 0, card);
  }

  updateProgress();
  showCurrentCard();
}

loadDeck();