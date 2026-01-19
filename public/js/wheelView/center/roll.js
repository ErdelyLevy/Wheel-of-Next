import { showToast } from "../../shared/showToast.js";
import { WHEEL_BASE, apiRoll } from "../../shared/api.js";
import { escapeHtml } from "../../shared/utils.js";
import { getActivePresetId } from "./tabs.js";
import { getState } from "../../shared/state.js";
import { openResult } from "../leftPanel/openResult.js";
import { applyWheelSnapshot } from "./applyWheelSnapshot.js";
import { buildWeightedSegments } from "./buildWeightedSegments.js";
import { drawWheel } from "./drawWheel.js";
import {
  ensureDingAudio,
  ensureSpinAudio,
  playDing,
  startSpinSound,
  stopSpinSound,
} from "./spinSound.js";

export function initRollButton() {
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

      console.log("[roll] durationSec/speed", {
        durationSec,
        speed,
        spin: s.spin,
      });

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
          { html: true },
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

function spinToWinner({
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
    document.documentElement.classList.add("is-spinning");

    function tick(now) {
      const t = Math.min(1, (now - t0) / durMs);
      const k = easeOutCubic(t);
      const rot = from + (to - from) * k;

      canvas.__rotation = rot;
      drawWheel(canvas, arr, { rotation: rot, animate: true });

      if (t < 1) {
        requestAnimationFrame(tick);
      } else {
        canvas.__spinning = false;
        document.documentElement.classList.remove("is-spinning");
        if (window.requestWheelRedraw) window.requestWheelRedraw();
        resolve();
      }
    }

    requestAnimationFrame(tick);
  });
}

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
