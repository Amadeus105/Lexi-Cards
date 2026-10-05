// Общие помощники для всех страниц Lexi.

// Часовой пояс — чтобы «сегодня» и серия дней считались по вашему времени, а не по серверу.
document.cookie = `lexi_tz=${-new Date().getTimezoneOffset()}; path=/; max-age=31536000; SameSite=Lax`;

// Сессия закончилась — на любой запрос сервер ответит 401, и мы отправляем на вход.
const ON_LOGIN_PAGE = location.pathname.startsWith("/login");
const nativeFetch = window.fetch.bind(window);
window.fetch = async (...args) => {
  const res = await nativeFetch(...args);
  if (res.status === 401 && !ON_LOGIN_PAGE) location.href = "/login";
  return res;
};

const REDUCED_MOTION = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const POS_SHORT = {
  noun: "сущ.",
  verb: "гл.",
  adjective: "прил.",
  adverb: "нареч.",
  phrase: "выраж.",
  other: "",
};

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Экранирует предложение и выделяет в нём изучаемое слово.
function highlight(sentence, word) {
  const safe = escapeHtml(sentence);
  if (!safe || !word) return safe;
  const escaped = escapeHtml(word).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return safe.replace(new RegExp(`(${escaped})`, "i"), "<b>$1</b>");
}

function speakWord(word, rate = 0.95) {
  if (!("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(word);
  utter.lang = "en-US";
  utter.rate = rate;
  window.speechSynthesis.speak(utter);
}

// Синонимы и антонимы — строками на линованной карточке, как от руки.
function relatedBlock(card) {
  const lines = [];
  if (card.synonyms && card.synonyms.length) {
    lines.push(`<p class="card-related"><span>Синонимы:</span> ${card.synonyms.map(escapeHtml).join(", ")}</p>`);
  }
  if (card.antonyms && card.antonyms.length) {
    lines.push(`<p class="card-related"><span>Антонимы:</span> ${card.antonyms.map(escapeHtml).join(", ")}</p>`);
  }
  return lines.join("");
}

// SQLite отдаёт "YYYY-MM-DD HH:MM:SS" в UTC без пометки зоны — дописываем её.
function parseUtc(str) {
  if (!str) return null;
  let s = str.includes("T") ? str : str.replace(" ", "T");
  if (!/[zZ]|[+-]\d\d:\d\d$/.test(s)) s += "Z";
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function isSameLocalDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

// Новая карточка (ни разу не повторялась) или пришло время повторения.
function isDue(card, now = new Date()) {
  if (!card.due_at) return true;
  const due = parseUtc(card.due_at);
  return !due || due <= now;
}

function pluralRu(n, one, few, many) {
  const mod10 = n % 10, mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

function countWords(n) {
  return `${n} ${pluralRu(n, "слово", "слова", "слов")}`;
}

// Подсветка активного пункта меню и счётчик слов к повторению в шапке.
document.querySelectorAll(".nav-links a").forEach((a) => {
  if (a.getAttribute("href") === location.pathname) a.setAttribute("aria-current", "page");
});

async function updateNavDue() {
  const btn = document.getElementById("nav-due");
  if (!btn) return;
  try {
    const res = await fetch("/api/stats");
    if (!res.ok) return;
    const s = await res.json();
    const due = s.due + s.new;
    btn.hidden = due === 0;
    btn.textContent = `Повторить ${countWords(due)}`;
  } catch {
    /* счётчик в шапке не критичен */
  }
}
updateNavDue();

// Переключатель оформления: «Бумага» (по умолчанию) и «Неон».
(function setupThemeToggle() {
  const bar = document.querySelector(".top-inner");
  if (!bar) return;
  const root = document.documentElement;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "theme-toggle";

  function sync() {
    const neon = root.dataset.theme === "neon";
    btn.textContent = neon ? "Бумага" : "Неон";
    btn.title = neon ? "Вернуть бумажное оформление" : "Включить неоновое оформление";
    btn.setAttribute("aria-pressed", String(neon));
  }

  btn.addEventListener("click", () => {
    const neon = root.dataset.theme !== "neon";
    if (neon) root.dataset.theme = "neon";
    else delete root.dataset.theme;
    try { localStorage.setItem("lexi-theme", neon ? "neon" : "paper"); } catch { /* приватный режим */ }
    sync();
  });

  sync();
  bar.insertBefore(btn, document.getElementById("nav-due"));
})();

// Имя пользователя и выход — справа в шапке.
async function setupUserMenu() {
  const bar = document.querySelector(".top-inner");
  if (!bar || ON_LOGIN_PAGE) return;
  try {
    const res = await fetch("/api/me");
    if (!res.ok) return;
    const me = await res.json();
    const box = document.createElement("div");
    box.className = "user-menu";
    box.innerHTML = `<span class="user-name" title="${me.is_admin ? "Администратор" : "Ваш аккаунт"}">${escapeHtml(me.username)}</span>
      <button type="button" class="link-btn user-logout">Выйти</button>`;
    box.querySelector(".user-logout").addEventListener("click", async () => {
      await fetch("/api/auth/logout", { method: "POST" });
      location.href = "/login";
    });
    bar.appendChild(box);
  } catch {
    /* меню не критично */
  }
}
setupUserMenu();
