import { apiGetMe, WHEEL_BASE } from "./shared/api.js";

function formatUserLabel(user) {
  const name = String(user?.name || "").trim();
  if (name) return name;
  const email = String(user?.email || "").trim();
  if (email) return email;
  return "Профиль";
}

function applyAuthState(btn, user) {
  const authed = !!user;
  btn.dataset.authed = authed ? "true" : "false";
  btn.classList.toggle("is-authed", authed);
  btn.textContent = authed ? formatUserLabel(user) : "Авторизация";
  btn.title = authed ? "Выйти" : "Войти";
  btn.setAttribute("aria-label", btn.title);
}

export async function initAuthButton() {
  const btn = document.getElementById("auth-btn");
  if (!btn) return;

  btn.addEventListener("click", () => {
    const authed = btn.dataset.authed === "true";
    const target = authed ? "/auth/logout" : "/auth/login";
    window.location.href = `${WHEEL_BASE}${target}`;
  });

  try {
    const user = await apiGetMe();
    applyAuthState(btn, user);
  } catch {
    applyAuthState(btn, null);
  }
}

