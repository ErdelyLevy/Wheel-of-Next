// js/state.js — Модуль управления состоянием приложения

import { CATEGORY_WEIGHTS_DEFAULTS } from "./data.js";

const LS_KEY = "wheel.weights.v1";

export const state = {
  currentMedia: "video", // Текущий медиа тип (video, games, books)
  currentPlatform: "all", // Текущая платформа (для игр)
  allItems: [], // Все загруженные элементы
  items: [], // Отфильтрованные элементы
  baseAngle: 0, // Базовый угол вращения колеса
  isSpinning: false, // Флаг вращения
  selectedId: null, // ID выбранного элемента
  searchQuery: "", // Поисковый запрос
  // ✅ вот тут будут актуальные веса
  weights: { ...CATEGORY_WEIGHTS_DEFAULTS } // Весовые коэффициенты
};

export function loadWeights() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return;

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return;

    // накатываем только числа
    for (const [k, v] of Object.entries(parsed)) {
      const n = Number(v);
      if (Number.isFinite(n) && n >= 0) state.weights[k] = n;
    }
  } catch (e) {
    console.warn("[Wheel] loadWeights failed:", e);
  }
}

export function saveWeights() {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(state.weights));
  } catch (e) {
    console.warn("[Wheel] saveWeights failed:", e);
  }
}

export function setWeight(key, value) {
  let n = Number(value);
  if (!Number.isFinite(n)) return;

  n = Math.max(0, Math.min(10, n));
  state.weights[key] = n;
}

export function getWeight(item) {
  const key = resolveWeightKey(item);
  const w = state.weights?.[key];

  // защита от NaN/отрицательных
  const n = Number(w);
  return Number.isFinite(n) && n > 0 ? n : 0;
}


export function weightedPickIndex(items) {
  const weights = items.map(getWeight);
  const total = weights.reduce((a, b) => a + b, 0);

  if (total <= 0) return Math.floor(Math.random() * items.length);

  let r = Math.random() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r <= 0) return i;
  }
  return items.length - 1;
}

export function getFilteredItems(all) {
  if (state.currentMedia === "games") {
    return all.filter(x =>
      x.media_type === "game" &&
      (state.currentPlatform === "all" || (x.platform || "").toLowerCase() === state.currentPlatform)
    );
  }
  if (state.currentMedia === "books") {
    return all.filter(x => x.media_type === "book");
  }
  return all.filter(x => x.media_type === "anime" || x.media_type === "tv" || x.media_type === "movie");
}

export function computeTargetAngleForIndex(i, n) {
  const slice = (Math.PI * 2) / n;
  const pointerAngle = -Math.PI / 2; // вверх
  return pointerAngle - (i * slice + slice / 2);
}

export function resolveWeightKey(item) {
  const cat = (item.category || "").toLowerCase();
  const media = (item.media_type || "").toLowerCase();

  // Games: как мы уже сделали
  if (media === "games" || cat.includes("_game")) {
    if (cat.startsWith("continue_game")) return "continue_game";
    if (cat.startsWith("new_game")) return "new_game";
    if (cat.startsWith("single_game")) return "single_game";
    return cat;
  }

  // ✅ Video: только TV/Anime + watchlist->continue_tv
  // Поддержим разные написания/форматы
  if (cat === "watchlist") return "continue_tv";

  if (cat === "new tv" || cat === "new_tv") return "new_tv";
  if (cat === "single tv" || cat === "single_tv") return "single_tv";

  if (cat === "continue anime" || cat === "continue_anime") return "continue_anime";
  if (cat === "new anime" || cat === "new_anime") return "new_anime";
  if (cat === "single anime" || cat === "single_anime") return "single_anime";

  // books / прочее
  return cat;
}

state.wheelItems = []; // то, что рисуем на колесе (<=10)