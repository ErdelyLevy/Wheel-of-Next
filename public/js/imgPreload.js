// js/imgPreload.js
import { proxifyImageUrl } from "./img.js";

export const wheelImageCache = new Map();

/**
 * Прогревает картинки для колеса с приоритетом.
 * @param {Array} items
 * @param {Object} opts
 * @param {number} opts.max - сколько постеров грузить (по умолчанию 80)
 * @param {number} opts.concurrency - параллельных загрузок (по умолчанию 6)
 */
export async function preloadWheelImages(items, { max = 80, concurrency = 6 } = {}) {
  const urls = (items || [])
    .map(x => x?.poster)
    .filter(Boolean)
    .slice(0, max)
    .map(u => proxifyImageUrl(u));

  let i = 0;
  const workers = Array.from({ length: concurrency }, () => worker());
  await Promise.all(workers);

  async function worker() {
    while (i < urls.length) {
      const url = urls[i++];
      await loadOne(url);
    }
  }

  function loadOne(url) {
    if (!url) return Promise.resolve();
    if (wheelImageCache.has(url)) return Promise.resolve();

    return new Promise((resolve) => {
      const img = new Image();

      // ✅ попытка дать приоритет (Chrome/Chromium поддерживают)
      try { img.fetchPriority = "high"; } catch {}

      // allow canvas-friendly CORS loads if proxied by server
      try { img.crossOrigin = 'anonymous'; } catch {}
      try { img.referrerPolicy = 'no-referrer'; } catch {}

      img.decoding = "async";
      img.onload = img.onerror = () => resolve();

      img.src = url;
      wheelImageCache.set(url, img);
    });
  }
}
