// js/main.js — Главный модуль приложения Wheel of Next
// Импорты из других модулей
import { CATEGORY_WEIGHTS_DEFAULTS, WEIGHT_LABELS, svgPoster } from "./data.js";
import {
  state,
  getFilteredItems,
  weightedPickIndex,
  computeTargetAngleForIndex,
  loadWeights,
  saveWeights,
  setWeight,
  getWeight,          // ✅ ДОБАВЬ
} from "./state.js";
import { initDom, dom, renderFullList, setActiveInList } from "./dom.js";
import { renderResult } from "./actions.js";
import { createWheelRenderer } from "./wheelCanvas.js";
import { setLazyImg, proxifyImageUrl } from "./img.js";


// Глобальная переменная для рендерера колеса
let wheelRef = null;

// --- Wheel size (how many unique items to show on the wheel) ---
const WHEEL_LIMITS = {
  games: 18,
  video: 24,
  books: 24,
};

function getWheelLimit() {
  const v = WHEEL_LIMITS[state.currentMedia] ?? 24;
  // safety: at least 6 segments, at most 48
  return Math.max(6, Math.min(48, v));
}

// ---------------------
// Вспомогательные функции
// ---------------------

// Функция для установки активного состояния кнопок
function setActive(buttons, predicate) {
  buttons.forEach(b => b.classList.toggle("active", predicate(b)));
}

// Функция для плавной анимации (ease-out cubic)
function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

// Функция анимации вращения колеса
function animateSpin(from, to, durationMs, drawFrame, onDone) {
  const start = performance.now();
  function frame(now) {
    const t = Math.min(1, (now - start) / durationMs);
    const k = easeOutCubic(t);
    state.baseAngle = from + (to - from) * k;
    drawFrame();
    if (t < 1) requestAnimationFrame(frame);
    else onDone?.();
  }
  requestAnimationFrame(frame);
}

// Функция установки выбранного элемента
function setSelected(item) {
  state.selectedId = item.id;
  setActiveInList(item.id);
  renderResult(item);
}

// Функция рендеринга истории бросков
function renderRollHistory(list) {
  const el = document.getElementById("roll-history");
  if (!el) return;
  el.innerHTML = "";

  for (const r of list) {
    const li = document.createElement("li");
    li.className = "list-item";
    li.dataset.itemId = String(r.item_id ?? "");

    const img = document.createElement("img");
    img.alt = "";

    const placeholder = svgPoster(r.title || "NO IMAGE");
    setLazyImg(img, r.poster || "", placeholder);

    img.addEventListener("error", () => (img.src = placeholder));

    const span = document.createElement("span");
    const d = new Date(r.ts);
    const time = d.toLocaleString("ru-RU", {
      hour: "2-digit",
      minute: "2-digit",
      day: "2-digit",
      month: "2-digit"
    });
    span.textContent = `${r.title} · ${time}`;

    li.appendChild(img);
    li.appendChild(span);

    // ✅ КЛИК: открыть тайтл
    li.addEventListener("click", () => {
      const id = li.dataset.itemId;
      if (!id) return;

      const item = state.allItems.find(x => String(x.id) === String(id));

      if (!item || !wheelRef) {
        // ✅ Нормально: item больше не в коллекциях → показываем архивную карточку
        renderResult({
          id: String(r.item_id ?? "archived"),
          meta_id: String(r.item_id ?? ""),
          title: r.title || "Архивный элемент",
          media_type: r.media || state.currentMedia,
          category: r.category || "",
          poster: r.poster || "",
          year: "",
          genres: [],
          tags: [],
          platform: r.platform || "",
          description: "Этого тайтла больше нет в текущих коллекциях (история хранит снимок).",
          sources: []
        });
        setRightPanel("list");
        return;
      }

      // определить режим по item
      let targetMedia = "video";
      if (item.media_type === "game") targetMedia = "games";
      else if (item.media_type === "book") targetMedia = "books";

      // если меняем режим — обновим state + активные табы
      if (state.currentMedia !== targetMedia) {
        state.currentMedia = targetMedia;

        if (dom.mediaTabs) {
          setActive([...dom.mediaTabs.querySelectorAll(".tab")], b => b.dataset.media === state.currentMedia);
        }

        // сброс платформы если не games
        if (state.currentMedia !== "games") {
          state.currentPlatform = "all";
          if (dom.platformTabs) {
            setActive([...dom.platformTabs.querySelectorAll(".tab")], b => b.dataset.platform === "all");
          }
        }
      }

      // если это игра — выставим платформу по item.platform (если есть)
      if (state.currentMedia === "games") {
        const p = (item.platform || "all").toLowerCase();
        state.currentPlatform = p || "all";
        if (dom.platformTabs) {
          setActive([...dom.platformTabs.querySelectorAll(".tab")], b => b.dataset.platform === state.currentPlatform);
        }
      }

      // обновим UI под режим/платформу
      refreshUI(wheelRef);

     
      // найти item в текущем отфильтрованном списке и выбрать
      let inFiltered = state.items.find(x => String(x.id) === String(item.id));
      if (!inFiltered) {
        refreshUI(wheelRef);
        inFiltered = state.items.find(x => String(x.id) === String(item.id));
      }
      if (inFiltered) setSelected(inFiltered);

      // переключаемся на "Список" (чтобы видеть подсветку)
      setRightPanel("list");
    });

    el.appendChild(li);
  }
}


// ---------------------
// Right panel tabs (Список / Веса)
// ---------------------
const rightTabs = () => document.getElementById("right-tabs");
const panelList = () => document.getElementById("panel-list");
const panelWeights = () => document.getElementById("panel-weights");

// ---------------------
// Weights form
// ---------------------
const weightsForm = () => document.getElementById("weights-form");
const saveWeightsBtn = () => document.getElementById("save-weights");
const resetWeightsBtn = () => document.getElementById("reset-weights");

function categoriesForCurrentMode() {
  // Games — как договорились
  if (state.currentMedia === "games") {
    return ["continue_game", "new_game", "single_game"];
  }

  // Books — без изменений
  if (state.currentMedia === "books") {
    return Object.keys(state.weights || {})
      .filter(k => k.includes("book"))
      .sort();
  }

  // ✅ Video: TV → Anime, внутри по алфавиту
  if (state.currentMedia === "video") {
    const tv = ["continue_tv", "new_tv", "single_tv"].sort();
    const anime = ["continue_anime", "new_anime", "single_anime"].sort();
    return [...tv, ...anime];
  }

  return [];
}


function renderWeightsForm() {
  
  const form = weightsForm();
  if (!form) {
    console.error('[Wheel] Не найден #weights-form (проверь index.html)');
    return;
  }

  if (!state.weights || Object.keys(state.weights).length === 0) {
    state.weights = { ...CATEGORY_WEIGHTS_DEFAULTS };
  }

  let keys = categoriesForCurrentMode();

  // ✅ СОРТИРОВКА: video сначала TV потом Anime, внутри алфавит
  if (state.currentMedia === "video") {
    const tv = keys.filter(k => k.endsWith("_tv")).sort();
    const anime = keys.filter(k => k.endsWith("_anime")).sort();
    keys = [...tv, ...anime];
  } else {
    keys = keys.slice().sort();
  }

  if (keys.length === 0) {
    form.innerHTML = `<div style="opacity:.75;padding:8px 0;">Нет категорий весов для текущего режима.</div>`;
    return;
  }

form.innerHTML = keys.map(k => {
  const v = state.weights[k] ?? 1;
  const meta = WEIGHT_LABELS[k];

  const title = meta?.title ?? k;
  const hint = meta?.hint ?? "";

  return `
    <div class="weights-row">
      <div>
        <div style="font-weight:800">${title}</div>
        ${hint ? `<div style="font-size:11px;opacity:.65">${hint}</div>` : ""}
      </div>
    <input
      type="number"
      min="0"
      max="10"
      step="1"
      data-weight-key="${k}"
      value="${v}"
      title="0 — никогда, 10 — максимально часто"
    >
    </div>
  `;
}).join("");

  form.querySelectorAll("input[data-weight-key]").forEach(inp => {
    inp.addEventListener("input", () => {
      const key = inp.dataset.weightKey;

      let v = Number(inp.value);
      if (!Number.isFinite(v)) return;

      // 🔒 ЖЁСТКО ограничиваем
      v = Math.max(0, Math.min(10, v));

      // синхронизируем UI и state
      inp.value = v;
      setWeight(key, v);
    });
  });
}

async function healthCheck() {
  try {
    const res = await fetch("/api/health");
    return res.ok;
  } catch {
    return false;
  }
}

async function setRightPanel(which) {
  const pl = document.getElementById("panel-list");
  const pw = document.getElementById("panel-weights");
  const ph = document.getElementById("panel-history");

  if (pl) pl.classList.toggle("is-hidden", which !== "list");
  if (pw) pw.classList.toggle("is-hidden", which !== "weights");
  if (ph) ph.classList.toggle("is-hidden", which !== "history");

  const tabs = document.getElementById("right-tabs");
  if (tabs) {
    [...tabs.querySelectorAll(".tab")].forEach(b =>
      b.classList.toggle("active", b.dataset.panel === which)
    );
  }

  if (which === "weights") {
    renderWeightsForm();
  }

  if (which === "history") {
    try {
      const rolls = await loadRollHistory(30);
      renderRollHistory(rolls);
    } catch (e) {
      console.warn("[Wheel] loadRollHistory failed:", e);
      renderRollHistory([]);
    }
  }
}


function initRightTabs() {
  rightTabs()?.addEventListener("click", (e) => {
    const btn = e.target.closest(".tab");
    if (!btn || !btn.dataset.panel) return;
    setRightPanel(btn.dataset.panel);
  });

  // кнопки Save/Reset внутри панели
  saveWeightsBtn()?.addEventListener("click", async () => {
    try {
      await saveWeightsToApi(state.weights);
    } catch (e) {
      console.warn("[Wheel] saveWeightsToApi failed, fallback to localStorage", e);
      saveWeights();
    }
  });

  resetWeightsBtn()?.addEventListener("click", () => {
    state.weights = { ...CATEGORY_WEIGHTS_DEFAULTS };
    saveWeights();
    renderWeightsForm();
  });
}

// ---------------------
// Main refresh
// ---------------------
function refreshUI(wheel) {
  state.items = getFilteredItems(state.allItems);

  const q = (state.searchQuery || "").trim().toLowerCase();
  if (q) {
    state.items = state.items.filter(x => String(x.title || "").toLowerCase().includes(q));
  }

  // platform tabs only for games
  if (dom.platformTabs) {
    dom.platformTabs.style.display = (state.currentMedia === "games") ? "inline-flex" : "none";
  }

  renderFullList(state.items, setSelected, state.selectedId);

  // ✅ всегда формируем витрину колеса максимум из 10
  if (state.items.length) {
    const current =
      state.items.find(x => String(x.id) === String(state.selectedId)) ||
      state.items[0];

    // обновим выбранное (чтобы карточка не прыгала на первый элемент всегда)
    setSelected(current);

    const limit = Math.min(getWheelLimit(), state.items.length);
    state.wheelItems = buildWheelSubset(state.items, current, limit);

  } else {
    state.wheelItems = [];
  }

  wheel.preloadImages?.(state.wheelItems);
  wheel.drawWheel(state.wheelItems);
  wheel.warmup(state.wheelItems);

  // ✅ рисуем только витрину (<=10)
  const toDraw = (state.wheelItems && state.wheelItems.length) ? state.wheelItems : state.items;
  wheel.drawWheel(toDraw);

  // ✅ warmup тоже только по витрине, иначе снова “тысяча сегментов”
  wheel.warmup(toDraw);

  if (!state.items.length) {
    renderResult({
      id: "none",
      meta_id: "",
      title: "Нет элементов",
      media_type: state.currentMedia,
      category: "",
      poster: "",
      year: "",
      genres: [],
      tags: [],
      platform: "",
      description: "В этом режиме нет подходящих тайтлов.",
      sources: []
    });
  }

  // если сейчас открыта вкладка "Веса" — перерисуем список ключей под новый режим
  const pw = panelWeights();
  if (pw && pw.style.display !== "none") renderWeightsForm();
}

// ---------------------
// Tabs init (Games/Video/Books + Platform)
// ---------------------
function initTabs(wheel) {
  if (dom.mediaTabs) {
    dom.mediaTabs.addEventListener("click", (e) => {
      const btn = e.target.closest(".tab");
      if (!btn || !btn.dataset.media) return;

      state.currentMedia = btn.dataset.media;

      setActive([...dom.mediaTabs.querySelectorAll(".tab")], b => b.dataset.media === state.currentMedia);

      // reset platform when leaving games
      if (state.currentMedia !== "games") {
        state.currentPlatform = "all";
        if (dom.platformTabs) {
          setActive([...dom.platformTabs.querySelectorAll(".tab")], b => b.dataset.platform === "all");
        }
      }

      refreshUI(wheel);
    });
  }

  if (dom.platformTabs) {
    dom.platformTabs.addEventListener("click", (e) => {
      const btn = e.target.closest(".tab");
      if (!btn || !btn.dataset.platform) return;

      state.currentPlatform = btn.dataset.platform;

      setActive([...dom.platformTabs.querySelectorAll(".tab")], b => b.dataset.platform === state.currentPlatform);

      refreshUI(wheel);
    });
  }
}

// ---------------------
// Spin init
// ---------------------
function initSpin(wheel) {
  dom.spinBtn?.addEventListener("click", async () => {
    if (state.isSpinning || state.items.length === 0) return;
    state.isSpinning = true;

    let chosen = null;

    // 1) выбираем честно из ВСЕХ state.items (это полный список)
    try {
      const picked = await pickFromApi(); // { item_id, item, ... }

      // 1) если бэк прислал item целиком — берём его
      chosen = picked?.item ?? null;

      // 2) иначе ищем по item_id в полном списке кандидатов
      if (!chosen && picked?.item_id) {
        chosen = state.items.find(x => String(x.id) === String(picked.item_id)) ?? null;
      }

      // 3) если вдруг не нашли (данные могли поменяться) — fallback на клиентский pick
      if (!chosen) {
        const idx = weightedPickIndex(state.items);
        chosen = state.items[idx];
      }
    } catch (e) {
      console.warn("[Wheel] random API failed, fallback to client pick", e);
      const idx = weightedPickIndex(state.items);
      chosen = state.items[idx];
    }

    if (!chosen) {
      state.isSpinning = false;
      return;
    }

    // 2) собираем витрину и запоминаем
    const limit = Math.min(getWheelLimit(), state.items.length);
    state.wheelItems = buildWheelSubset(state.items, chosen, limit);

    // гарантируем, что chosen есть в витрине
    if (!state.wheelItems.some(x => String(x.id) === String(chosen.id))) {
      state.wheelItems[0] = chosen;
    }

    // --- выберем КОНКРЕТНЫЙ сегмент (если выбранный встречается несколько раз) ---
    const n = state.wheelItems.length;
    const chosenId = String(chosen?.id ?? "");
    const candidates = [];
    for (let i = 0; i < n; i++) {
      if (String(state.wheelItems[i]?.id ?? "") === chosenId) candidates.push(i);
    }
    const chosenIndex = candidates.length
      ? candidates[(Math.random() * candidates.length) | 0]
      : state.wheelItems.findIndex(x => String(x.id) === chosenId);

    // safety: если вдруг -1, то 0
    const safeIndex = chosenIndex >= 0 ? chosenIndex : 0;

    // --- построим "весовую" разметку углов для витрины (как в wheelCanvas) ---
    const ws = state.wheelItems.map(it => Math.max(0, Number(getWeight(it, state.weights)) || 0));
    let totalW = ws.reduce((a, b) => a + b, 0);
    if (totalW <= 0) {
      for (let i = 0; i < ws.length; i++) ws[i] = 1;
      totalW = ws.length;
    }

    const segStart = new Array(n);
    const segSize = new Array(n);
    let acc = 0;
    for (let i = 0; i < n; i++) {
      segStart[i] = acc;
      const ang = (ws[i] / totalW) * (Math.PI * 2);
      segSize[i] = ang;
      acc += ang;
    }

    // 3) крутим уже витрину
    const baseNow = state.baseAngle;
    const pointerAngle = -Math.PI / 2;

    // азартная зона внутри сегмента
    const innerMin = 0.18;
    const innerMax = 0.82;
    const t = innerMin + Math.random() * (innerMax - innerMin);
    const insideAngle = segStart[safeIndex] + segSize[safeIndex] * t;

    // baseAngle такой, чтобы insideAngle оказался под pointerAngle
    let baseNeeded = pointerAngle - insideAngle;

    // нормализация "вперёд"
    const TAU = Math.PI * 2;
    while (baseNeeded < baseNow) baseNeeded += TAU;

    const spins = 6 + ((Math.random() * 5) | 0);
    const target = baseNeeded + spins * TAU;

    animateSpin(
      baseNow,
      target,
      3600,
      () => wheel.drawWheel(state.wheelItems),
      () => {
        state.isSpinning = false;
        setSelected(chosen);

        // history
        postRollToApi(chosen)
          .then(() => {
            const ph = document.getElementById("panel-history");
            if (ph && !ph.classList.contains("is-hidden")) {
              return loadRollHistory(30).then(renderRollHistory);
            }
          })
          .catch((e) => console.warn("[Wheel] postRollToApi failed:", e));
      }
    );
  });
}

// Добавляем загрузку данных с API
async function loadItemsFromApi() {
  const res = await fetch("/api/items");
  if (!res.ok) {
    throw new Error("Не удалось загрузить items");
  }
  return await res.json();
}

// Загрузка рандома
export async function pickFromApi() {
  const res = await fetch(`/api/random?media=${encodeURIComponent(state.currentMedia)}&platform=${encodeURIComponent(state.currentPlatform)}&q=${encodeURIComponent(state.searchQuery || "")}`);
  if (!res.ok) throw new Error(`random error: ${res.status}`);
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || "random failed");

  // главное: item_id
  return { item_id: data.item_id, item: data.item, total: data.total };
}

// Загрузка истории
async function postRollToApi(item) {
  const res = await fetch("/api/rolls", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      media: state.currentMedia,
      platform: state.currentPlatform,
      item_id: item.id,
      title: item.title,
      poster: item.poster,
      category: item.category
    })
  });
  if (!res.ok) throw new Error(`roll post error: ${res.status}`);
  return await res.json();
}

async function loadRollHistory(limit = 20) {
  const res = await fetch(`/api/rolls?limit=${limit}`);
  if (!res.ok) throw new Error(`rolls get error: ${res.status}`);
  return await res.json(); // массив записей
}


// Добавляем загрузку весов с API
async function saveWeightsToApi(weights) {
  const res = await fetch("/api/weights", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(weights),
  });
  if (!res.ok) throw new Error("Не удалось сохранить веса в API");
}
async function loadWeightsFromApi() {
  try {
    const res = await fetch("/api/weights");
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    // API недоступен — это нормально, просто вернём null и включим fallback
    console.warn("[Wheel] loadWeightsFromApi failed:", e);
    return null;
  }
}

//Недоступность API
function showApiErrorOverlay(onRetry) {
  // если уже есть — не создаём заново
  if (document.getElementById("api-error-overlay")) return;

  const overlay = document.createElement("div");
  overlay.id = "api-error-overlay";
  overlay.innerHTML = `
    <div class="api-error-card">
      <h2>API недоступен</h2>
      <p>Не удалось загрузить данные.<br>Проверь backend и попробуй ещё раз.</p>
      <button class="tab retry-btn">Повторить</button>
    </div>
  `;

  overlay.querySelector(".retry-btn").addEventListener("click", () => {
    overlay.remove();
    onRetry();
  });

  document.body.appendChild(overlay);
}
(function injectApiErrorStyles() {
  const style = document.createElement("style");
  style.textContent = `
    #api-error-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,.65);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 9999;
      backdrop-filter: blur(4px);
    }

    .api-error-card {
      background: rgba(0,0,0,.75);
      border: 1px solid rgba(255,255,255,.15);
      border-radius: 16px;
      padding: 24px 28px;
      width: 320px;
      text-align: center;
      box-shadow: 0 20px 50px rgba(0,0,0,.6);
    }

    .api-error-card h2 {
      margin: 0 0 10px;
      font-size: 18px;
      font-weight: 900;
      letter-spacing: .5px;
    }

    .api-error-card p {
      margin: 0 0 16px;
      font-size: 13px;
      opacity: .85;
      line-height: 1.4;
    }

    .api-error-card .retry-btn {
      padding: 10px 16px;
      font-size: 12px;
      font-weight: 800;
      border-radius: 999px;
    }
  `;
  document.head.appendChild(style);
})();

function buildWheelSubset(allItems, chosenItem, limit = 10) {
  const MIN_SEGMENTS = 6; // чтобы колесо не выглядело "пустым"
  const want = Math.max(MIN_SEGMENTS, Math.max(2, limit | 0));

  const unique = (allItems || []).slice();
  if (!unique.length) return [];

  // 1) Соберём базовый список уникальных тайтлов (не больше want)
  //    Если элементов больше, берём случайные, но гарантируем наличие выбранного.
  const chosenId = String(chosenItem?.id ?? "");
  const pool = unique.filter(x => String(x?.id ?? "") !== chosenId);

  // shuffle pool
  for (let i = pool.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }

  const baseCount = Math.min(want, unique.length);
  const picked = pool.slice(0, Math.max(0, baseCount - 1));

  // вставим chosen в случайную позицию, чтобы он не был всегда первым
  const out = picked.slice();
  const pos = (Math.random() * (out.length + 1)) | 0;
  out.splice(pos, 0, chosenItem || unique[0]);

  // 2) Если уникальных не хватает — добиваем дублями, стараясь чередовать
  //    (циклически берём из перемешанного "out", но не кладём одинаковые подряд)
  if (out.length < want) {
    const src = out.slice();
    let si = 0;
    while (out.length < want && src.length) {
      const cand = src[si % src.length];
      si++;
      const last = out[out.length - 1];
      if (last && String(last.id) === String(cand.id)) continue; // не подряд
      out.push(cand);
    }
  }

  // 3) Финальный проход: если всё же есть одинаковые подряд — попробуем "раздвинуть"
  for (let i = 1; i < out.length; i++) {
    if (String(out[i].id) === String(out[i - 1].id)) {
      // найдём дальше элемент с другим id и свапнем
      let j = i + 1;
      while (j < out.length && String(out[j].id) === String(out[i].id)) j++;
      if (j < out.length) {
        [out[i], out[j]] = [out[j], out[i]];
      }
    }
  }

  return out;
}

// ===== init =====
async function initApp() {
  initDom();

  const ok = await healthCheck();
  if (!ok) {
    showApiErrorOverlay(initApp);
    return;
  }

  const searchInput = document.getElementById("search-input");
  const searchClear = document.getElementById("search-clear");

  if (searchInput) {
    searchInput.value = state.searchQuery || "";
    searchInput.addEventListener("input", () => {
      state.searchQuery = searchInput.value;
      if (wheelRef) refreshUI(wheelRef);
    });
  }

  if (searchClear) {
    searchClear.addEventListener("click", () => {
      state.searchQuery = "";
      if (searchInput) searchInput.value = "";
      if (wheelRef) refreshUI(wheelRef);
    });
  }

  state.currentMedia = "video";
  state.currentPlatform = "all";
  state.selectedId = null;

  state.weights = { ...CATEGORY_WEIGHTS_DEFAULTS };
  const apiWeights = await loadWeightsFromApi();
  if (apiWeights && typeof apiWeights === "object") {
    // накатываем только числа >= 0
    for (const [k, v] of Object.entries(apiWeights)) {
      const n = Number(v);
      if (Number.isFinite(n) && n >= 0) state.weights[k] = n;
    }
  } else {
    // fallback на localStorage
    loadWeights();
  }

  try {
    state.allItems = await loadItemsFromApi();
  } catch (e) {
    console.error("[Wheel] API error:", e);
    showApiErrorOverlay(initApp);
    return;
  }

  if (dom.platformTabs) dom.platformTabs.style.display = "none";
  if (dom.mediaTabs) {
    setActive([...dom.mediaTabs.querySelectorAll(".tab")],
      b => b.dataset.media === state.currentMedia
    );
  }
  if (dom.platformTabs) {
    setActive([...dom.platformTabs.querySelectorAll(".tab")],
      b => b.dataset.platform === state.currentPlatform
    );
  }

  const wheel = createWheelRenderer();
  if (!wheel) {
    console.error("[Wheel] Не удалось инициализировать колесо");
    return;
  }
  wheelRef = wheel;

  initTabs(wheel);
  initSpin(wheel);
  initRightTabs();
  refreshUI(wheel);

  setRightPanel("list");
  
}

initApp();
