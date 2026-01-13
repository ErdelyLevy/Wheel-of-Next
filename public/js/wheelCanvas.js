// js/wheelCanvas.js
import { state, getWeight } from "./state.js";
import { proxifyImageUrl } from "./img.js";
import { dom } from "./dom.js";

export function createWheelRenderer() {
  if (!dom.wheelCanvas) return null;

  const canvas = dom.wheelCanvas;
  const ctx = canvas.getContext("2d");

  const MAX_WHEEL_IMAGES = 200;
  const imageCache = new Map();

  function resizeCanvasToDisplaySize() {
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;

    const w = Math.max(1, Math.round(rect.width));
    const h = Math.max(1, Math.round(rect.height));

    const needW = Math.round(w * dpr);
    const needH = Math.round(h * dpr);

    if (canvas.width !== needW || canvas.height !== needH) {
      canvas.width = needW;
      canvas.height = needH;
    }

    // рисуем в CSS-пикселях, не в device-пикселях
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { w, h };
  }

  function requestRedrawFactory(items) {
    let scheduled = false;
    return () => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        drawWheel(items);
      });
    };
  }

  function loadImage(url, total, requestRedraw) {
    if (!url) return null;
    if (total > MAX_WHEEL_IMAGES) return null;

    const proxied = proxifyImageUrl(url);
    if (!proxied) return null;

    const cached = imageCache.get(proxied);
    if (cached) return cached;

    const img = new Image();
    // enable cross-origin loading for canvas-safe images
    try { img.crossOrigin = 'anonymous'; } catch (e) {}
    try { img.referrerPolicy = 'no-referrer'; } catch (e) {}
    img.decoding = "async";
    img.loading = "eager";

    img.onload = () => {
      try { console.log('[wheelCanvas] image loaded', proxied, img.naturalWidth, img.naturalHeight); } catch (e) {}
      requestRedraw?.();
    };
    img.onerror = (err) => {
      try { console.warn('[wheelCanvas] image load error', proxied, err); } catch (e) {}
      imageCache.delete(proxied);
      requestRedraw?.();
    };

    img.src = proxied;

    imageCache.set(proxied, img);
    return img;
  }

  // Прелоад "в первую очередь"
  function preloadImages(items) {
    const n = items?.length || 0;
    if (!n) return;

    const requestRedraw = requestRedrawFactory(items);
    for (let i = 0; i < n; i++) {
      loadImage(items[i]?.poster, n, requestRedraw);
    }
  }

  function clamp01(x) {
    return Math.max(0, Math.min(1, x));
  }

  // Сегменты по весам: вернем массив {start,end,mid,weight}
  function computeSegments(items) {
    const n = items?.length || 0;
    const ws = new Array(n);

    let totalW = 0;
    for (let i = 0; i < n; i++) {
      const w = Math.max(0, Number(getWeight(items[i])) || 0);
      ws[i] = w;
      totalW += w;
    }

    // fallback если все веса 0
    if (!(totalW > 0)) {
      for (let i = 0; i < n; i++) ws[i] = 1;
      totalW = n;
    }

    const segs = new Array(n);
    let acc = 0;
    for (let i = 0; i < n; i++) {
      const ang = (ws[i] / totalW) * (Math.PI * 2);
      const start = acc;
      const end = acc + ang;
      segs[i] = { start, end, mid: (start + end) / 2, w: ws[i] };
      acc = end;
    }
    return segs;
  }

  // Рисуем картинку так, чтобы ПО ВЫСОТЕ она была полностью (fit height),
  // а по ширине — центр-кроп (если не влезает).
  function drawImageFitHeightCropX(ctx, img, dx, dy, dw, dh) {
    const iw = img.naturalWidth || img.width;
    const ih = img.naturalHeight || img.height;
    if (!iw || !ih) return;

    const scale = dh / ih;               // высоту показываем целиком
    const sw = dw / scale;               // какая ширина источника нужна
    const sx = (iw - sw) / 2;            // центрируем по X
    const sy = 0;                        // по Y НЕ режем
    const sh = ih;

    ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
  }

  function drawSegmentPoster({ img, cx, cy, innerR, outerR, startAngle, endAngle }) {
    const slice = endAngle - startAngle;
    const mid = (startAngle + endAngle) / 2;

    // Draw poster rotated so its bottom is oriented toward the center.
    const h = outerR - innerR;
    const outerW = 2 * outerR * Math.tan(slice / 2);
    const w = Math.max(20, outerW * 1.03);

    // In local rotated coordinates: translate to center and rotate so that
    // the segment middle points upward (-Y). Then draw rectangle with
    // top at -outerR and height = (outerR - innerR) so the bottom faces center.
    const dx = -w / 2;
    const dy = -outerR;

    const imgLoaded = !!(img && img.complete && (img.naturalWidth || 0) > 0);
    try { console.log('[wheelCanvas] drawSegmentPoster rotated', { slice, outerW, w, h, imgLoaded }); } catch (e) {}

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(mid - Math.PI / 2);

    // Clip to sector between innerR and outerR so poster is confined to the segment
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, outerR, -slice / 2, +slice / 2, false);
    ctx.arc(0, 0, innerR, +slice / 2, -slice / 2, true);
    ctx.closePath();
    ctx.clip();

    if (imgLoaded) {
      ctx.globalAlpha = 0.98;
      drawImageFitHeightCropX(ctx, img, dx, dy, w, h);
      ctx.globalAlpha = 1;
    } else {
      ctx.fillStyle = "rgba(255,255,255,0.05)";
      ctx.fillRect(dx, dy, w, h);
    }

    ctx.restore();
  }

  function drawWheel(items) {
    const { w, h } = resizeCanvasToDisplaySize();

    ctx.clearRect(0, 0, w, h);

    const n = items?.length || 0;
    if (!n) return;

    const size = Math.min(w, h);
    const cx = w / 2;
    const cy = h / 2;

    const outerR = size / 2 - 10;

    // под центральную кнопку (78px) + обводки + небольшой зазор
    const innerR = Math.max(outerR * 0.20, 52);

    const segs = computeSegments(items);
    const requestRedraw = requestRedrawFactory(items);

    // прелоад при каждом draw (без ожидания)
    // (дешево, потому что cache)
    for (let i = 0; i < n; i++) {
      loadImage(items[i]?.poster, n, requestRedraw);
    }

    // внешний круг
    ctx.beginPath();
    ctx.arc(cx, cy, outerR + 2, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(255,255,255,0.55)";
    ctx.lineWidth = 2;
    ctx.stroke();

    // сегменты
    for (let i = 0; i < n; i++) {
      const start = state.baseAngle + segs[i].start;
      const end = state.baseAngle + segs[i].end;

      const posterUrl = items[i]?.poster;
      const img = loadImage(posterUrl, n, requestRedraw);
      try { console.log('[wheelCanvas] drawing segment', i, posterUrl, 'loaded=', !!(img && img.complete && (img.naturalWidth||0)>0)); } catch (e) {}

      drawSegmentPoster({
        img,
        cx,
        cy,
        innerR,
        outerR,
        startAngle: start,
        endAngle: end,
      });

      // границы сегмента
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, outerR, start, end);
      ctx.closePath();
      ctx.strokeStyle = "rgba(0,0,0,0.55)";
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // указатель (вверх)
    ctx.beginPath();
    ctx.moveTo(cx, cy - outerR - 6);
    ctx.lineTo(cx - 12, cy - outerR + 18);
    ctx.lineTo(cx + 12, cy - outerR + 18);
    ctx.closePath();
    ctx.fillStyle = "#ff3cac";
    ctx.fill();

    // DEV DEBUG: отрисовать первый загруженный постер в углу для проверки drawImage
    try {
      const firstLoaded = [...imageCache.values()].find(i => i && i.complete && (i.naturalWidth || 0) > 0);
      if (firstLoaded) {
        ctx.save();
        // временно сбросим трансформ, нарисуем в CSS-пикселях и вернём
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.drawImage(firstLoaded, 10, 10, 96, 54);
        ctx.restore();
      }
    } catch (e) {}
  }

  function warmup(items) {
    preloadImages(items);
    let warm = 0;
    const t = setInterval(() => {
      drawWheel(items);
      warm++;
      if (warm > 12) clearInterval(t);
    }, 80);
  }

  return { drawWheel, warmup, preloadImages };
}
