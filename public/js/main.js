// js/main.js
import "./ui.js";
import { initPresetDropdowns } from "./presetsUi.js";
import { initPresetCatalog } from "./presetsCatalog.js";
import { initHistoryUI } from "./historyUi.js";
import { initResultUI } from "./resultUi.js";
import { apiGetItemsByPreset, apiRoll, apiGetPresets } from "./api.js";
import { openResult, applyWheelSnapshot } from "./actions.js";
import { getState } from "./state.js";

const LS_ACTIVE_PRESET = "won:activePresetId";

function setActivePresetId(id) {
  localStorage.setItem(LS_ACTIVE_PRESET, String(id || ""));
}
function getActivePresetId() {
  return localStorage.getItem(LS_ACTIVE_PRESET) || "";
}

let rightListItems = [];

/** --- UI: список справа --- */
// где-то в main.js или в listUi.js

// main.js (или отдельный rightListUi.js)
let rightListById = new Map();

function renderRightList(items) {
  const ul = document.getElementById("full-list");
  if (!ul) return;

  const arr = Array.isArray(items) ? items : [];

  // ✅ источник истины: id -> item (в модуле, не на ul)
  rightListById = new Map(arr.map((x) => [String(x.id), x]));

  ul.innerHTML = "";

  if (!arr.length) {
    const li = document.createElement("li");
    li.className = "muted";
    li.textContent = "Список пуст";
    ul.appendChild(li);
    return;
  }

  for (const it of arr) {
    const li = document.createElement("li");
    li.className = "history-item"; // можешь оставить стиль истории

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "history-btn"; // можешь оставить стиль истории
    btn.dataset.id = String(it.id || ""); // ✅ ТОЛЬКО ID

    const img = document.createElement("img");
    img.className = "history-poster";
    img.alt = it?.title ? `Poster: ${it.title}` : "Poster";
    img.loading = "lazy";
    img.decoding = "async";

    const poster = String(it?.poster || "").trim();
    if (poster) img.src = poster;

    const text = document.createElement("div");
    text.className = "history-text";

    const title = document.createElement("div");
    title.className = "history-title";
    title.textContent = it?.title || "(без названия)";

    const meta = document.createElement("div");
    meta.className = "history-meta";
    meta.textContent = [it?.media_type, it?.category_name]
      .filter(Boolean)
      .join(" • ");

    text.appendChild(title);
    text.appendChild(meta);

    btn.appendChild(img);
    btn.appendChild(text);

    li.appendChild(btn);
    ul.appendChild(li);
  }
}

/** --- применить пресет к странице колеса --- */
async function applyPresetToWheelPage(presetId) {
  if (!presetId) return;

  // 1) список справа — ИММУТАБЕЛЬНАЯ КОПИЯ
  const items = await apiGetItemsByPreset(presetId);
  const listItems = structuredClone(items); // ⬅️ КЛЮЧ

  renderRightList(listItems);

  if (listItems[0]) openResult(listItems[0]);

  // 2) колесо — СВОЯ копия
  const snap = await apiRoll(presetId, { save: false });

  applyWheelSnapshot({
    wheelItems: structuredClone(snap.wheel_items), // ⬅️ КЛЮЧ
    winnerId: null,
    winnerItem: null,
  });
}

/** --- табы пресетов сверху (на колесе) --- */
export async function refreshPresetTabsFromDB({ selectId } = {}) {
  const root = document.getElementById("preset-tabs");
  if (!root) return;

  const presets = await apiGetPresets();
  root.innerHTML = "";

  if (!presets.length) {
    const b = document.createElement("button");
    b.className = "tab active";
    b.type = "button";
    b.textContent = "Нет пресетов";
    b.disabled = true;
    root.appendChild(b);
    return;
  }

  let activeId = selectId || getActivePresetId();
  if (!activeId || !presets.some((p) => String(p.id) === String(activeId))) {
    activeId = String(presets[0].id);
  }
  setActivePresetId(activeId);

  for (const p of presets) {
    const id = String(p.id);
    const btn = document.createElement("button");
    btn.className = "tab";
    btn.type = "button";
    btn.dataset.presetId = id;
    btn.textContent = p.name || "Без названия";
    btn.classList.toggle("active", id === activeId);
    root.appendChild(btn);
  }
}

export function initPresetTabsClicksFromDB(onPresetChange) {
  const root = document.getElementById("preset-tabs");
  if (!root) return;

  root.addEventListener("click", async (e) => {
    const btn = e.target.closest(".tab");
    if (!btn || !btn.dataset.presetId) return;

    const id = String(btn.dataset.presetId);
    setActivePresetId(id);

    [...root.querySelectorAll(".tab")].forEach((b) =>
      b.classList.toggle("active", String(b.dataset.presetId) === id)
    );

    if (typeof onPresetChange === "function") {
      await onPresetChange(id);
    }
  });
}

/** --- ROLL кнопка --- */
function initRollButton() {
  const btn = document.getElementById("spin-btn");
  if (!btn) return;

  btn.addEventListener("click", async () => {
    const presetId = getActivePresetId();
    if (!presetId) {
      alert("Выбери пресет");
      return;
    }

    try {
      btn.disabled = true;

      // save:true → это будет записывать историю на бэке (когда подключишь)
      const snap = await apiRoll(presetId, { save: true });

      applyWheelSnapshot({
        wheelItems: snap.wheel_items || [],
        winnerId: snap.winner_id ?? snap.winner?.id ?? null,
        winnerItem: snap.winner || null,
      });

      window.refreshHistory?.();

      // TODO: тут позже будет анимация вращения
    } catch (e) {
      console.error(e);
      alert(e.message || e);
    } finally {
      btn.disabled = false;
    }
  });
}

function initRightListClicks() {
  const ul = document.getElementById("full-list");
  if (!ul) return;

  ul.addEventListener("click", (e) => {
    const btn = e.target.closest(".history-btn");
    if (!btn) return;

    const id = String(btn.dataset.id || "");
    const it = rightListById.get(id);

    if (!it) return;
    openResult(it);
  });
}

/** --- boot --- */
async function boot() {
  // dropdowns (зависят от /api/meta)
  await initPresetDropdowns();

  // каталог/редактор пресетов
  await initPresetCatalog();

  initRightListClicks();

  // UI списка/истории/результата
  initHistoryUI();
  initResultUI();

  // кнопка ROLL
  initRollButton();

  // табы пресетов сверху + сразу применить активный
  await refreshPresetTabsFromDB();

  initPresetTabsClicksFromDB(async (presetId) => {
    try {
      await applyPresetToWheelPage(presetId);
    } catch (e) {
      console.error(e);
      alert(e.message || e);
    }
  });

  // применить текущий активный пресет при старте
  const active = getActivePresetId();
  if (active) {
    await applyPresetToWheelPage(active);
  }
}

boot().catch((e) => console.error("[boot] failed:", e));

// чтобы presetsCatalog мог дергать обновление вкладок без циклических импортов
window.refreshPresetTabsFromDB = refreshPresetTabsFromDB;
