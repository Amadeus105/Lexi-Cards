const tabLogin = document.getElementById("tab-login");
const tabRegister = document.getElementById("tab-register");
const form = document.getElementById("auth-form");
const username = document.getElementById("username");
const password = document.getElementById("password");
const submit = document.getElementById("auth-submit");
const errorBox = document.getElementById("auth-error");

let mode = "login"; // "login" | "register"

function setMode(next) {
  mode = next;
  const registering = mode === "register";
  tabLogin.setAttribute("aria-selected", String(!registering));
  tabRegister.setAttribute("aria-selected", String(registering));
  submit.textContent = registering ? "Создать аккаунт" : "Войти";
  password.autocomplete = registering ? "new-password" : "current-password";
  document.getElementById("username-hint").hidden = !registering;
  document.getElementById("password-hint").hidden = !registering;
  errorBox.hidden = true;
  username.focus();
}

tabLogin.addEventListener("click", () => setMode("login"));
tabRegister.addEventListener("click", () => setMode("register"));

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  errorBox.hidden = true;
  submit.disabled = true;
  const label = submit.textContent;
  submit.textContent = mode === "register" ? "Создаю аккаунт…" : "Вхожу…";
  try {
    const res = await fetch(`/api/auth/${mode}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: username.value, password: password.value }),
    });
    if (res.ok) {
      location.href = "/";
      return;
    }
    const body = await res.json().catch(() => ({}));
    errorBox.textContent = typeof body.detail === "string" ? body.detail : "Не получилось. Проверьте имя и пароль.";
    errorBox.hidden = false;
  } catch {
    errorBox.textContent = "Сервер не отвечает. Проверьте подключение и попробуйте ещё раз.";
    errorBox.hidden = false;
  } finally {
    submit.disabled = false;
    submit.textContent = label;
  }
});

username.focus();
