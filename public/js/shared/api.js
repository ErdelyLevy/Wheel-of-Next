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

let presetsCache = null;
let presetsPromise = null;

export async function apiGetPresets({ force = false } = {}) {
  if (!force && presetsCache) return presetsCache;
  if (!force && presetsPromise) return presetsPromise;

  presetsPromise = (async () => {
    const r = await apiFetch(`/api/presets`);
    const j = await jsonOrThrow(r);
    presetsCache = j.presets || [];
    return presetsCache;
  })();

  try {
    return await presetsPromise;
  } finally {
    presetsPromise = null;
  }
}

export async function apiGetVirtualCollections() {
  const r = await apiFetch(`/api/virtual-collections`);
  const j = await jsonOrThrow(r);
  return j.rows || [];
}

export async function apiRandomBegin(presetId, { size } = {}) {
  const body = { preset_id: presetId };
  if (size != null) body.size = size;
  const r = await apiFetch(`/api/random/begin`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return await jsonOrThrow(r);
}

export async function apiRandomWinner({ snapshotId, baseHistoryId } = {}) {
  const body = {};
  if (snapshotId) body.snapshot_id = snapshotId;
  if (baseHistoryId) body.base_history_id = baseHistoryId;
  const r = await apiFetch(`/api/random/winner`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return await jsonOrThrow(r);
}

export async function apiRandomCommit({
  snapshotId,
  baseHistoryId,
  winnerIndex,
} = {}) {
  const body = { winner_index: winnerIndex };
  if (snapshotId) body.snapshot_id = snapshotId;
  if (baseHistoryId) body.base_history_id = baseHistoryId;
  const r = await apiFetch(`/api/random/commit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return await jsonOrThrow(r);
}

export async function apiRandomAbort(snapshotId) {
  const r = await apiFetch(`/api/random/abort`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ snapshot_id: snapshotId }),
  });
  return await jsonOrThrow(r);
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

let metaCache = null;
let metaPromise = null;

export async function apiGetMeta({ force = false } = {}) {
  if (!force && metaCache) return metaCache;
  if (!force && metaPromise) return metaPromise;

  metaPromise = (async () => {
    const r = await apiFetch(`/api/meta`);
    metaCache = await jsonOrThrow(r);
    return metaCache;
  })();

  try {
    return await metaPromise;
  } finally {
    metaPromise = null;
  }
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
