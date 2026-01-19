export function resizeCanvasToDisplaySize(canvas) {
  const dpr = window.devicePixelRatio || 1;

  // ✅ берём реальный CSS-размер канваса (то, что уже посчитала верстка)
  const cssW = canvas.clientWidth;
  const cssH = canvas.clientHeight;

  const w = Math.max(1, Math.round(cssW * dpr));
  const h = Math.max(1, Math.round(cssH * dpr));

  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
    return true;
  }
  return false;
}
