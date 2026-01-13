export function proxifyImageUrl(url) {
  if (!url || typeof url !== "string") return "";
  // If it's a data URI or already proxied, leave as-is
  if (url.startsWith("data:") || url.startsWith("/img?url=")) return url;

  try {
    const u = new URL(url, window.location.href);
    // If the image is same-origin, return direct URL; otherwise proxy through /img
    const sameOrigin = u.origin === window.location.origin;
    if (sameOrigin) return url;
    return `/img?url=${encodeURIComponent(u.toString())}`;
  } catch (e) {
    return url;
  }
}

// singleton IntersectionObserver для ленивой загрузки
let _io = null;
function getIO() {
  if (_io) return _io;
  if (!("IntersectionObserver" in window)) return null;

  _io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      const img = e.target;
      const real = img.dataset.src;
      if (real && (!img.getAttribute("src") || img.getAttribute("src") === img.dataset.placeholder)) {
        img.src = real;
      }
      _io.unobserve(img);
    }
  }, { root: null, rootMargin: "600px 0px", threshold: 0.01 });

  return _io;
}

// удобно: навесить lazy-режим одной строкой
export function setLazyImg(img, url, placeholder) {
  const real = proxifyImageUrl(url);
  img.loading = "lazy";
  img.decoding = "async";

  // если нет url — сразу placeholder
  if (!real) {
    img.src = placeholder;
    return;
  }

  const io = getIO();
  if (!io) {
    img.src = real;
    return;
  }

  img.dataset.src = real;
  img.dataset.placeholder = placeholder;

  // ставим placeholder, реальный src будет когда попадёт в viewport
  img.src = placeholder;
  io.observe(img);
}
