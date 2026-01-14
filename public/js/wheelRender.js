// js/wheelRender.js

import { getPosterImg } from "./posterPreload.js"; // сверху файла

const IMG_CACHE = new Map();

function resizeCanvasToDisplaySize(canvas) {
  const dpr = window.devicePixelRatio || 1;

  // ✅ берём реальный CSS-размер канваса (то, что уже посчитала верстка)
  const cssW = canvas.clientWidth;
  const cssH = canvas.clientHeight;

  const w = Math.max(1, Math.round(cssW * dpr));
  const h = Math.max(1, Math.round(cssH * dpr));

  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
    return true;
  }
  return false;
}

export function buildWeightedSegments(items) {
  const arr = Array.isArray(items) ? items : [];
  if (!arr.length) return [];

  const ws = arr.map((it) => {
    const w = Number(it?.w);
    return Number.isFinite(w) && w > 0 ? w : 1;
  });

  const total = ws.reduce((a, b) => a + b, 0) || 1;

  let acc = 0;
  const segs = arr.map((item, i) => {
    const da = (ws[i] / total) * Math.PI * 2;
    const start = acc;
    const end = acc + da;
    acc = end;
    return { item, start, end, w: ws[i] };
  });

  segs[segs.length - 1].end = Math.PI * 2;
  return segs;
}

function drawPosterCover(ctx, img, x, y, w, h) {
  // x,y — центр зоны (как у тебя сейчас), w/h — размеры зоны
  if (!img || !img.complete || !img.naturalWidth || !img.naturalHeight) {
    // плейсхолдер
    ctx.fillStyle = "rgba(255,255,255,0.06)";
    ctx.fillRect(x - w / 2, y - h / 2, w, h);
    return;
  }

  const iw = img.naturalWidth;
  const ih = img.naturalHeight;

  // scale "cover": заполняем полностью
  const scale = Math.max(w / iw, h / ih);
  const sw = w / scale;
  const sh = h / scale;

  // центрируем кроп
  const sx = (iw - sw) / 2;
  const sy = (ih - sh) / 2;

  ctx.drawImage(img, sx, sy, sw, sh, x - w / 2, y - h / 2, w, h);
}

export function drawWheel(canvas, items, opts = {}) {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const rotation = Number(opts.rotation || 0); // радианы
  const onUpdate = opts.onUpdate;

  resizeCanvasToDisplaySize(canvas);

  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();

  // рисуем в CSS координатах
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, rect.width, rect.height);

  const segs = buildWeightedSegments(items);
  if (!segs.length) return;

  const cx = rect.width / 2;
  const cy = rect.height / 2;

  // ✅ FIX: один раз объявляем R и сразу гарантируем валидность
  const R = Math.min(rect.width, rect.height) / 2 - 10;
  if (R <= 0) return;

  // рисуем в CSS координатах
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, rect.width, rect.height);

  // чуть “вверх”, чтобы указатель был сверху
  const ROT0 = -Math.PI / 2 + rotation;

  // фон колеса
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255,255,255,0.04)";
  ctx.fill();

  // сектора
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    const a0 = s.start + ROT0;
    const a1 = s.end + ROT0;

    // сектор
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, R, a0, a1);
    ctx.closePath();

    // легкая “полосатость”
    ctx.fillStyle = i % 2 ? "rgba(0,0,0,0.18)" : "rgba(255,255,255,0.06)";
    ctx.fill();

    // граница сектора
    ctx.strokeStyle = "rgba(255,255,255,0.10)";
    ctx.lineWidth = 1;
    ctx.stroke();

    // клип и отрисовка постера — ВНУТРИ сектора, но в локальных координатах
    ctx.save();

    // локальная система: центр колеса = (0,0)
    ctx.translate(cx, cy);

    // поворачиваем так, чтобы центр сектора смотрел ВВЕРХ (к стрелке)
    const amid = (a0 + a1) / 2;
    ctx.rotate(amid + Math.PI / 2);

    // ширина сектора (угол)
    const delta = (a1 - a0) / 2;

    // ✅ клип сектора в локальной системе
    // в локальной системе "наружу" = вверх, а в canvas "вверх" это -Y,
    // поэтому сектор центрируем на угле -PI/2
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, R, -Math.PI / 2 - delta, -Math.PI / 2 + delta);
    ctx.closePath();
    ctx.clip();

    // === рисуем постер: низ ровно в центре, верх ровно на внешнем радиусе ===
    const poster = String(s.item?.poster || "").trim();
    const img = poster
      ? getPosterImg(poster, onUpdate, { priority: "high" })
      : null;

    // маленький овер-дро (чуть больше радиуса), чтобы не ловить микро-зазоры от антиалиасинга
    const over = 6;
    const zoneH = R + over; // высота от центра до внешнего радиуса
    const zoneW = zoneH * 0.62; // как у тебя было

    // drawPosterCover: (x,y) — центр зоны
    // зона от y=0..zoneH => центр y = zoneH/2
    drawPosterCover(ctx, img, 0, -zoneH / 2, zoneW, zoneH);

    // fallback текст
    if (!img || !img.complete) {
      const t = String(s.item?.title || "");
      if (t) {
        ctx.fillStyle = "rgba(255,255,255,0.9)";
        ctx.font = "700 12px system-ui, -apple-system, Segoe UI, Roboto, Arial";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(t.slice(0, 22), 0, zoneH * 0.55);
      }
    }

    ctx.restore();
  }

  // === поверх всего: внешнее кольцо + стрелка ===

  // внешнее кольцо
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(255,255,255,0.18)";
  ctx.lineWidth = 2;
  ctx.stroke();

  // стрелка ВНИЗ (указывает на колесо сверху)
  const tipY = cy - R + 28; // кончик ВНИЗ, на колесе
  const baseY = cy - R - 14; // основание ВЫШЕ
  const halfW = 16;

  ctx.beginPath();
  ctx.moveTo(cx, tipY); // ▼ кончик
  ctx.lineTo(cx - halfW, baseY); // ◀ основание
  ctx.lineTo(cx + halfW, baseY); // ▶ основание
  ctx.closePath();

  ctx.fillStyle = "rgba(255, 60, 172, 0.95)";
  ctx.strokeStyle = "rgba(0,0,0,0.55)";
  ctx.lineWidth = 2;
  ctx.fill();
  ctx.stroke();
}

// wheelAnim.js (или wheelRender.js в конец файла)

let raf = 0;
let currentRotation = 0;

export function stopWheelAnimation() {
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
}

function clamp01(x) {
  return Math.max(0, Math.min(1, x));
}

function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

// выбираем угол внутри сектора, чтобы не попадать на границу
function pickAngleInside(seg, pad = 0.12) {
  const a0 = seg.start;
  const a1 = seg.end;
  const span = a1 - a0;
  const safe0 = a0 + span * pad;
  const safe1 = a1 - span * pad;
  return safe0 + Math.random() * Math.max(0, safe1 - safe0);
}

// если нужно где-то выставлять rotation (например после смены пресета)
export function setWheelRotation(rad = 0) {
  currentRotation = Number(rad) || 0;
}
