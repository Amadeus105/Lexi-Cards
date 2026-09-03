async function loadStats() {
  const res = await fetch("/api/cards");
  const cards = await res.json();

  const content = document.getElementById("stats-content");
  const empty = document.getElementById("stats-empty");

  if (cards.length === 0) {
    content.hidden = true;
    empty.hidden = false;
    return;
  }

  content.hidden = false;
  empty.hidden = true;

  const total = cards.length;
  const learnedCards = cards.filter((c) => c.learned);
  const notLearnedCards = cards.filter((c) => !c.learned);
  const learned = learnedCards.length;
  const percent = total ? Math.round((learned / total) * 100) : 0;

  document.getElementById("stats-fraction").textContent = `${learned} / ${total}`;
  document.getElementById("stats-percent").textContent = `${percent}%`;
  document.getElementById("stats-bar-fill").style.width = `${percent}%`;

  document.getElementById("stat-total").textContent = total;
  document.getElementById("stat-learned").textContent = learned;
  document.getElementById("stat-not-learned").textContent = notLearnedCards.length;

  renderChipList("not-learned-list", notLearnedCards, false);
  renderChipList("learned-list", learnedCards, true);
}

function renderChipList(containerId, cards, isLearned) {
  const container = document.getElementById(containerId);
  if (cards.length === 0) {
    container.innerHTML = `<div class="word-chip-empty">Пока пусто</div>`;
    return;
  }
  container.innerHTML = cards
    .map(
      (c) =>
        `<span class="word-chip${isLearned ? " is-learned" : ""}">${c.word}</span>`
    )
    .join("");
}

loadStats();