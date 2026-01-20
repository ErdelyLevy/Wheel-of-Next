import { getState, subscribe } from "../../shared/state.js";
import { openResult } from "../leftPanel/openResult.js";
import { drawWheel } from "./drawWheel.js";
import { buildWeightedSegments } from "./buildWeightedSegments.js";
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
        hoverKey: canvas.__hoverKey || null,
        selectedKey: canvas.__selectedKey || null,
      });
    });
  };

  // 1) перерисовка при любом обновлении wheel (snapshot / expand / preload)
  let last = null;
  subscribe(() => {
    const u = getState()?.wheel?.updatedAt || null;
    if (u && u !== last) {
      last = u;
      canvas.__hoverKey = null;
      canvas.__selectedKey = null;
      canvas.style.cursor = "";
      scheduleRedraw();
    }
  });

  // 2) перерисовка на ресайз
  window.addEventListener("resize", scheduleRedraw);

  // 3) первый рендер (на случай если state уже заполнен)
  scheduleRedraw();

  function setHover(key) {
    const next = key || null;
    if (canvas.__hoverKey === next) return;
    canvas.__hoverKey = next;
    canvas.style.cursor = next ? "pointer" : "";
    scheduleRedraw();
  }

  function hitTest(clientX, clientY) {
    const s = getState();
    const items = s?.wheel?.items || [];
    if (!items.length) return null;

    const rect = canvas.getBoundingClientRect();
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const dx = x - cx;
    const dy = y - cy;
    const r = Math.hypot(dx, dy);
    const R = Math.min(rect.width, rect.height) / 2 - 10;
    if (!(r > 0 && r <= R)) return null;
    if (r < R * 0.22) return null;

    const rotation = Number(canvas.__rotation || 0);
    const ROT0 = -Math.PI / 2 + rotation;
    const angle = Math.atan2(dy, dx);
    const local = normRad(angle - ROT0);

    const segs = buildWeightedSegments(items);
    for (let i = 0; i < segs.length; i++) {
      const seg = segs[i];
      if (local >= seg.start && local < seg.end) {
        const item = seg.item;
        return { item, key: getItemKey(item) };
      }
    }
    return null;
  }

  canvas.addEventListener("pointermove", (e) => {
    if (e.pointerType && e.pointerType !== "mouse") return;
    if (canvas.__spinning) return;
    const hit = hitTest(e.clientX, e.clientY);
    setHover(hit?.key || null);
  });

  canvas.addEventListener("pointerleave", () => {
    setHover(null);
  });

  canvas.addEventListener("click", (e) => {
    if (canvas.__spinning) return;
    const hit = hitTest(e.clientX, e.clientY);
    if (!hit?.item) return;

    canvas.__selectedKey = hit.key || null;
    scheduleRedraw();
    openResult(hit.item);
  });
}

function normRad(a) {
  const two = Math.PI * 2;
  a = a % two;
  if (a < 0) a += two;
  return a;
}

function getItemKey(it) {
  if (!it) return "";
  const baseId =
    it.__sliceOf != null ? String(it.__sliceOf) : String(it.id ?? "");

  if (it.__kind === "vc" || it.__vc_id != null) {
    const vcId = String(it.__vc_id || baseId || "");
    return `vc:${vcId}`;
  }
  return `it:${baseId}`;
}

