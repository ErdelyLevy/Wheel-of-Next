// public/js/api.js

async function jsonOrThrow(r) {
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
  if (j && j.ok === false) throw new Error(j.error || "API error");
  return j;
}

export async function apiGetPresets() {
  const r = await fetch("/api/presets", { cache: "no-store" });
  const j = await jsonOrThrow(r);
  return j.presets || [];
}

export async function apiSavePreset(payload) {
  const r = await fetch("/api/presets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const j = await jsonOrThrow(r);
  // сервер может вернуть preset как "preset" или в списке — поддержим оба варианта
  return j.preset || j;
}

export async function apiDeletePreset(id) {
  const r = await fetch(`/api/presets/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  return jsonOrThrow(r);
}

export async function apiGetMeta() {
  const r = await fetch("/api/meta", { cache: "no-store" });
  return jsonOrThrow(r);
}

export async function apiGetItemsByPreset(presetId) {
  const r = await fetch(
    `/api/items?preset_id=${encodeURIComponent(presetId)}`,
    { cache: "no-store" }
  );
  const j = await r.json();
  if (!r.ok || j?.ok === false)
    throw new Error(j?.error || "items fetch failed");
  return j.rows || [];
}

export async function apiRoll(presetId, { save = true } = {}) {
  const r = await fetch("/api/random", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ preset_id: presetId, save }),
  });
  const j = await r.json();
  if (!r.ok || j?.ok === false) throw new Error(j?.error || "roll failed");
  return j;
}

export async function apiGetHistory(limit = 50) {
  const r = await fetch(`/api/history?limit=${encodeURIComponent(limit)}`, {
    cache: "no-store",
  });
  const j = await r.json();
  if (!r.ok || j?.ok === false)
    throw new Error(j?.error || "history fetch failed");
  return j.rows || [];
}

export async function apiGetHistoryById(id) {
  const r = await fetch(`/api/history/${encodeURIComponent(id)}`, {
    cache: "no-store",
  });
  const j = await r.json();
  if (!r.ok || j?.ok === false)
    throw new Error(j?.error || "history fetch failed");
  return j.row || null;
}
