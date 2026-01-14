// js/wheelSpin.js
import { drawWheel, buildWeightedSegments } from "./wheelRender.js";
import { startSpinSound, stopSpinSound, playDing } from "./spinSound.js";

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
    const seg = segs.find((s) => String(s.item?.id) === id);

    // если победителя нет — fallback
    const targetAngle = seg
      ? pickRandomInsideSegment(seg.start, seg.end, 0.12)
      : 0;

    // rotation, который ставит targetAngle под стрелку (стрелка сверху)
    const targetBase = normRad(-targetAngle);

    const from = Number(canvas.__rotation || 0);

    // сколько оборотов сделать перед остановкой
    const baseTurns = 4; // минимум
    const extraTurns = Math.max(0, Math.round(Number(speed || 1) * 2));
    const turns = baseTurns + extraTurns;

    // финальный rotation: targetBase + N*2PI, но > from
    const two = Math.PI * 2;
    let to = targetBase + turns * two;

    // гарантируем, что "to" впереди "from"
    while (to <= from + two) to += two;

    const t0 = performance.now();
    const durMs = Math.max(300, Number(durationSec || 10) * 1000);

    // 🔊 START SPIN SOUND
    startSpinSound({
      durationSec: durMs / 1000,
      speed,
    });

    function tick(now) {
      const t = Math.min(1, (now - t0) / durMs);
      const k = easeOutCubic(t);
      const rot = from + (to - from) * k;

      canvas.__rotation = rot;
      drawWheel(canvas, arr, {
        rotation: rot,
        onUpdate: () => {
          // когда догрузятся постеры — перерисуем на текущем rot
          drawWheel(canvas, arr, { rotation: canvas.__rotation || rot });
        },
      });

      if (t < 1) {
        requestAnimationFrame(tick);
      } else {
        resolve();
      }
    }

    requestAnimationFrame(tick);
  });
}
