// public/js/historyUi.js
import { setView } from "./state.js";
import { applyWheelSnapshot } from "./actions.js";
import { apiGetHistory, apiGetHistoryById } from "./api.js";
import { bindLazyPoster } from "./posterFallback.js"; // добавь импорт сверху

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

function getWinner(r) {
  // на всякий: если winner хранится как объект JSONB
  return r?.winner || null;
}

function getWheelItems(r) {
  // если wheel_items jsonb -> должен прийти как массив
  return Array.isArray(r?.wheel_items) ? r.wheel_items : [];
}

async function renderHistoryList() {
  const ul = document.getElementById("history-list");
  if (!ul) return;

  ul.innerHTML = `<li class="muted">Загрузка…</li>`;

  let rows = [];
  try {
    rows = await apiGetHistory(50);
  } catch (e) {
    console.error(e);
    ul.innerHTML = `<li class="muted">Не удалось загрузить историю</li>`;
    return;
  }

  ul.innerHTML = "";

  if (!rows.length) {
    ul.innerHTML = `<li class="muted">История пуста</li>`;
    return;
  }

  for (const r of rows) {
    const winner = getWinner(r);

    const li = document.createElement("li");
    li.className = "history-item";

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "history-btn";
    btn.dataset.historyId = String(r.id);

    // мини-постер победителя
    const img = document.createElement("img");
    img.className = "history-poster";
    img.alt = winner?.title ? `Poster: ${winner.title}` : "Poster";
    img.decoding = "async";

    bindLazyPoster(img, winner);

    const text = document.createElement("div");
    text.className = "history-text";

    const title = document.createElement("div");
    title.className = "history-title";
    title.textContent = winner?.title || "Без названия";

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

function initHistoryClicks() {
  const ul = document.getElementById("history-list");
  if (!ul) return;

  ul.addEventListener("click", async (e) => {
    const btn = e.target.closest(".history-btn");
    if (!btn) return;

    const id = String(btn.dataset.historyId || "");
    if (!id) return;

    try {
      // берём полную запись (с wheel_items)
      const row = await apiGetHistoryById(id);
      if (!row) return;

      const winner = getWinner(row);

      applyWheelSnapshot({
        wheelItems: getWheelItems(row),
        winnerId: winner?.id ?? row.winner_id ?? null,
        winnerItem: winner || null,
      });

      setView("wheel");
    } catch (e2) {
      console.error(e2);
      alert(e2.message || e2);
    }
  });
}

export function initHistoryUI() {
  renderHistoryList();
  initHistoryClicks();
}

// чтобы main.js мог обновлять историю после ROLL без циклических импортов
window.refreshHistory = renderHistoryList;
