import { getFallbackPosterSrc } from "../../shared/posters/getFallbackPosterSrc.js";
import { getPosterSrc } from "../../shared/posters/getPosterSrc.js";
import { buildWeightedSegments } from "./buildWeightedSegments.js";
import { resizeCanvasToDisplaySize } from "./resizeCanvasToDisplaySize.js";

const imgBySrc = new Map(); // src -> HTMLImageElement
const stateBySrc = new Map(); // src -> 'loading' | 'ok' | 'error'
const fallbackSrcByKey = new Map(); // key -> dataUrl
let scheduled = false;

export function drawWheel(canvas, items, opts = {}) {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const rotation = Number(opts.rotation || 0);
  const animate = !!opts.animate; // ✅ NEW
  const onUpdate = animate ? null : opts.onUpdate; // ✅ NEW (важно)

  resizeCanvasToDisplaySize(canvas);

  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, rect.width, rect.height);

  const segs = buildWeightedSegments(items);
  if (!segs.length) return;

  const cx = rect.width / 2;
  const cy = rect.height / 2;

  const R = Math.min(rect.width, rect.height) / 2 - 10;
  if (R <= 0) return;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, rect.width, rect.height);

  const ROT0 = -Math.PI / 2 + rotation;

  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255,255,255,0.04)";
  ctx.fill();

  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    const a0 = s.start + ROT0;
    const a1 = s.end + ROT0;

    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, R, a0, a1);
    ctx.closePath();

    ctx.fillStyle = i % 2 ? "rgba(0,0,0,0.18)" : "rgba(255,255,255,0.06)";
    ctx.fill();

    ctx.strokeStyle = "rgba(255,255,255,0.10)";
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.save();
    ctx.translate(cx, cy);

    const amid = (a0 + a1) / 2;
    ctx.rotate(amid + Math.PI / 2);

    const delta = (a1 - a0) / 2;

    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, R, -Math.PI / 2 - delta, -Math.PI / 2 + delta);
    ctx.closePath();
    ctx.clip();

    // ✅ вот это главное: onUpdate только когда НЕ animate
    const img = getCanvasPosterImage(s.item, onUpdate);

    const over = 6;
    const zoneH = R + over;
    const zoneW = zoneH * 0.62;

    drawPosterCover(ctx, img, 0, -zoneH / 2, zoneW, zoneH);

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

function getCanvasPosterImage(item, onUpdate) {
  // пробуем реальный постер через /wheel/api/poster
  const src = getPosterSrc(item, { w: 512, fmt: "webp" });

  // 1) если это fallback dataURL — отдаем КЕШИРОВАННЫЙ fallback и НЕ спамим onUpdate
  if (String(src).startsWith("data:image/")) {
    const fb = getFallbackSrcCached(item);
    return imageFromSrc(fb, null); // <-- null, чтобы не было перерисовок по fallback
  }

  // 2) реальный: грузим и уведомляем onUpdate (колесо дорисуется)
  const img = imageFromSrc(src, onUpdate);
  if (img) return img;

  // 3) если реальный уже помечен error — fallback (кеш) без onUpdate
  const fb = getFallbackSrcCached(item);
  return imageFromSrc(fb, null);
}

function imageFromSrc(src, onUpdate) {
  const st = stateBySrc.get(src);
  const cached = imgBySrc.get(src);

  if (st === "ok" && cached && cached.complete && cached.naturalWidth > 0)
    return cached;
  if (st === "error") return null;
  if (st === "loading" && cached) return cached;

  const img = cached || new Image();
  img.decoding = "async";
  img.loading = "eager";
  imgBySrc.set(src, img);
  stateBySrc.set(src, "loading");

  const shouldNotify =
    typeof onUpdate === "function" && !String(src).startsWith("data:");

  img.onload = () => {
    stateBySrc.set(src, img.naturalWidth > 0 ? "ok" : "error");
    if (shouldNotify) scheduleOnce(onUpdate);
  };

  img.onerror = () => {
    stateBySrc.set(src, "error");
    if (shouldNotify) scheduleOnce(onUpdate);
  };

  img.src = src;
  return img;
}

function getFallbackSrcCached(item) {
  const title = (item?.title || item?.name || "—").trim();
  const media_type = String(item?.media_type || "").trim();
  const year = String(item?.publish_year ?? item?.year ?? "").trim();
  const id = String(item?.id ?? item?.meta_id ?? "").trim();
  const key = `${id}::${media_type}::${year}::${title}`;

  let src = fallbackSrcByKey.get(key);
  if (!src) {
    src = getFallbackPosterSrc(item); // <- твой canvas->dataURL генератор
    fallbackSrcByKey.set(key, src);
  }
  return src;
}

function scheduleOnce(fn) {
  if (!fn || scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    try {
      fn();
    } catch {}
  });
}
