export function buildWeightedSegments(items) {
  const arr = Array.isArray(items) ? items : [];
  if (!arr.length) return [];

  const ws = arr.map((it) => {
    const w = Number(it?.w);
    return Number.isFinite(w) && w > 0 ? w : 1;
  });

  const total = ws.reduce((a, b) => a + b, 0) || 1;

  let acc = 0;
  const segs = arr.map((item, i) => {
    const da = (ws[i] / total) * Math.PI * 2;
    const start = acc;
    const end = acc + da;
    acc = end;
    return { item, start, end, w: ws[i] };
  });

  segs[segs.length - 1].end = Math.PI * 2;
  return segs;
}
