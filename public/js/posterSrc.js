// posterSrc.js (или где у тебя сейчас getFallbackPosterSrc)
import { makeGlassFallbackDataUrl } from "./posterFallback.js";

const FALLBACK_CACHE = new Map(); // key -> dataUrl

export function getFallbackPosterSrc(item) {
  const title = (item?.title || item?.name || "—").trim();
  const media_type = String(item?.media_type || "").trim();
  const year = item?.publish_year ?? item?.year ?? "";
  const y = String(year ?? "").trim();

  const key = `${media_type}::${y}::${title}`;

  const cached = FALLBACK_CACHE.get(key);
  if (cached) return cached;

  const dataUrl = makeGlassFallbackDataUrl({ title, media_type, year: y });
  FALLBACK_CACHE.set(key, dataUrl);
  return dataUrl;
}

export function getPosterSrc(item, { w = 512, fmt = "webp" } = {}) {
  const url = String(item?.poster || item?.image || "").trim();
  if (!url) return getFallbackPosterSrc(item);

  // всегда ходим через серверный прокси-кэш
  const u = encodeURIComponent(url);
  return `/api/poster?u=${u}&w=${encodeURIComponent(
    String(w)
  )}&fmt=${encodeURIComponent(String(fmt))}`;
}
