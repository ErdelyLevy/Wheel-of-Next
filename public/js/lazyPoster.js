// public/js/lazyPoster.js
import {
  getPosterImageForItem,
  getPosterSrcForItem,
  getFallbackPosterSrc,
} from "./posterPreload.js";

// io должен быть один на модуль
// (root можно настроить на скролл-контейнер списка, если он есть)
const io = new IntersectionObserver(
  (entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;

      const imgEl = e.target;
      io.unobserve(imgEl);

      const item = imgEl.__lazyItem;
      if (!item) continue;

      // при входе в viewport — запускаем загрузку реального постера
      const update = imgEl.__lazyOnUpdate;
      const res = getPosterImageForItem(item, update);

      // res может быть Image. Если вдруг вернули что-то иное — не ломаем src
      if (res && res.src) imgEl.src = res.src;
    }
  },
  { rootMargin: "300px" }
);

export function bindLazyPoster(imgEl, item) {
  if (!imgEl) return;

  imgEl.__lazyItem = item;

  // 1) СРАЗУ фолбэк (и главное — без сетевой загрузки)
  imgEl.src = getFallbackPosterSrc(item);

  // 2) update — когда реальный постер догрузился или упал
  imgEl.__lazyOnUpdate = () => {
    // элемент мог быть удалён
    if (!imgEl.isConnected) return;

    const res = getPosterImageForItem(item, null);
    if (res && res.src) imgEl.src = res.src;
    else imgEl.src = getFallbackPosterSrc(item);
  };

  // 3) реальный постер начнём грузить только когда попал в viewport
  io.observe(imgEl);
}

function ensureIO() {
  if (io) return io;

  io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;

        const img = e.target;
        io.unobserve(img);

        const item = img.__wonItem;
        if (!item) continue;

        // ВАЖНО: получаем Image (real OR fallback)
        // и подписываемся так, чтобы обновился ТОЛЬКО этот img
        const resolved = getPosterImageForItem(item, () => {
          const next = getPosterImageForItem(item);
          if (next?.src && img.src !== next.src) img.src = next.src;
        });

        if (resolved?.src) img.src = resolved.src;
      }
    },
    { root: null, rootMargin: "400px 0px", threshold: 0.01 }
  );

  return io;
}

/** singleton IntersectionObserver */
function getIO() {
  if (io) return io;

  io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;

        const img = e.target;
        io.unobserve(img);

        const item = img.__posterItem;
        if (!item) return;

        img.src = getPosterSrcForItem(item);
      }
    },
    {
      rootMargin: "200px", // начинаем грузить заранее
      threshold: 0.01,
    }
  );

  return io;
}
