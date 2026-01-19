import { getState, subscribe } from "../../shared/state.js";
import { drawWheel } from "./drawWheel.js";
import { resizeCanvasToDisplaySize } from "./resizeCanvasToDisplaySize.js";

export function initWheelCanvas() {
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
