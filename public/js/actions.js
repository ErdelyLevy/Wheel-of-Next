// public/js/actions.js
import { getState, setState } from "./state.js";
import { preloadPosters, getPosterAspect } from "./posterPreload.js";

/**
 * Открыть карточку слева (результат)
 */
export function openResult(item) {
  console.log("[openResult]", {
    id: item?.id,
    meta_id: item?.meta_id,
    title: item?.title,
    t: performance.now().toFixed(0),
    stack: new Error().stack,
  });

  setState({
    result: { item: item || null, updatedAt: Date.now() },
  });
}

const FALLBACK_ASPECT = 2 / 3; // если постер ещё не загружен
const OVERSCAN = 1.06; // чуть шире, чтобы не ловить щели
const MIN_N = 6;
const MAX_N = 200;

function clampInt(n, min, max) {
  n = Number(n);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, Math.trunc(n)));
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

function computeTargetSegments({ outerR, innerR, items }) {
  const h = outerR - innerR;
  if (!(h > 0)) return items.length || 0;

  // собираем аспекты загруженных постеров (w/h)
  const aspects = [];
  for (const it of items || []) {
    const url = String(it?.poster || "").trim();
    const a = getPosterAspect(url);
    if (Number.isFinite(a) && a > 0.1 && a < 5) aspects.push(a);
  }
  aspects.sort((a, b) => a - b);

  // берём “узкий” аспект (20-й перцентиль), чтобы не было пустот у узких постеров
  let aspect = FALLBACK_ASPECT;
  if (aspects.length) {
    const p20 = aspects[Math.floor(aspects.length * 0.2)];
    aspect = Math.max(0.25, Math.min(2.5, p20));
  }

  const wImg = h * aspect;
  const k = wImg / (2 * outerR * OVERSCAN);
  if (!(k > 0)) return items.length || 0;

  // tan(pi/n) <= k  => n >= pi/atan(k)
  const n = Math.ceil(Math.PI / Math.atan(k));

  return clampInt(Math.max(n, items.length || 0), MIN_N, MAX_N);
}

function expandWheelItemsToN(items, targetN, winnerId) {
  const base = Array.isArray(items) ? items.slice() : [];
  if (!base.length) return base;
  if (targetN <= base.length) return base;

  const wid = winnerId != null ? String(winnerId) : null;

  // стараемся не плодить победителя
  const fillers = wid
    ? base.filter((x) => String(x?.id) !== wid)
    : base.slice();

  // если кроме победителя ничего нет — придётся клонировать его же
  if (!fillers.length) {
    while (base.length < targetN) base.push(base[0]);
    return base;
  }

  let j = 0;
  while (base.length < targetN) {
    base.push(fillers[j % fillers.length]);
    j++;
  }
  return base;
}

function autoExpandWheelItems(items, winnerId) {
  const geom = getWheelGeometry();
  if (!geom || !items.length) return items;

  const targetN = computeTargetSegments({
    outerR: geom.outerR,
    innerR: geom.innerR,
    items,
  });

  if (targetN > items.length) {
    return expandWheelItemsToN(items, targetN, winnerId);
  }
  return items;
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

  const baseItems = Array.isArray(wheelItems) ? wheelItems : [];

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
