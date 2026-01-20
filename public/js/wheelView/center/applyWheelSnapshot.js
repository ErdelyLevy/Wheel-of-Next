import { getState, setState } from "../../shared/state.js";

const OVERSCAN = 1.06;
const MIN_N = 6;
const MAX_N = 200;
const POSTER_W_K = 0.62;
const POSTER_OVER = 6;

export function applyWheelSnapshot({
  wheelItems,
  winnerId,
  winnerItem,
  snapshotId,
  baseHistoryId,
} = {}) {
  const s = getState();

  const computedWinnerId =
    winnerId ?? (winnerItem?.id != null ? winnerItem.id : null);

  // ✅ важное: делаем "свой" массив и "свои" объекты
  const baseItems = Array.isArray(wheelItems)
    ? structuredClone(wheelItems)
    : [];

  // ✅ 1) расширяем сразу (это и есть то, что реально будет на колесе)
  const expanded = autoExpandWheelItems(baseItems, computedWinnerId);

  // ✅ 2) сначала обновляем state — колесо/результат должны появиться мгновенно (fallback’ами)
  const nextSnapshotId =
    snapshotId !== undefined ? snapshotId : s.wheel?.snapshotId ?? null;
  const nextBaseHistoryId =
    baseHistoryId !== undefined ? baseHistoryId : s.wheel?.baseHistoryId ?? null;

  setState({
    result: winnerItem ? { item: winnerItem } : s.result,
    wheel: {
      items: expanded,
      winnerId: computedWinnerId,
      updatedAt: Date.now(),
      snapshotId: nextSnapshotId,
      baseHistoryId: nextBaseHistoryId,
    },
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

function splitWideSegments(items, winnerId, outerR) {
  const arr = Array.isArray(items) ? items.slice() : [];
  if (!arr.length) return arr;

  const wid = winnerId != null ? String(winnerId) : null;

  // totalW по "текущим" весам (если они уже были изменены — ок)
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
    parts = clampInt(parts, 1, 12);

    const isWinner = wid && id && id === wid;

    if (parts === 1) {
      // ✅ даже если parts=1, пометим winner
      groups.push([{ ...it, __winner: !!isWinner }]);
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
        __winner: !!isWinner,
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

function clampInt(v, min, max) {
  const n = Number(v);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

function getItemW(it) {
  const w = Number(it?.w);
  return Number.isFinite(w) && w > 0 ? w : 1;
}
