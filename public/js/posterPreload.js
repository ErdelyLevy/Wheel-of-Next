// public/js/posterPreload.js

const aspectByUrl = new Map();
const imgByUrl = new Map();

// url -> Set(callback)
const cbsByUrl = new Map();

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

// ✅ основной способ получить Image + подписаться на load
export function getPosterImg(url, onAnyLoaded, opts = {}) {
  const key = String(url || "").trim();
  if (!key) return null;

  // 1) подписка на redraw
  if (typeof onAnyLoaded === "function") {
    let set = cbsByUrl.get(key);
    if (!set) cbsByUrl.set(key, (set = new Set()));
    set.add(onAnyLoaded);
  }

  // 2) если Image уже есть — вернем её и при необходимости дернем redraw
  let img = imgByUrl.get(key);
  if (img) {
    if (img.complete && img.naturalWidth > 0 && img.naturalHeight > 0) {
      if (!aspectByUrl.has(key))
        aspectByUrl.set(key, img.naturalWidth / img.naturalHeight);
      const set = cbsByUrl.get(key);
      if (set) for (const cb of set) scheduleOnce(cb);
    }
    return img;
  }

  // 3) создаём и запускаем загрузку
  img = new Image();
  img.decoding = "async";
  img.loading = opts.priority === "high" ? "eager" : "lazy";
  imgByUrl.set(key, img);

  const fire = () => {
    const set = cbsByUrl.get(key);
    if (!set || !set.size) return;
    for (const cb of set) scheduleOnce(cb);
  };

  // ✅ handlers ДО src
  img.onload = () => {
    if (img.naturalWidth > 0 && img.naturalHeight > 0) {
      aspectByUrl.set(key, img.naturalWidth / img.naturalHeight);
    }
    fire();
  };

  img.onerror = () => {
    aspectByUrl.set(key, undefined);
    fire();
  };

  img.src = key;

  // ✅ cache-hit: иногда complete уже true сразу после src
  if (img.complete) {
    fire();
  }

  return img;
}

export function preloadPosters(items, onAnyLoaded) {
  const list = Array.isArray(items) ? items : [];
  for (const it of list) {
    const url = String(it?.poster || "").trim();
    if (!url) continue;
    getPosterImg(url, onAnyLoaded, { priority: "high" });
  }
}
