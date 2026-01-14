// js/main.js
import "./ui.js";
import { initPresetDropdowns } from "./presetsUi.js";
import { initPresetCatalog } from "./presetsCatalog.js";
import { initHistoryUI } from "./historyUi.js";
import { initResultUI } from "./resultUi.js";
import { apiGetItemsByPreset, apiRoll, apiGetPresets } from "./api.js";
import { openResult, applyWheelSnapshot } from "./actions.js";
import { drawWheel } from "./wheelRender.js";
import { getState, subscribe } from "./state.js";
import { spinToWinner } from "./wheelSpin.js";
import { ensureSpinAudio, ensureDingAudio } from "./spinSound.js";
import { stopSpinSound, playDing } from "./spinSound.js";

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

let __toastTimer = 0;

function showToast(text, ms = 1600) {
  const el = document.getElementById("toast");
  if (!el) return;

  el.textContent = text || "";
  el.classList.add("is-on");

  clearTimeout(__toastTimer);
  __toastTimer = window.setTimeout(() => {
    el.classList.remove("is-on");
  }, ms);
}

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
  const canvas = document.getElementById("wheel");
  if (!btn || !canvas) return;

  btn.addEventListener("click", async () => {
    ensureSpinAudio("/sounds/spin.mp3");
    ensureDingAudio("/sounds/ding.mp3");
    const presetId = getActivePresetId();
    if (!presetId) return alert("Выбери пресет");

    try {
      btn.disabled = true;

      const snap = await apiRoll(presetId, { save: true });

      const winnerId = String(snap.winner_id ?? snap.winner?.id ?? "");
      const winnerItem = snap.winner || null;

      // 1) обновляем wheel, но result НЕ трогаем
      applyWheelSnapshot({
        wheelItems: structuredClone(snap.wheel_items || []),
        winnerId,
        winnerItem: null, // ✅ важно
      });

      // 2) берём актуальные items из state (после autoExpand)
      const s = getState();
      const items = s.wheel?.items || [];

      const durationSec = Number(s.spin?.duration || 20);
      const speed = Number(s.spin?.speed || 1);

      // 3) крутим
      await spinToWinner({
        canvas,
        items,
        winnerId,
        durationSec,
        speed,
      });

      await stopSpinSound({ fadeMs: 250 });

      showToast(`Победитель: ${winnerItem.title}`);

      await playDing({ src: "/sounds/ding.mp3", volume: 0.9 });

      // 4) теперь показываем победителя слева
      if (winnerItem) openResult(winnerItem);

      if (winnerItem?.title) {
        showToast(`Победитель: ${winnerItem.title}`);
      } else if (winnerId) {
        showToast(`Победитель определён`);
      }

      // 5) обновим историю
      window.refreshHistory?.();
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

function initWheelCanvas() {
  const canvas = document.getElementById("wheel");
  if (!canvas) return;

  let rotation = 0;

  const redraw = () => {
    const items = getState()?.wheel?.items || [];
    drawWheel(canvas, items, { rotation, onUpdate: redraw });
  };

  // 1) перерисовка при любом обновлении wheel (snapshot / expand / preload)
  let last = null;
  subscribe(() => {
    const u = getState()?.wheel?.updatedAt || null;
    if (u && u !== last) {
      last = u;
      redraw();
    }
  });

  // 2) перерисовка на ресайз
  window.addEventListener("resize", redraw);

  // 3) первый рендер (на случай если state уже заполнен)
  redraw();

  // можно вернуть доступ к rotation для будущей анимации
  return {
    setRotation(rad) {
      rotation = Number(rad) || 0;
      redraw();
    },
    redraw,
  };
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

  // ✅ колесо: подписки + resize
  initWheelCanvas();

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
