import { showToast } from "../../shared/showToast.js";
import {
  WHEEL_BASE,
  apiRandomBegin,
  apiRandomAbort,
  apiRandomCommit,
  apiRandomWinner,
} from "../../shared/api.js";
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
  setSpinSoundVolume,
  stopSpinSound,
  isSoundMuted,
  setSoundMuted,
} from "./spinSound.js";

const BASE_OMEGA = 2.8; // rad/s at speed=1

export function initRollButton() {
  const btn = document.getElementById("spin-btn");
  const canvas = document.getElementById("wheel");
  if (!btn || !canvas) return;

  btn.addEventListener("click", async () => {
    ensureSpinAudio(`${WHEEL_BASE}/sounds/spin.mp3`);
    ensureDingAudio(`${WHEEL_BASE}/sounds/ding.mp3`);
    canvas.__selectedKey = null;
    canvas.__hoverKey = null;
    drawWheel(canvas, getState().wheel?.items || [], {
      rotation: Number(canvas.__rotation || 0),
      hoverKey: null,
      selectedKey: null,
    });

    try {
      btn.disabled = true;
      const s = getState();
      const items = s.wheel?.items || [];
      if (!items.length) return alert("Нет колеса для вращения");

      const snapshotId = s.wheel?.snapshotId || null;
      const baseHistoryId = s.wheel?.baseHistoryId || null;
      if (!snapshotId && !baseHistoryId) return alert("Нет снимка колеса");

      const durationSec = Number(s.spin?.duration || 20);
      const speed = Number(s.spin?.speed || 1);

      const idle = startIdleSpin({ canvas, items, speed });
      const idleStart = performance.now();
      startSpinSound();

      let snap;
      try {
        snap = await apiRandomWinner({
          snapshotId,
          baseHistoryId,
        });
      } catch (e) {
        idle.stop();
        canvas.__spinning = false;
        document.documentElement.classList.remove("is-spinning");
        await stopSpinSound({ fadeMs: 150 });
        throw e;
      }

      const idleMs = performance.now() - idleStart;
      idle.stop();

      const winnerId = String(snap.winner_id ?? snap.winner?.id ?? "");
      const winnerItem = snap.winner || null;
      const winnerIndex = Number.isInteger(snap.winner_index)
        ? snap.winner_index
        : null;

      const presetId = getActivePresetId();
      let nextSnapshotPromise = null;
      if (!baseHistoryId && presetId) {
        nextSnapshotPromise = apiRandomBegin(presetId).catch(() => null);
      }

      const minTravelMs = Math.max(0, durationSec * 1000 - idleMs);

      // 1) докручиваем до победителя
      await spinToWinner({
        canvas,
        items,
        winnerId,
        minDurationMs: minTravelMs,
        speed,
        startSound: false,
      });

      await stopSpinSound({ fadeMs: 250 });

      // 2) покажем тост с победителем (до звука, чтобы не пропасть при ошибке audio)
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

      // 3) теперь показываем победителя слева
      if (winnerItem) openResult(winnerItem);

      // 4) коммитим после показа
      if (winnerIndex != null) {
        try {
          await apiRandomCommit({
            snapshotId: baseHistoryId ? null : snapshotId,
            baseHistoryId,
            winnerIndex,
          });
        } catch {}
      }

      // 5) обновим историю
      window.refreshHistory?.();

      if (!baseHistoryId && nextSnapshotPromise) {
        nextSnapshotPromise
          .then((nextSnap) => {
            const activeId = getActivePresetId();
            if (
              nextSnap?.wheel_items?.length &&
              String(activeId) === String(presetId)
            ) {
              applyWheelSnapshot({
                wheelItems: structuredClone(nextSnap.wheel_items || []),
                winnerId: null,
                winnerItem: null,
                snapshotId: nextSnap.snapshot_id ?? null,
                baseHistoryId: null,
              });
              window.requestWheelRedraw?.();
            }
          })
          .catch(() => {});
      }
    } catch (e) {
      alert(e.message || e);
    } finally {
      btn.disabled = false;
    }
  });
}

export function initWheelRefreshButton() {
  const btn = document.getElementById("refresh-wheel");
  const canvas = document.getElementById("wheel");
  if (!btn || !canvas) return;

  btn.addEventListener("click", async () => {
    if (canvas.__spinning) {
      showToast?.("Подожди окончания вращения", 1200);
      return;
    }

    const presetId = getActivePresetId();
    if (!presetId) return alert("Выбери пресет");

    try {
      btn.disabled = true;
      const s = getState();
      const snapshotId = s.wheel?.snapshotId || null;
      const baseHistoryId = s.wheel?.baseHistoryId || null;

      if (snapshotId && !baseHistoryId) {
        try {
          await apiRandomAbort(snapshotId);
        } catch {}
      }

      const snap = await apiRandomBegin(presetId);
      if (snap?.wheel_items?.length) {
        applyWheelSnapshot({
          wheelItems: structuredClone(snap.wheel_items || []),
          winnerId: null,
          winnerItem: null,
          snapshotId: snap.snapshot_id ?? null,
          baseHistoryId: null,
        });
        window.requestWheelRedraw?.();
      }
    } catch {
      showToast?.("Не удалось обновить колесо", 1400);
    } finally {
      btn.disabled = false;
    }
  });
}

export function initSoundToggleButton() {
  const btn = document.getElementById("mute-sound");
  if (!btn) return;

  const applyState = (muted) => {
    btn.classList.toggle("is-muted", muted);
    btn.setAttribute("aria-pressed", muted ? "true" : "false");
    btn.setAttribute("aria-label", muted ? "Включить звук" : "Выключить звук");
    btn.title = muted ? "Включить звук" : "Выключить звук";
  };

  applyState(isSoundMuted());

  btn.addEventListener("click", () => {
    const next = !isSoundMuted();
    setSoundMuted(next);
    applyState(next);
  });
}

function startIdleSpin({ canvas, items, speed = 1 } = {}) {
  let active = true;
  const arr = Array.isArray(items) ? items : [];
  const sp = Math.max(0.05, Number(speed || 1));
  const omega = BASE_OMEGA * sp;

  canvas.__spinning = true;
  document.documentElement.classList.add("is-spinning");

  let last = performance.now();
  function tick(now) {
    if (!active) return;
    const dt = Math.max(0, (now - last) / 1000);
    last = now;

    const rot = Number(canvas.__rotation || 0) + omega * dt;
    canvas.__rotation = rot;
    drawWheel(canvas, arr, { rotation: rot, animate: true });

    requestAnimationFrame(tick);
  }

  requestAnimationFrame(tick);

  return {
    stop() {
      active = false;
    },
  };
}

function spinToWinner({
  canvas,
  items,
  winnerId,
  minDurationMs = 0,
  speed = 1,
  startSound = true,
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

    const two = Math.PI * 2;
    const sp = Math.max(0.05, Number(speed || 1)); // защита от 0 и NaN
    const omega = BASE_OMEGA * sp;

    let distance = normRad(targetBase - from);
    let durMs = durationForDistance(distance, omega);
    const minMs = Math.max(0, Number(minDurationMs || 0));

    while (durMs < minMs) {
      distance += two;
      durMs = durationForDistance(distance, omega);
    }

    const totalSec = Math.max(0.001, durMs / 1000);
    const constSec = totalSec * 0.8;
    const decelSec = Math.max(0.001, totalSec - constSec);

    const t0 = performance.now();
    if (startSound) startSpinSound();

    canvas.__spinning = true;
    document.documentElement.classList.add("is-spinning");

    function tick(now) {
      const t = Math.min(totalSec, (now - t0) / 1000);
      let dist = 0;

      if (t <= constSec) {
        dist = omega * t;
      } else {
        const td = t - constSec;
        dist =
          omega * constSec + omega * td - 0.5 * omega * (td * td) / decelSec;
        const speedFactor = Math.max(0, 1 - td / decelSec);
        setSpinSoundVolume(speedFactor);
      }

      const rot = from + dist;

      canvas.__rotation = rot;
      drawWheel(canvas, arr, { rotation: rot, animate: true });

      if (t < totalSec) {
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

function durationForDistance(distance, omega) {
  const d = Math.max(0, Number(distance) || 0);
  const w = Math.max(0.001, Number(omega) || 0.001);
  // 80% constant speed + 20% linear decel => 0.9 * w * T
  return (d / (0.9 * w)) * 1000;
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

