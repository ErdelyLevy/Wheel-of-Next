import { getFallbackPosterSrc } from "./getFallbackPosterSrc.js";

export function getPosterSrc(item, { w = 512, fmt = "webp" } = {}) {
  const url = String(item?.poster || item?.image || "").trim();
  if (!url) return getFallbackPosterSrc(item);

  // всегда ходим через серверный прокси-кэш
  const u = encodeURIComponent(url);
  return `/wheel/api/poster?u=${u}&w=${encodeURIComponent(
    String(w),
  )}&fmt=${encodeURIComponent(String(fmt))}`;
}
