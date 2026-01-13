// js/historyUi.js
import { setView } from "./state.js";
import { applyWheelSnapshot } from "./actions.js";

function fmtDate(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleString("ru-RU", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso || "";
  }
}

// временное хранилище (потом — fetch из БД)
const LS_HISTORY = "won:history";

function loadHistory() {
  try {
    const x = JSON.parse(localStorage.getItem(LS_HISTORY) || "[]");
    return Array.isArray(x) ? x : [];
  } catch {
    return [];
  }
}

export function renderHistoryList() {
  const ul = document.getElementById("history-list");
  if (!ul) return;

  const rows = loadHistory();

  ul.innerHTML = "";

  if (!rows.length) {
    const li = document.createElement("li");
    li.className = "muted";
    li.textContent = "История пуста";
    ul.appendChild(li);
    return;
  }

  for (const r of rows) {
    const li = document.createElement("li");
    li.className = "history-item";

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "history-btn";
    btn.dataset.historyId = r.id;

    // мини-постер победителя
    const img = document.createElement("img");
    img.className = "history-poster";
    img.alt = r?.winner?.title ? `Poster: ${r.winner.title}` : "Poster";
    img.loading = "lazy";
    img.decoding = "async";

    // если постера нет — покажем серую заглушку (пустой src не ставим)
    const poster = String(r?.winner?.poster || "").trim();
    if (poster) img.src = poster;

    const text = document.createElement("div");
    text.className = "history-text";

    const title = document.createElement("div");
    title.className = "history-title";
    title.textContent = r?.winner?.title || "Без названия";

    const meta = document.createElement("div");
    meta.className = "history-meta";
    meta.textContent = `${fmtDate(r.created_at)} • ${
      r.preset_name || "preset"
    }`;

    text.appendChild(title);
    text.appendChild(meta);

    btn.appendChild(img);
    btn.appendChild(text);

    li.appendChild(btn);
    ul.appendChild(li);
  }
}

export function initHistoryClicks() {
  const ul = document.getElementById("history-list");
  if (!ul) return;

  ul.addEventListener("click", (e) => {
    const btn = e.target.closest(".history-btn");
    if (!btn) return;

    const id = btn.dataset.historyId;
    const rows = loadHistory();
    const r = rows.find((x) => String(x.id) === String(id));
    if (!r) return;

    // Открываем и результат, и снимок колеса
    applyWheelSnapshot({
      wheelItems: r.wheel_items || [],
      winnerId: r.winner?.id ?? null,
      winnerItem: r.winner || null,
    });
    setView("wheel");
  });
}

export function initHistoryUI() {
  renderHistoryList();
  initHistoryClicks();
}
