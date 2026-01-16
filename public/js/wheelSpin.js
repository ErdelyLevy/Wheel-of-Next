// js/wheelSpin.js
import { drawWheel, buildWeightedSegments } from "./wheelRender.js";
import { startSpinSound } from "./main.js";

function normRad(a) {
  const two = Math.PI * 2;
  a = a % two;
  if (a < 0) a += two;
  return a;
}

function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

function pickRandomInsideSegment(start, end, padPct = 0.12) {
  const len = end - start;
  if (len <= 0) return start;

  const pad = len * padPct;
  const lo = start + pad;
  const hi = end - pad;

  if (hi <= lo) {
    // сегмент слишком узкий — fallback в центр
    return (start + end) / 2;
  }

  return lo + Math.random() * (hi - lo);
}

/**
 * Крутит wheel так, чтобы winnerId оказался под стрелкой сверху.
 * drawWheel использует ROT0 = -PI/2 + rotation, поэтому
 * чтобы середина сектора попала на "верх", нужно rotation = -midAngle.
 */
export function spinToWinner({
  canvas,
  items,
  winnerId,
  durationSec = 10,
  speed = 1,
} = {}) {
  return new Promise((resolve) => {
    if (!canvas) return resolve();
    const arr = Array.isArray(items) ? items : [];
    if (!arr.length) return resolve();

    const id = String(winnerId || "");
    const segs = buildWeightedSegments(arr);

    // ✅ winner может быть "порезан": ищем все сегменты победителя
    const winnerSegs = id
      ? segs.filter((s) => {
          const it = s?.item;
          const sid = String(it?.id ?? "");
          const sliceOf = it?.__sliceOf != null ? String(it.__sliceOf) : "";
          return sid === id || sliceOf === id;
        })
      : [];

    // ✅ выбираем ОДИН сегмент победителя (любой)
    const seg =
      winnerSegs.length > 0
        ? winnerSegs[Math.floor(Math.random() * winnerSegs.length)]
        : null;

    // если победителя нет — fallback
    const targetAngle = seg
      ? pickRandomInsideSegment(seg.start, seg.end, 0.12)
      : 0;

    const targetBase = normRad(-targetAngle);
    const from = Number(canvas.__rotation || 0);

    const baseTurns = 4;
    const sp = Math.max(0.1, Number(speed || 1)); // защита от 0 и NaN
    const turns = baseTurns + (sp - 1) * 3; // плавное влияние speed

    const durMs = Math.max(300, Number(durationSec || 10) * 1000);

    const two = Math.PI * 2;
    let to = targetBase + turns * two;

    while (to <= from + two) to += two;

    const t0 = performance.now();

    startSpinSound({ durationSec: durMs / 1000, speed });

    canvas.__spinning = true;

    function tick(now) {
      const t = Math.min(1, (now - t0) / durMs);
      const k = easeOutCubic(t);
      const rot = from + (to - from) * k;

      canvas.__rotation = rot;
      drawWheel(canvas, arr, { rotation: rot, animate: true });

      if (t < 1) {
        requestAnimationFrame(tick);
      } else {
        if (window.requestWheelRedraw) window.requestWheelRedraw();
        resolve();
      }
    }

    requestAnimationFrame(tick);
  });
}
