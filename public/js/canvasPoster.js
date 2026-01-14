// public/js/canvasPoster.js
import { getPosterSrc, getFallbackPosterSrc } from "./posterSrc.js";

const imgBySrc = new Map(); // src -> HTMLImageElement
const stateBySrc = new Map(); // src -> 'loading' | 'ok' | 'error'
const fallbackSrcByKey = new Map(); // key -> dataUrl

// чтобы не спамить onUpdate по 100 раз в кадр
let scheduled = false;
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

export function getCanvasPosterImage(item, onUpdate) {
  // пробуем реальный постер через /api/poster
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
