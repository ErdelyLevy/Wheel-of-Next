// public/js/actions.js
import { getState, setState } from "./state.js";
import { preloadPosters, getPosterAspect } from "./posterPreload.js";
import { clampInt } from "./uiUtils.js";

/**
 * Открыть карточку слева (результат)
 */
export function openResult(item) {
  setState({
    result: { item: item || null, updatedAt: Date.now() },
  });
}

function getWheelGeometry() {
  const canvas = document.getElementById("wheel");
  if (!canvas) return null;

  const rect = canvas.getBoundingClientRect();
  const size = Math.min(rect.width, rect.height);
  if (!(size > 0)) return null;

  const outerR = size / 2 - 10;

  let innerR = Math.max(outerR * 0.2, 52);

  const btn = document.getElementById("spin-btn");
  if (btn) {
    const b = btn.getBoundingClientRect();
    innerR = Math.max(innerR, b.width / 2);
  }

  return { outerR, innerR };
}

const FALLBACK_ASPECT = 2 / 3; // если постер ещё не загружен
const OVERSCAN = 1.06; // чуть шире, чтобы не ловить щели
const MIN_N = 6;
const MAX_N = 200;

// ⚠️ должно совпадать с тем, что ты реально рисуешь в drawWheel
// сейчас у тебя: zoneW = zoneH * 0.62, а zoneH ≈ R (+over)
// значит width ~ outerR * 0.62 (плюс небольшой over)
const POSTER_W_K = 0.62;
const POSTER_OVER = 6; // такой же "over", как в drawWheel

function getItemW(it) {
  const w = Number(it?.w);
  return Number.isFinite(w) && w > 0 ? w : 1;
}

function splitWideSegments(items, winnerId, outerR) {
  const arr = Array.isArray(items) ? items.slice() : [];
  if (!arr.length) return arr;

  const wid = winnerId != null ? String(winnerId) : null;

  const totalW = arr.reduce((sum, it) => sum + getItemW(it), 0) || 1;

  // ширина постера, которой мы пытаемся "закрыть" внешний край сектора
  const posterW = (outerR + POSTER_OVER) * POSTER_W_K;

  const twoPi = Math.PI * 2;

  // 1) режем каждый item в "свою пачку"
  const groups = [];
  for (let i = 0; i < arr.length; i++) {
    const it = arr[i];
    const id = String(it?.id ?? "");

    const w = getItemW(it);
    const da = (w / totalW) * twoPi;

    // ширина сектора по внешней окружности (chord)
    const chord = 2 * outerR * Math.sin(da / 2);

    // сколько частей нужно, чтобы chord <= posterW * OVERSCAN
    let parts = Math.ceil(chord / (posterW * OVERSCAN));

    // победителя не режем
    if (wid && id && id === wid) parts = 1;

    parts = clampInt(parts, 1, 12);

    if (parts === 1) {
      groups.push([it]);
      continue;
    }

    const wEach = w / parts;
    const pack = [];
    for (let k = 0; k < parts; k++) {
      pack.push({
        ...it,
        w: wEach,
        __slice: k,
        __sliceN: parts,
        __sliceOf: it?.id ?? null,
      });
    }
    groups.push(pack);
  }

  // 2) разбрасываем пачки по кругу (round-robin)
  const res = [];
  let idx = 0;
  let safety = 0;

  while (res.length < MAX_N) {
    let took = false;

    for (let g = 0; g < groups.length && res.length < MAX_N; g++) {
      const pack = groups[(g + idx) % groups.length];
      if (pack && pack.length) {
        res.push(pack.shift());
        took = true;
      }
    }

    idx++;
    if (!took) break;

    // защита от бесконечных циклов на случай странных данных
    safety++;
    if (safety > MAX_N * 3) break;
  }

  // 3) если мало элементов — дотягиваем как раньше (не подряд одним и тем же)
  if (res.length < MIN_N && res.length) {
    const base = res.slice();
    let j = 0;
    while (base.length < MIN_N && base.length < MAX_N) {
      const it = res[j % res.length];
      base.push({ ...it, w: getItemW(it) });
      j++;
    }
    return base;
  }

  return res;
}

function autoExpandWheelItems(items, winnerId) {
  const geom = getWheelGeometry();
  if (!geom || !items?.length) return items;

  // ключ: режем именно широкие сектора на уровне весов
  const split = splitWideSegments(items, winnerId, geom.outerR);
  return split;
}

function tryAutoExpandWheel(winnerId) {
  const s = getState();
  const cur = s?.wheel?.items || [];
  if (!cur.length) return;

  const expanded = autoExpandWheelItems(cur, winnerId);
  if (expanded.length === cur.length) return;

  setState({
    wheel: {
      ...s.wheel,
      items: expanded,
      updatedAt: Date.now(),
    },
  });
}

/**
 * Применить снимок колеса (items в нужном порядке + winnerId)
 * - запускает preload постеров
 * - автоматически доклонирует элементы, чтобы сегменты не были пустыми
 */
export function applyWheelSnapshot({ wheelItems, winnerId, winnerItem } = {}) {
  const s = getState();

  const computedWinnerId =
    winnerId ?? (winnerItem?.id != null ? winnerItem.id : null);

  // ✅ важное: делаем "свой" массив и "свои" объекты
  const baseItems = Array.isArray(wheelItems)
    ? structuredClone(wheelItems)
    : [];

  // прелоадим постеры; когда что-то загрузится — расширим при необходимости
  preloadPosters(baseItems, () => tryAutoExpandWheel(computedWinnerId));

  const expanded = autoExpandWheelItems(baseItems, computedWinnerId);

  setState({
    result: winnerItem ? { item: winnerItem } : s.result,
    wheel: {
      items: expanded,
      winnerId: computedWinnerId,
      updatedAt: Date.now(),
    },
  });
}
