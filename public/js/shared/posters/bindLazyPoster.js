import { getFallbackPosterSrc } from "./getFallbackPosterSrc.js";
import { getPosterSrc } from "./getPosterSrc.js";

let io;

export function bindLazyPoster(imgEl, item) {
  if (!imgEl) return;

  imgEl.__lazyItem = item;

  // 1) мгновенный fallback
  imgEl.src = getFallbackPosterSrc(item);

  // 2) если реальный постер не загрузился — назад на fallback
  // и больше не дёргаем сеть для этого img
  imgEl.onerror = () => {
    imgEl.onerror = null;
    imgEl.__lazyItem = null;
    imgEl.src = getFallbackPosterSrc(item);
  };

  // 3) загрузку реального постера начинаем только при появлении в viewport
  ensureIO().observe(imgEl);
}

function ensureIO() {
  if (io) return io;

  io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;

        const img = e.target;
        io.unobserve(img);

        const item = img.__lazyItem;
        if (!item) continue;

        // ставим реальный постер через серверный прокси-кэш
        img.src = getPosterSrc(item, { w: 256, fmt: "webp" });
      }
    },
    { root: null, rootMargin: "300px 0px", threshold: 0.01 },
  );

  return io;
}
