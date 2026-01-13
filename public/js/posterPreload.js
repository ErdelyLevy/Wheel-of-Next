// public/js/posterPreload.js

// aspect cache: posterUrl -> aspect (w/h)
const aspectByUrl = new Map();
// image cache to avoid reloading
const imgByUrl = new Map();

// очень простой троттлинг "сигнала перерисовки"
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

export function getPosterAspect(url) {
  const key = String(url || "").trim();
  return key ? aspectByUrl.get(key) : undefined;
}

export function preloadPosters(items, onAnyLoaded) {
  const list = Array.isArray(items) ? items : [];
  for (const it of list) {
    const url = String(it?.poster || "").trim();
    if (!url) continue;

    // уже знаем aspect — нет смысла грузить
    if (aspectByUrl.has(url)) continue;

    // если картинка уже создавалась — тоже пропускаем
    if (imgByUrl.has(url)) continue;

    const img = new Image();
    img.decoding = "async";
    img.loading = "eager";
    imgByUrl.set(url, img);

    img.onload = () => {
      if (img.naturalWidth > 0 && img.naturalHeight > 0) {
        aspectByUrl.set(url, img.naturalWidth / img.naturalHeight);
        if (typeof onAnyLoaded === "function") {
          scheduleOnce(onAnyLoaded);
        }
      }
    };

    img.onerror = () => {
      // чтобы не пытаться грузить бесконечно один и тот же битый url
      aspectByUrl.set(url, undefined);
    };

    img.src = url;
  }
}
