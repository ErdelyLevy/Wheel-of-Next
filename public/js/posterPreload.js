// public/js/posterPreload.js
import {
  makeGlassFallbackCanvas,
  makeGlassFallbackDataUrl,
} from "./posterFallback.js";

const fallbackImgByKey = new Map(); // key -> HTMLImageElement (fallback)
const imgByUrl = new Map(); // url -> Image (real)
const statusByUrl = new Map(); // url -> 'pending'|'ok'|'error'
const fallbackCanvasByKey = new Map(); // key -> HTMLCanvasElement
const fallbackSrcByKey = new Map();
const cbsByUrl = new Map();

const MAX_INFLIGHT = 5;
let inflight = 0;
const queue = [];
const queued = new Set();

export function getFallbackPosterSrc(item) {
  const title = String(item?.title || item?.name || "—").trim();
  const media_type = String(item?.media_type || "").trim();
  const year = item?.publish_year ?? item?.year ?? "";
  const y = String(year ?? "").trim();

  const key = `${media_type}::${y}::${title}`;
  const cached = fallbackSrcByKey.get(key);
  if (cached) return cached;

  const src = makeGlassFallbackDataUrl({ title, media_type, year: y });
  fallbackSrcByKey.set(key, src);
  return src;
}

function pumpQueue() {
  while (inflight < MAX_INFLIGHT && queue.length) {
    const url = queue.shift();
    queued.delete(url);
    startLoad(url);
  }
}

function enqueue(url) {
  if (!url) return;
  if (queued.has(url)) return;
  const st = statusByUrl.get(url);
  if (st === "ok" || st === "error" || st === "pending") return;

  queued.add(url);
  queue.push(url);
  pumpQueue();
}

function startLoad(url) {
  inflight++;
  statusByUrl.set(url, "pending");

  const img = new Image();
  img.decoding = "async";
  img.loading = "eager";
  imgByUrl.set(url, img);

  const done = (ok) => {
    statusByUrl.set(url, ok ? "ok" : "error");
    inflight--;
    fire(url);
    pumpQueue();
  };

  img.onload = () => done(img.naturalWidth > 0 && img.naturalHeight > 0);
  img.onerror = () => done(false);
  img.src = url;
}

let scheduled = false;
function scheduleOnce(fn) {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    try {
      fn();
    } catch {}
  });
}

function subscribe(url, cb) {
  if (typeof cb !== "function") return;
  let set = cbsByUrl.get(url);
  if (!set) cbsByUrl.set(url, (set = new Set()));
  set.add(cb);
}

function fire(url) {
  const set = cbsByUrl.get(url);
  if (!set || !set.size) return;
  cbsByUrl.delete(url); // как у тебя — не копим подписки
  for (const cb of set) scheduleOnce(cb);
}

function buildKey(item) {
  const title = String(item?.title || item?.name || "—").trim();
  const media_type = String(item?.media_type || "").trim();
  const year = item?.publish_year ?? item?.year ?? "";
  const y = String(year ?? "").trim();
  return { title, media_type, y, key: `${media_type}::${y}::${title}` };
}

function getFallbackImage(item) {
  const title = String(item?.title || item?.name || "—").trim();
  const media_type = String(item?.media_type || "").trim();
  const year = String(item?.publish_year ?? item?.year ?? "").trim();

  const key = `${media_type}::${year}::${title}`;

  let img = fallbackImgByKey.get(key);
  if (img) return img;

  // ⬇️ ты уже генеришь canvas в getFallbackCanvas(item)
  const canvas = getFallbackCanvas(item);

  img = new Image();
  img.decoding = "async";
  img.loading = "eager";
  img.src = canvas.toDataURL("image/png"); // просто и надежно

  fallbackImgByKey.set(key, img);
  return img;
}

// ✅ быстрый fallback для canvas-рисования (wheel)
function getFallbackCanvas(item) {
  const { title, media_type, y, key } = buildKey(item);

  let c = fallbackCanvasByKey.get(key);
  if (c) return c;

  c = makeGlassFallbackCanvas({ title, media_type, year: y });
  fallbackCanvasByKey.set(key, c);
  return c;
}

// ✅ src fallback для <img> (лениво, по месту)
function getFallbackSrc(item) {
  const { title, media_type, y, key } = buildKey(item);

  let s = fallbackSrcByKey.get(key);
  if (s) return s;

  // ⚠️ ВАЖНО: это тяжёлая операция, поэтому делаем только когда реально нужен <img>
  s = makeGlassFallbackDataUrl({ title, media_type, year: y });
  fallbackSrcByKey.set(key, s);
  return s;
}

/**
 * ✅ ДЛЯ КОЛЕСА (canvas): возвращает Image (real) или Canvas (fallback)
 */
export function getPosterImageForItem(item, onUpdate) {
  const url = String(item?.poster || "").trim();
  if (!url) return getFallbackImage(item);

  subscribe(url, onUpdate);

  const st = statusByUrl.get(url);
  const cached = imgByUrl.get(url);

  if (st === "ok" && cached && cached.complete && cached.naturalWidth > 0) {
    return cached;
  }

  if (st === "error") return getFallbackImage(item);

  // если еще не грузили — ставим в очередь
  if (!st) enqueue(url);

  // пока не готово — показываем fallback
  return getFallbackImage(item);
}

/**
 * ✅ ДЛЯ LIST/HISTORY/RESULT (<img>): возвращает url, а при ошибке/отсутствии — dataURL fallback
 */
export function getPosterSrcForItem(item, onUpdate) {
  const url = String(item?.poster || "").trim();
  if (!url) return getFallbackSrc(item);

  subscribe(url, onUpdate);

  const st = statusByUrl.get(url);
  if (st === "error") return getFallbackSrc(item);

  // если ещё не стартовали — стартуем загрузку через общий загрузчик
  if (!st) {
    getPosterImageForItem(item, onUpdate);
  }

  // <img> пробует реальный url
  return url;
}

/**
 * Опционально: прогрев колеса (но НЕ вызывай это на весь пресет!)
 * Иначе снова будет много работы/загрузок.
 */
export function preloadPosters(items, onAnyLoaded) {
  const list = Array.isArray(items) ? items : [];
  for (const it of list) {
    getPosterImageForItem(it, onAnyLoaded);
  }
}
