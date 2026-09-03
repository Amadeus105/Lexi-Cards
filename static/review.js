const progressEl = document.getElementById("progress");
const cardArea = document.getElementById("review-card-area");
const emptyState = document.getElementById("review-empty");

let fullDeck = [];
let queue = [];

function highlight(sentence, word) {
  if (!sentence || !word) return sentence || "";
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return sentence.replace(new RegExp(`(${escaped})`, "i"), "<b>$1</b>");
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

async function loadDeck() {
  const res = await fetch("/api/cards");
  fullDeck = await res.json();

  if (fullDeck.length === 0) {
    showNoCards();
    return;
  }

  startCycle();
}

function startCycle() {
  queue = shuffle(fullDeck);
  updateProgress();
  showCurrentCard();
}

function showNoCards() {
  cardArea.hidden = true;
  emptyState.hidden = false;
  progressEl.textContent = "";
  emptyState.querySelector(".empty-text").textContent =
    "В картотеке пока нет карточек — добавьте слова на главной странице.";
  emptyState.querySelector(".empty-actions").innerHTML =
    `<a href="/#app" class="btn btn-primary">Добавить слова</a>`;
}

function showCycleDone() {
  cardArea.hidden = true;
  emptyState.hidden = false;
  progressEl.textContent = "";
  emptyState.querySelector(".empty-text").textContent = "Круг пройден! Все слова были «Легко». 🎉";
  emptyState.querySelector(".empty-actions").innerHTML =
    `<button id="restart-btn" class="btn btn-primary">Повторить снова</button>`;
  document.getElementById("restart-btn").addEventListener("click", startCycle);
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
  cardArea.hidden = false;
  emptyState.hidden = true;

  const letter = (card.word || "?").charAt(0).toUpperCase();
  cardArea.innerHTML = `
    <div class="card-outer review-card-outer">
      <div class="card-inner" id="review-card-inner">
        <div class="card-face">
          <div class="card-tab">${letter}</div>
          <div class="card-front-body">
            <div class="card-word">${card.word}</div>
            ${card.transcription ? `<div class="card-transcription">${card.transcription}</div>` : ""}
          </div>
          <div class="card-hint">нажмите, чтобы перевернуть</div>
        </div>
        <div class="card-face card-back">
          <div class="card-translation">${card.translation}</div>
          <div class="card-example-wrap">
            <div class="card-example-label">Пример использования</div>
            <div class="card-example-en">${highlight(card.example_en, card.word)}</div>
            <div class="card-example-ru">${card.example_ru || ""}</div>
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
  }).catch(() => {
    // не блокируем сессию, если запрос не прошёл
  });

  if (grade === "hard") {
    const pos = Math.min(queue.length, 3);
    queue.splice(pos, 0, card);
  }

  updateProgress();
  showCurrentCard();
}

loadDeck();