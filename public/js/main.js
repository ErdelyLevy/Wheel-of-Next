// js/main.js
import "./ui.js";
import { initPresetDropdowns } from "./presetsUi.js";
import { initPresetCatalog } from "./presetsCatalog.js";
import { initHistoryUI } from "./historyUi.js";
import { initResultUI } from "./resultUi.js";
import { apiGetItemsByPreset, apiRoll, apiGetPresets } from "./api.js";
import { openResult, applyWheelSnapshot } from "./actions.js";
import { drawWheel, resizeCanvasToDisplaySize } from "./wheelRender.js";
import { getState, subscribe } from "./state.js";
import { spinToWinner } from "./wheelSpin.js";
import { bindLazyPoster } from "./posterFallback.js"; // добавь импорт сверху
import { initVirtualCollectionsUI } from "./virtualCollectionsUI.js";

const LS_ACTIVE_PRESET = "won:activePresetId";
const WHEEL_BASE = window.location.pathname.startsWith("/wheel/")
  ? "/wheel"
  : "";

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
async function refreshPresetTabsFromDB({ selectId } = {}) {
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

function initPresetTabsClicksFromDB(onPresetChange) {
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
    ensureSpinAudio(`${WHEEL_BASE}/sounds/spin.mp3`);
    ensureDingAudio(`${WHEEL_BASE}/sounds/ding.mp3`);
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

      await playDing({ src: `${WHEEL_BASE}/sounds/ding.mp3`, volume: 0.9 });

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

      // ✅ синхронизируем реальный размер canvas с CSS-размером
      resizeCanvasToDisplaySize(canvas);

      const s = getState();
      const items = s?.wheel?.items || [];
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

function syncHeaderHeightVar() {
  const header = document.querySelector("header.topbar");
  if (!header) return;
  const h = Math.round(header.getBoundingClientRect().height);
  document.documentElement.style.setProperty("--header-h", `${h}px`);
}

syncHeaderHeightVar();
window.addEventListener("resize", () =>
  requestAnimationFrame(syncHeaderHeightVar)
);

function initMobileSidebarsCollapsible() {
  if (window.__mobSidebarsInited) return;
  window.__mobSidebarsInited = true;
  const mq = window.matchMedia("(max-width: 520px)");
  const app = document.querySelector(".app");
  const left = document.querySelector("aside.left");
  const right = document.querySelector("aside.right");
  if (!app || !left || !right) return;

  const h2Left = left.querySelector("h2");
  const h2Right = right.querySelector("h2");
  if (!h2Left || !h2Right) return;

  const syncRightCollapsedHeight = () => {
    if (!mq.matches) return;

    // меряем ТОЛЬКО в collapsed состоянии
    if (!right.classList.contains("is-collapsed")) return;

    const head = right.querySelector(".right-head") || right;
    const headH = Math.round(head.getBoundingClientRect().height);

    const cs = getComputedStyle(right);
    const padT = parseFloat(cs.paddingTop) || 0;
    const padB = parseFloat(cs.paddingBottom) || 0;
    const bT = parseFloat(cs.borderTopWidth) || 0;
    const bB = parseFloat(cs.borderBottomWidth) || 0;

    const h = Math.max(0, Math.round(headH + padT + padB + bT + bB));
    document.documentElement.style.setProperty("--right-collapsed-h", `${h}px`);
  };

  const updateStateClasses = () => {
    if (!mq.matches) {
      app.classList.remove(
        "m-left-open",
        "m-right-open",
        "m-left-collapsed",
        "m-right-collapsed",
        "m-both-collapsed"
      );
      document.documentElement.classList.remove("m-screen");
      return;
    }

    const leftCollapsed = left.classList.contains("is-collapsed");
    const rightCollapsed = right.classList.contains("is-collapsed");
    const both = leftCollapsed && rightCollapsed;

    app.classList.toggle("m-left-collapsed", leftCollapsed);
    app.classList.toggle("m-right-collapsed", rightCollapsed);
    app.classList.toggle("m-left-open", !leftCollapsed);
    app.classList.toggle("m-right-open", !rightCollapsed);
    app.classList.toggle("m-both-collapsed", both);

    // ✅ m-screen включаем ТОЛЬКО если активен view-wheel
    const viewWheel = document.getElementById("view-wheel");
    const wheelActive =
      viewWheel && !viewWheel.classList.contains("is-hidden-visually");

    document.documentElement.classList.toggle("m-screen", both && wheelActive);
  };

  const applyAfterLayout = () => {
    updateStateClasses();
    syncRightCollapsedHeight();
    syncHeaderHeightVar(); // <- добавить
  };

  const setDefault = () => {
    if (mq.matches) {
      left.classList.add("is-collapsed");
      right.classList.add("is-collapsed");
    } else {
      left.classList.remove("is-collapsed");
      right.classList.remove("is-collapsed");
    }
    requestAnimationFrame(applyAfterLayout);
  };

  const toggle = (el) => {
    el.classList.toggle("is-collapsed");
    requestAnimationFrame(applyAfterLayout);
  };

  h2Left.addEventListener("click", () => toggle(left));
  h2Right.addEventListener("click", () => toggle(right));

  mq.addEventListener?.("change", setDefault);
  setDefault();

  window.addEventListener("resize", () =>
    requestAnimationFrame(applyAfterLayout)
  );
}

/** --- boot --- */
async function boot() {
  initMobileSidebarsCollapsible();

  // dropdowns
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

//spin sound management

let spinAudio = null;
let dingAudio = null;

export function ensureSpinAudio(src = `${WHEEL_BASE}/sounds/spin.mp3`) {
  if (spinAudio) return spinAudio;
  spinAudio = new Audio(src);
  spinAudio.loop = true;
  spinAudio.preload = "auto";
  spinAudio.volume = 0.35;
  return spinAudio;
}

export async function startSpinSound({ src, volume = 0.35, rate = 1 } = {}) {
  const a = ensureSpinAudio(src);
  a.volume = Math.max(0, Math.min(1, Number(volume)));
  a.playbackRate = Math.max(0.25, Math.min(4, Number(rate)));

  try {
    await a.play();
  } catch {
    // blocked by browser → ignore
  }
}

export function stopSpinSound({ fadeMs = 200 } = {}) {
  const a = spinAudio;
  if (!a) return Promise.resolve();

  const ms = Math.max(0, Number(fadeMs) || 0);

  if (ms === 0) {
    a.pause();
    a.currentTime = 0;
    return Promise.resolve();
  }

  const v0 = a.volume;
  const t0 = performance.now();

  return new Promise((resolve) => {
    function tick(now) {
      const t = Math.min(1, (now - t0) / ms);
      a.volume = v0 * (1 - t);

      if (t < 1) requestAnimationFrame(tick);
      else {
        a.pause();
        a.currentTime = 0;
        a.volume = v0;
        resolve();
      }
    }
    requestAnimationFrame(tick);
  });
}

export function ensureDingAudio(src = `${WHEEL_BASE}/sounds/ding.mp3`) {
  if (dingAudio) return dingAudio;
  dingAudio = new Audio(src);
  dingAudio.loop = false;
  dingAudio.preload = "auto";
  dingAudio.volume = 0.9;
  return dingAudio;
}

export async function playDing({
  src = `${WHEEL_BASE}/sounds/ding.mp3`,
  volume = 0.9,
  rate = 1,
} = {}) {
  const a = ensureDingAudio(src);
  a.volume = Math.max(0, Math.min(1, Number(volume)));
  a.playbackRate = Math.max(0.25, Math.min(4, Number(rate)));

  // важно: перематываем в начало
  try {
    a.pause();
    a.currentTime = 0;
  } catch {}

  try {
    await a.play();
  } catch {
    // blocked → просто выходим
    return;
  }

  // ждём окончания
  await new Promise((resolve) => {
    const done = () => {
      a.removeEventListener("ended", done);
      a.removeEventListener("pause", done);
      resolve();
    };
    a.addEventListener("ended", done, { once: true });
    // если кто-то остановит — тоже считаем “концом”
    a.addEventListener("pause", done, { once: true });
  });
}
