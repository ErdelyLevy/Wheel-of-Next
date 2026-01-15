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
import {
  stopSpinSound,
  playDing,
  ensureSpinAudio,
  ensureDingAudio,
} from "./spinSound.js";
import { bindLazyPoster } from "./lazyPoster.js"; // добавь импорт сверху
import { initVirtualCollectionsUI } from "./virtualCollectionsUI.js";

const LS_ACTIVE_PRESET = "won:activePresetId";

let wheelScheduleRedraw = null;

function initWheelRenderer(canvas) {
  let raf = 0;
  let dirty = false;

  const scheduleRedraw = () => {
    dirty = true;
    if (raf) return;

    raf = requestAnimationFrame(() => {
      raf = 0;

      // "снимаем" dirty на этот кадр
      dirty = false;

      const s = getState();
      const items = s?.wheel?.items || [];
      const rot = Number(canvas.__rotation || 0);

      drawWheel(canvas, items, {
        rotation: rot,
        onUpdate: scheduleRedraw, // если догрузился постер — попросим redraw
      });

      // если во время этого кадра кто-то снова дернул scheduleRedraw()
      // (например, загрузился img.onload) — дорисуем следующим кадром
      if (dirty) scheduleRedraw();
    });
  };

  // ✅ перерисовка при изменении размеров
  const ro = new ResizeObserver(() => scheduleRedraw());
  ro.observe(canvas);
  if (canvas.parentElement) ro.observe(canvas.parentElement);

  return scheduleRedraw;
}

function setActivePresetId(id) {
  localStorage.setItem(LS_ACTIVE_PRESET, String(id || ""));
}
function getActivePresetId() {
  return localStorage.getItem(LS_ACTIVE_PRESET) || "";
}

let rightListAllItems = [];

/** --- UI: список справа --- */
// где-то в main.js или в listUi.js

// main.js (или отдельный rightListUi.js)
let rightListById = new Map();

let __toastTimer = 0;

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (ch) => {
    switch (ch) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      case "'":
        return "&#39;";
      default:
        return ch;
    }
  });
}

function showToast(text, ms = 1600, opts = {}) {
  const el = document.getElementById("toast");
  if (!el) return;

  if (opts.html) {
    el.innerHTML = text || "";
  } else {
    el.textContent = text || "";
  }
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
  rightListById = new Map(arr.map((x) => [String(x.id), x]));

  ul.innerHTML = "";

  if (!arr.length) {
    const li = document.createElement("li");
    li.className = "muted";
    li.textContent = "Список пуст";
    ul.appendChild(li);
    return;
  }

  const CHUNK = 40; // 30–60 обычно ок
  let i = 0;

  function step() {
    const frag = document.createDocumentFragment();
    const end = Math.min(arr.length, i + CHUNK);

    for (; i < end; i++) {
      frag.appendChild(makeRightListRow(arr[i]));
    }

    ul.appendChild(frag);

    if (i < arr.length) {
      requestAnimationFrame(step);
    }
  }

  requestAnimationFrame(step);
}

function makeRightListRow(it) {
  const li = document.createElement("li");
  li.className = "history-item";

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "history-btn";
  btn.dataset.id = String(it.id || "");

  const img = document.createElement("img");
  img.className = "history-poster";
  img.alt = it?.title ? `Poster: ${it.title}` : "Poster";
  img.decoding = "async";
  img.loading = "lazy"; // можно оставить, но IO важнее

  // ✅ ВАЖНО: bindLazyPoster должен ставить src ТОЛЬКО когда элемент видим
  bindLazyPoster(img, it);

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
  return li;
}

/** --- применить пресет к странице колеса --- */
async function applyPresetToWheelPage(presetId) {
  if (!presetId) return;

  // сброс поиска при смене пресета (дешево — можно сразу)
  const searchInput = document.getElementById("search-input");
  if (searchInput) searchInput.value = "";

  // 1) Стартуем запросы ПАРАЛЛЕЛЬНО
  console.log("[before items+random]", performance.now());

  const pItems = apiGetItemsByPreset(presetId);
  const pRoll = apiRoll(presetId, { save: false });

  // 2) Ждем ROLL раньше или одновременно — чтобы быстро показать wheel/result
  let snap;
  try {
    console.log("[before random await]", performance.now());
    snap = await pRoll;
    console.log("[after random await]", performance.now());
  } catch (e) {
    console.error("roll failed", e);
    snap = null;
  }

  if (snap?.wheel_items?.length) {
    // ⚡ колесо/результат — ПЕРВЫМИ
    applyWheelSnapshot({
      wheelItems: structuredClone(snap.wheel_items),
      winnerId: snap.winner_id ?? null,
      winnerItem: snap.winner_item ?? null,
    });

    // важно: первый кадр колеса — сразу
    window.requestWheelRedraw?.();
  }

  // 3) Теперь items (если еще грузятся — дождемся)
  let items = [];
  try {
    console.log("[before items await]", performance.now());
    items = await pItems;
    console.log("[after items await]", performance.now());
  } catch (e) {
    console.error("items failed", e);
    items = [];
  }

  // иммутабельная копия для правого списка
  const listItems = structuredClone(items);
  rightListAllItems = listItems;

  // 4) Правый список + openResult — ЛЕНИВО (после первого кадра)
  const defer = (fn) => {
    if (window.requestIdleCallback) {
      requestIdleCallback(fn, { timeout: 1500 });
    } else {
      setTimeout(fn, 0);
    }
  };

  defer(() => {
    renderRightList(listItems);

    // если roll не дал winner_item — показываем первый элемент
    // (но не раньше, чем нарисовали колесо/результат)
    if (!snap?.winner_item && listItems[0]) {
      openResult(listItems[0]);
    }
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

      // 4) покажем тост с победителем (до звука, чтобы не пропасть при ошибке audio)
      if (winnerItem?.title) {
        const safeTitle = escapeHtml(winnerItem.title);
        showToast(
          `Победитель: <span class="toast-winner">${safeTitle}</span>`,
          1600,
          { html: true }
        );
      } else if (winnerId) {
        showToast(`Победитель определён`);
      }

      await playDing({ src: "/sounds/ding.mp3", volume: 0.9 });

      // 5) теперь показываем победителя слева
      if (winnerItem) openResult(winnerItem);

      // 6) обновим историю
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

function initRightListSearch() {
  const input = document.getElementById("search-input");
  if (!input) return;

  input.addEventListener("input", () => {
    const term = input.value.trim().toLowerCase();
    const base = Array.isArray(rightListAllItems) ? rightListAllItems : [];

    if (!term) {
      renderRightList(base);
      return;
    }

    const filtered = base.filter((it) =>
      String(it?.title || "")
        .toLowerCase()
        .includes(term)
    );
    renderRightList(filtered);
  });
}

function initWheelCanvas() {
  const canvas = document.getElementById("wheel");
  if (!canvas) return;

  let __raf = 0;

  const scheduleRedraw = () => {
    // не рисуем, если вкладка не "колесо" (иначе будут странные лаги на settings)
    if (getState().view !== "wheel") return;

    if (__raf) return;
    __raf = requestAnimationFrame(() => {
      __raf = 0;

      const s = getState();
      const items = s?.wheel?.items || [];

      // rotation бери из canvas.__rotation (это “истина” после спина)
      const rot = Number(canvas.__rotation || 0);

      drawWheel(canvas, items, {
        rotation: rot,
        onUpdate: scheduleRedraw, // ✅ ВАЖНО: именно scheduleRedraw
      });
    });
  };

  // 1) перерисовка при любом обновлении wheel (snapshot / expand / preload)
  let last = null;
  subscribe(() => {
    const u = getState()?.wheel?.updatedAt || null;
    if (u && u !== last) {
      last = u;
      scheduleRedraw();
    }
  });

  // 2) перерисовка на ресайз
  window.addEventListener("resize", scheduleRedraw);

  // 3) первый рендер (на случай если state уже заполнен)
  scheduleRedraw();
}

/** --- boot --- */
async function boot() {
  // dropdowns (зависят от /api/meta)
  await initPresetDropdowns();

  // каталог/редактор пресетов
  await initPresetCatalog();

  initVirtualCollectionsUI();

  initRightListClicks();
  initRightListSearch();

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
