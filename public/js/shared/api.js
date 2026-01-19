export const WHEEL_BASE = window.location.pathname.startsWith("/wheel/")
  ? "/wheel"
  : "";

async function apiFetch(path, init) {
  const r = await fetch(`${WHEEL_BASE}${path}`, {
    cache: "no-store",
    ...(init || {}),
  });
  return r;
}

async function jsonOrThrow(r) {
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
  if (j && j.ok === false) throw new Error(j.error || "API error");
  return j;
}

export async function apiDeleteVirtualCollection(id) {
  const r = await apiFetch(
    `/api/virtual-collections/${encodeURIComponent(id)}`,
    {
      method: "DELETE",
    },
  );
  await jsonOrThrow(r);
  return true;
}

export async function apiGetHistory(limit = 50) {
  const r = await apiFetch(`/api/history?limit=${encodeURIComponent(limit)}`);
  const j = await jsonOrThrow(r);
  return j.rows || [];
}

export async function apiGetHistoryById(id) {
  const r = await apiFetch(`/api/history/${encodeURIComponent(id)}`);
  const j = await jsonOrThrow(r);
  return j.row || null;
}

export async function apiGetItemsByPreset(presetId) {
  const r = await apiFetch(
    `/api/items?preset_id=${encodeURIComponent(presetId)}`,
  );
  const j = await jsonOrThrow(r);
  return j.rows || [];
}

export async function apiGetPresets() {
  const r = await apiFetch(`/api/presets`);
  const j = await jsonOrThrow(r);
  return j.presets || [];
}

export async function apiGetVirtualCollections() {
  const r = await apiFetch(`/api/virtual-collections`);
  const j = await jsonOrThrow(r);
  return j.rows || [];
}

export async function apiRoll(presetId, { save = true } = {}) {
  const r = await apiFetch(`/api/random`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ preset_id: presetId, save }),
  });
  const j = await jsonOrThrow(r);
  return j;
}

export async function apiUpsertVirtualCollection(payload) {
  const r = await apiFetch(`/api/virtual-collections`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload || {}),
  });
  const j = await jsonOrThrow(r);
  return j.row || null;
}

export async function apiGetMeta() {
  const r = await apiFetch(`/api/meta`);
  return await jsonOrThrow(r);
}

export async function apiUpsertPreset(payload) {
  const r = await apiFetch(`/api/presets`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const j = await jsonOrThrow(r);
  return j.preset || j; // на случай разного формата
}

export async function apiDeletePreset(id) {
  const r = await apiFetch(`/api/presets/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  await jsonOrThrow(r);
  return true;
}
