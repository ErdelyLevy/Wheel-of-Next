// public/js/posterFallback.js

function getGradient(mediaType = "") {
  switch (String(mediaType)) {
    case "movie":
      return ["#ff3cac", "#ff8c46"];
    case "anime":
      return ["#785aff", "#ff3cac"];
    case "show":
      return ["#00c8ff", "#785aff"];
    case "video_game":
      return ["#00e6aa", "#00a0ff"];
    case "book":
      return ["#ffc850", "#ff7878"];
    default:
      return ["#ff3cac", "#00a0ff"];
  }
}

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

function roundRectPath(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function splitTitleBySeparator(title) {
  const t = String(title || "").trim();
  if (!t) return null;

  // союзы (словесные)
  const wordRe = /\s+(и|или|да|но|либо|and|or|vs)\s+/gi;

  // спецсимволы-разделители
  const symbolRe = /\s*([\-–—:·|])\s*/g;

  const matches = [];

  let m;
  while ((m = wordRe.exec(t))) {
    matches.push({
      index: m.index,
      sep: m[1],
      type: "word",
      len: m[0].length,
    });
  }

  while ((m = symbolRe.exec(t))) {
    matches.push({
      index: m.index,
      sep: m[1],
      type: "symbol",
      len: m[0].length,
    });
  }

  if (!matches.length) return null;

  // выбираем самый центральный
  const mid = t.length / 2;
  matches.sort((a, b) => Math.abs(a.index - mid) - Math.abs(b.index - mid));
  const best = matches[0];

  const left = t.slice(0, best.index).trim();
  const right = t.slice(best.index + best.len).trim();

  if (!left || !right) return null;

  return {
    left,
    sep: best.sep,
    type: best.type, // word | symbol
    right,
  };
}

function fitTextNoEllipsis(ctx, text, maxWidth) {
  let s = String(text || "").trim();
  if (!s) return { text: "", clipped: false };

  if (ctx.measureText(s).width <= maxWidth) return { text: s, clipped: false };

  // режем, пока не влезет (БЕЗ добавления "…")
  while (s.length > 1 && ctx.measureText(s).width > maxWidth) {
    s = s.slice(0, -1);
  }
  return { text: s.trim(), clipped: true };
}

/**
 * Рисует заголовок:
 * - если есть союз => 3 строки (верх/союз маленький/низ)
 * - иначе => wrapLines как раньше
 * Автоподбор размера.
 */
function drawSmartTitle(ctx, text, { x, yCenter, maxWidth } = {}) {
  const raw = String(text || "—").trim() || "—";
  const split = splitTitleBySeparator(raw);

  const MAX_ATTEMPTS = 7;

  let big = 44; // главный кегль
  const conjRatio = 0.52;
  const lineGap = 8;
  const dotsGap = 10; // отступ до строки "…"
  const dotsSizeRatio = 0.55; // размер "…" относительно big

  function drawDotsLine(y) {
    ctx.save();
    ctx.fillStyle = "rgba(255,255,255,0.62)";
    const dotsSize = Math.round(big * dotsSizeRatio);
    ctx.font = `800 ${dotsSize}px system-ui, -apple-system, Segoe UI, Roboto, Arial`;
    ctx.fillText("…", x, y);
    ctx.restore();
  }

  function drawThree(left, sep, type, right) {
    const L = left.toUpperCase();
    const C = type === "word" ? sep.toUpperCase() : sep; // символы не капсим

    const R = right.toUpperCase();

    const small = Math.round(big * conjRatio);

    // 1) подгоняем строки по ширине, но БЕЗ "…"
    ctx.font = `800 ${big}px system-ui, -apple-system, Segoe UI, Roboto, Arial`;
    const a = fitTextNoEllipsis(ctx, L, maxWidth);
    const c = fitTextNoEllipsis(ctx, R, maxWidth);

    ctx.font = `700 ${small}px system-ui, -apple-system, Segoe UI, Roboto, Arial`;
    const b = fitTextNoEllipsis(ctx, C, maxWidth);

    const clipped = a.clipped || b.clipped || c.clipped;

    // 2) геометрия блока (3 строки + опционально "…")
    const dotsSize = Math.round(big * dotsSizeRatio);
    const dotsH = clipped ? dotsGap + dotsSize : 0;

    const h = big + lineGap + small + lineGap + big + dotsH;
    const y1 = yCenter - h / 2 + big / 2;
    const y2 = y1 + big / 2 + lineGap + small / 2;
    const y3 = y2 + small / 2 + lineGap + big / 2;

    ctx.fillStyle = "rgba(255,255,255,0.92)";
    ctx.font = `800 ${big}px system-ui, -apple-system, Segoe UI, Roboto, Arial`;
    ctx.fillText(a.text, x, y1);

    const sepFont = `700 ${small}px system-ui, -apple-system, Segoe UI, Roboto, Arial`;

    // слова (and/or/и/или) не вращаем, символы — можно
    drawSepMaybeRotated(ctx, b.text, x, y2, {
      font: sepFont,
      fillStyle: "rgba(255,255,255,0.70)",
      rotateIfTall: type !== "word",
    });

    ctx.fillStyle = "rgba(255,255,255,0.92)";
    ctx.font = `800 ${big}px system-ui, -apple-system, Segoe UI, Roboto, Arial`;
    ctx.fillText(c.text, x, y3);

    if (clipped) {
      drawDotsLine(y3 + big / 2 + dotsGap + dotsSize / 2);
    }

    return clipped;
  }

  function drawWrapped() {
    // хотим максимум 3 строки текста, а "…" — отдельной строкой, если не влезло
    ctx.font = `800 ${big}px system-ui, -apple-system, Segoe UI, Roboto, Arial`;

    // ✅ wrapLines теперь должен возвращать { lines, truncated }
    const res = wrapLines(ctx, raw.toUpperCase(), maxWidth, 3);
    const lines = Array.isArray(res?.lines)
      ? res.lines
      : Array.isArray(res)
      ? res
      : [];
    const overflow = !!res?.truncated;

    // ✅ страховка: если в строках вдруг уже есть "…", убираем
    const stripDots = (s) => String(s || "").replace(/\s*…\s*$/u, "");

    // подрежем каждую строку по ширине (без …)
    const safeLines = [];
    let clippedAny = false;

    for (const ln0 of lines) {
      const ln = stripDots(ln0);
      const f = fitTextNoEllipsis(ctx, ln, maxWidth);
      safeLines.push(f.text);
      clippedAny = clippedAny || f.clipped;
    }

    // ✅ "…" рисуем только отдельной строкой
    const clipped = overflow || clippedAny;

    const lineH = Math.round(big * 1.05);
    const dotsSize = Math.round(big * dotsSizeRatio);
    const dotsH = clipped ? dotsGap + dotsSize : 0;

    const blockH = safeLines.length * lineH + dotsH;
    let yy = yCenter - blockH / 2 + lineH / 2;

    ctx.fillStyle = "rgba(255,255,255,0.92)";
    ctx.font = `800 ${big}px system-ui, -apple-system, Segoe UI, Roboto, Arial`;

    for (const ln of safeLines) {
      ctx.fillText(ln, x, yy);
      yy += lineH;
    }

    if (clipped) {
      drawDotsLine(yy + dotsGap + dotsSize / 2);
    }

    return clipped;
  }

  // Подбираем размер (по ширине), чтобы не было диких обрезаний
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (split) {
      ctx.font = `800 ${big}px system-ui, -apple-system, Segoe UI, Roboto, Arial`;
      const w1 = ctx.measureText(split.left.toUpperCase()).width;
      const w3 = ctx.measureText(split.right.toUpperCase()).width;
      if (w1 <= maxWidth && w3 <= maxWidth) break;
    } else {
      ctx.font = `800 ${big}px system-ui, -apple-system, Segoe UI, Roboto, Arial`;
      const tRes = wrapLines(ctx, raw.toUpperCase(), maxWidth, 3);
      const testLines = Array.isArray(tRes?.lines)
        ? tRes.lines
        : Array.isArray(tRes)
        ? tRes
        : [];
      const tooWide = testLines.some(
        (ln) => ctx.measureText(String(ln)).width > maxWidth
      );
      if (!tooWide) break;
    }
    big -= 4;
  }

  if (split) drawThree(split.left, split.sep, split.type, split.right);
  else drawWrapped();

  function drawSepMaybeRotated(
    ctx,
    sep,
    x,
    y,
    { font, fillStyle, rotateIfTall = true } = {}
  ) {
    const s = String(sep || "").trim();
    if (!s) return;

    ctx.save();
    ctx.font = font;
    ctx.fillStyle = fillStyle || "rgba(255,255,255,0.70)";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    const m = ctx.measureText(s);
    const w = m.width || 0;

    // height доступен не везде — используем fallback
    const h =
      Number.isFinite(m.actualBoundingBoxAscent) &&
      Number.isFinite(m.actualBoundingBoxDescent)
        ? m.actualBoundingBoxAscent + m.actualBoundingBoxDescent
        : parseFloat(String(font).match(/(\d+(\.\d+)?)px/)?.[1] || "16") * 0.9;

    const shouldRotate = rotateIfTall && h > w * 1.15; // порог

    if (shouldRotate) {
      ctx.translate(x, y);
      ctx.rotate(Math.PI / 2); // 90°
      ctx.fillText(s, 0, 0);
    } else {
      ctx.fillText(s, x, y);
    }

    ctx.restore();
  }
}

function wrapLines(ctx, text, maxWidth, maxLines = 3) {
  const words = String(text || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const lines = [];
  let line = "";
  let usedWordCount = 0;

  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const test = line ? line + " " + w : w;

    if (ctx.measureText(test).width <= maxWidth) {
      line = test;
      usedWordCount = i + 1;
      continue;
    }

    // перенос строки
    if (line) lines.push(line);
    line = w;

    // если достигли лимита строк — стоп, НО НЕ добавляем "…"
    if (lines.length >= maxLines) {
      return { lines, truncated: true };
    }

    usedWordCount = i + 1;
  }

  if (line && lines.length < maxLines) lines.push(line);

  const truncated = usedWordCount < words.length;
  return { lines, truncated };
}

function drawNoise(ctx, w, h, alpha = 0.06) {
  // лёгкая “пыль” как на референсе
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const v = (Math.random() * 255) | 0;
    d[i] = v;
    d[i + 1] = v;
    d[i + 2] = v;
    d[i + 3] = (alpha * 255) | 0;
  }
  ctx.putImageData(img, 0, 0);
}

function drawGlowLine(ctx, x1, y1, x2, y2, color, alpha = 0.6) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.shadowColor = color;
  ctx.shadowBlur = 16;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.restore();
}

function drawGlassFrame(ctx, x, y, w, h, r, c1, c2) {
  // “стеклянная рамка” + подсветка углов как на варианте C
  ctx.save();

  // основная рамка
  roundRectPath(ctx, x, y, w, h, r);
  ctx.strokeStyle = "rgba(255,255,255,0.22)";
  ctx.lineWidth = 2;
  ctx.shadowColor = "rgba(0,0,0,0.35)";
  ctx.shadowBlur = 10;
  ctx.stroke();

  // внутренняя тонкая линия
  roundRectPath(ctx, x + 10, y + 10, w - 20, h - 20, r - 6);
  ctx.strokeStyle = "rgba(255,255,255,0.14)";
  ctx.lineWidth = 1;
  ctx.stroke();

  // световые акценты (левый верх — холодный, правый — тёплый)
  drawGlowLine(ctx, x + 18, y + 28, x + 18, y + h - 48, c1, 0.55);
  drawGlowLine(ctx, x + w - 18, y + 28, x + w - 18, y + h - 48, c2, 0.55);

  // верхний блик
  const shine = ctx.createLinearGradient(0, y, 0, y + h * 0.55);
  shine.addColorStop(0, "rgba(255,255,255,0.26)");
  shine.addColorStop(0.35, "rgba(255,255,255,0.08)");
  shine.addColorStop(1, "rgba(255,255,255,0.00)");
  roundRectPath(ctx, x + 2, y + 2, w - 4, h - 4, r);
  ctx.fillStyle = shine;
  ctx.fill();

  ctx.restore();
}

function drawBackdrop(ctx, w, h, c1, c2) {
  // фон “космос/туман” как на C: градиент + мягкие засветки
  const bg = ctx.createLinearGradient(0, 0, w, h);
  bg.addColorStop(0, "rgba(10,10,18,1)");
  bg.addColorStop(0.5, "rgba(14,14,26,1)");
  bg.addColorStop(1, "rgba(8,8,14,1)");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  // мягкие blobs
  ctx.save();
  ctx.globalAlpha = 0.9;

  const g1 = ctx.createRadialGradient(
    w * 0.22,
    h * 0.22,
    0,
    w * 0.22,
    h * 0.22,
    w * 0.72
  );
  g1.addColorStop(0, hexToRgba(c1, 0.35));
  g1.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g1;
  ctx.fillRect(0, 0, w, h);

  const g2 = ctx.createRadialGradient(
    w * 0.82,
    h * 0.38,
    0,
    w * 0.82,
    h * 0.38,
    w * 0.75
  );
  g2.addColorStop(0, hexToRgba(c2, 0.28));
  g2.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g2;
  ctx.fillRect(0, 0, w, h);

  ctx.restore();

  // лёгкая “пыль”
  drawNoise(ctx, w, h, 0.045);
}

function hexToRgba(hex, a) {
  const h = String(hex || "").replace("#", "");
  if (h.length !== 6) return `rgba(255,255,255,${a})`;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}

export function makeGlassFallbackCanvas({ title, media_type, year } = {}) {
  const W = 400;
  const H = 600;

  const t = String(title || "—").trim() || "—";
  const mt = String(media_type || "").trim();
  const y =
    year != null && String(year).trim() !== "" ? String(year).trim() : "";

  const [c1, c2] = getGradient(mt);

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;

  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  // ====== ТВОЙ текущий рендер (drawBackdrop / drawGlassFrame / drawSmartTitle / year / caption) ======
  drawBackdrop(ctx, W, H, c1, c2);

  const pad = 28;
  const x = pad;
  const y0 = pad;
  const w = W - pad * 2;
  const h = H - pad * 2;
  const r = 24;

  ctx.save();
  roundRectPath(ctx, x, y0, w, h, r);
  ctx.fillStyle = "rgba(8,8,14,0.42)";
  ctx.fill();
  ctx.restore();

  drawGlassFrame(ctx, x, y0, w, h, r, c1, c2);

  ctx.save();
  ctx.fillStyle = "rgba(255,255,255,0.92)";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.shadowColor = "rgba(0,0,0,0.55)";
  ctx.shadowBlur = 10;

  drawSmartTitle(ctx, t, { x: W / 2, yCenter: H * 0.46, maxWidth: w - 56 });

  ctx.restore();

  if (y) {
    ctx.save();
    ctx.fillStyle = "rgba(255,255,255,0.72)";
    ctx.font = "700 22px system-ui, -apple-system, Segoe UI, Roboto, Arial";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    const yearY = H * 0.82;
    ctx.strokeStyle = "rgba(255,255,255,0.18)";
    ctx.lineWidth = 1;

    const mid = W / 2;
    ctx.beginPath();
    ctx.moveTo(mid - 110, yearY);
    ctx.lineTo(mid - 48, yearY);
    ctx.moveTo(mid + 48, yearY);
    ctx.lineTo(mid + 110, yearY);
    ctx.stroke();

    ctx.fillText(y, mid, yearY);
    ctx.restore();
  }

  ctx.save();
  ctx.fillStyle = "rgba(255,255,255,0.60)";
  ctx.font = "600 14px system-ui, -apple-system, Segoe UI, Roboto, Arial";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("No poster available", W / 2, H * 0.875);
  ctx.restore();

  return canvas;
}

// Оставляем для <img>, но вызывать будем ЛЕНИВО
export function makeGlassFallbackDataUrl(args = {}) {
  return makeGlassFallbackCanvas(args).toDataURL("image/png");
}
