let __toastTimer = 0;

function getToastEl() {
  return document.getElementById("toast");
}

export function showToast(text, ms = 1600, opts = {}) {
  const el = getToastEl();
  if (!el) return;

  if (opts?.html) el.innerHTML = text || "";
  else el.textContent = text || "";

  // Унификация: поддержим оба класса, чтобы не зависеть от того,
  // какой стиль сейчас реально описан в CSS.
  el.classList.add("is-on");
  el.classList.add("is-show");

  clearTimeout(__toastTimer);
  __toastTimer = window.setTimeout(() => {
    el.classList.remove("is-on");
    el.classList.remove("is-show");
  }, ms);
}

// Экспортируем toast как стабильный внешний API.
// Поведение без DOM-элемента сохраняем как во второй версии (alert).
export function toast(msg, ms = 2600) {
  const el = getToastEl();
  if (!el) return alert(msg);

  // Совместимость с прежним API toast(msg)
  return showToast(msg, ms);
}
