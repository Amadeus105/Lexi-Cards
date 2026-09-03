const form = document.getElementById("add-form");
const input = document.getElementById("word-input");
const addBtn = document.getElementById("add-btn");
const errorBox = document.getElementById("error");
const emptyBox = document.getElementById("empty");
const grid = document.getElementById("grid");

const POS_LABEL = {
  noun: "сущ.",
  verb: "гл.",
  adjective: "прил.",
  adverb: "нареч.",
  phrase: "выраж.",
  other: "",
};

function showError(msg) {
  errorBox.textContent = msg;
  errorBox.hidden = false;
  setTimeout(() => (errorBox.hidden = true), 5000);
}

function highlight(sentence, word) {
  if (!sentence || !word) return sentence || "";
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return sentence.replace(new RegExp(`(${escaped})`, "i"), "<b>$1</b>");
}

function cardTemplate(card) {
  const letter = (card.word || "?").charAt(0).toUpperCase();
  const el = document.createElement("div");
  el.className = "card-outer";
  el.dataset.id = card.id;
  el.innerHTML = `
    <button class="card-delete" title="Удалить">✕</button>
    <div class="card-inner">
      <div class="card-face">
        <div class="card-tab">${letter}</div>
        <div class="card-front-body">
          <div class="card-word">${card.word}</div>
          ${card.transcription ? `<div class="card-transcription">${card.transcription}</div>` : ""}
          ${POS_LABEL[card.part_of_speech] ? `<div class="card-pos">${POS_LABEL[card.part_of_speech]}</div>` : ""}
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
  `;

  el.querySelector(".card-inner").addEventListener("click", () => {
    el.querySelector(".card-inner").classList.toggle("flipped");
  });
  el.querySelector(".card-delete").addEventListener("click", async (e) => {
    e.stopPropagation();
    await fetch(`/api/cards/${card.id}`, { method: "DELETE" });
    el.remove();
    toggleEmpty();
  });

  return el;
}

function toggleEmpty() {
  emptyBox.hidden = grid.children.length !== 0;
}

async function loadCards() {
  const res = await fetch("/api/cards");
  const cards = await res.json();
  grid.innerHTML = "";
  cards.forEach((c) => grid.appendChild(cardTemplate(c)));
  toggleEmpty();
}

function parseWords(raw) {
  return raw
    .split(/[,;\n]+|\s{1,}/)
    .map((w) => w.trim())
    .filter(Boolean);
}

async function addOneWord(word) {
  const res = await fetch("/api/cards", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ word }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `«${word}»: не получилось создать карточку`);
  }
  return res.json();
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const words = parseWords(input.value);
  if (words.length === 0) return;

  addBtn.disabled = true;
  const errors = [];
  let done = 0;
  const CONCURRENCY = 5; // не грузим бесплатный тариф Gemini слишком сильно

  addBtn.querySelector(".btn-label").textContent =
    words.length > 1 ? `Генерирую 0 из ${words.length}…` : "Генерирую…";

  async function worker(queue) {
    while (queue.length) {
      const word = queue.shift();
      try {
        const card = await addOneWord(word);
        grid.prepend(cardTemplate(card));
        toggleEmpty();
      } catch (err) {
        errors.push(err.message);
      } finally {
        done++;
        if (words.length > 1) {
          addBtn.querySelector(".btn-label").textContent = `Генерирую ${done} из ${words.length}…`;
        }
      }
    }
  }

  const queue = [...words];
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, queue.length) }, () => worker(queue))
  );

  if (errors.length) {
    showError(errors.join("; "));
  }

  input.value = "";
  input.focus();
  addBtn.disabled = false;
  addBtn.querySelector(".btn-label").textContent = "Добавить";
});

loadCards();