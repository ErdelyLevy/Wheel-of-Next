import { toast } from "../shared/showToast.js";
import { buildMultiSelect } from "./initPresetDropdowns.js";
import { escapeHtml } from "../shared/utils.js";
import {
  apiDeleteVirtualCollection,
  apiGetMeta,
  apiGetVirtualCollections,
  apiUpsertVirtualCollection,
} from "../shared/api.js";

export async function initVirtualCollectionsUI({ initial = null } = {}) {
  const listEl = document.getElementById("vc-list");
  const addBtn = document.getElementById("vc-add");
  if (!listEl || !addBtn) return;

  let meta = null;
  try {
    meta = await apiGetMeta();
  } catch (e) {
    console.error("[vc] meta failed:", e);
    meta = { media_types: [] };
  }
  const mediaTypes = Array.isArray(meta?.media_types) ? meta.media_types : [];

  function initMediaSelect(row) {
    const msRoot = row.querySelector(".vc-ms");
    const hidden = row.querySelector(".vc-media");
    if (!msRoot || !hidden) return;

    buildSingleSelect(
      msRoot,
      mediaTypes,
      () => hidden.value,
      (v) => {
        hidden.value = String(v || "");
        markDirty(row);
      },
    );
  }

  function markDirty(row) {
    row.dataset.dirty = "1";
    row.classList.add("is-dirty");
    const saveBtn = row.querySelector(".vc-save");
    if (saveBtn) saveBtn.disabled = false;
  }

  function clearDirty(row) {
    row.dataset.dirty = "0";
    row.classList.remove("is-dirty");
    const saveBtn = row.querySelector(".vc-save");
    if (saveBtn) saveBtn.disabled = true;
  }

  function makeRow(data = {}) {
    const row = document.createElement("div");
    row.className = "vc-row";

    // сохраняем id (если уже есть в БД)
    const id = String(data.id || "").trim();
    if (id) row.dataset.id = id;

    const msId = uid();

    row.innerHTML = `
  <div class="vc-cell vc-name-cell">
    <input
      class="vc-name"
      type="text"
      placeholder="Название (напр. Marvel Comics)"
      value="${escapeHtml(data.name || "")}"
      aria-label="Название"
    />
  </div>

  <div class="vc-cell vc-media-cell">
    <div class="ms vc-ms" id="${msId}">
      <button class="ms-btn" type="button" aria-haspopup="listbox" aria-expanded="false">
        <span class="ms-text" data-placeholder="Выбрать…">Выбрать…</span>
        <span class="ms-caret">▾</span>
      </button>

      <div class="ms-pop is-hidden">
        <div class="ms-search">
          <input type="search" class="ms-search-input" placeholder="Поиск…" />
        </div>
        <div class="ms-list" role="listbox"></div>
      </div>

      <input type="hidden" class="vc-media" value="${escapeHtml(
        (data.media || "").trim(),
      )}" />
    </div>
  </div>

  <div class="vc-cell vc-poster-cell">
    <input
      class="vc-poster"
      type="text"
      placeholder="Постер (https://…)"
      value="${escapeHtml(data.poster || "")}"
      aria-label="Постер"
    />
  </div>

  <div class="vc-cell vc-source-label-cell">
    <input
      class="vc-source-label"
      type="text"
      placeholder="Источник (лейбл) напр. MARVEL"
      value="${escapeHtml(data.source_label || "")}"
      aria-label="Источник (лейбл)"
    />
  </div>

  <div class="vc-cell vc-source-url-cell">
    <input
      class="vc-source-url"
      type="text"
      placeholder="Источник (URL) https://…"
      value="${escapeHtml(data.source_url || "")}"
      aria-label="Источник (URL)"
    />
  </div>

  <div class="vc-cell vc-actions">
    <button class="tab vc-save" type="button" title="Сохранить" aria-label="Сохранить" disabled>💾</button>
    <button class="tab vc-del" type="button" title="Удалить" aria-label="Удалить">×</button>
  </div>
`;

    // любые изменения -> dirty
    row
      .querySelector(".vc-name")
      ?.addEventListener("input", () => markDirty(row));
    row
      .querySelector(".vc-poster")
      ?.addEventListener("input", () => markDirty(row));
    row
      .querySelector(".vc-source-label")
      ?.addEventListener("input", () => markDirty(row));

    row
      .querySelector(".vc-source-url")
      ?.addEventListener("input", () => markDirty(row));

    initMediaSelect(row);

    // если это уже существующая строка — считаем чистой
    if (id) clearDirty(row);
    else markDirty(row);

    return row;
  }

  function addRow(data = {}) {
    listEl.appendChild(makeRow(data));
  }

  async function reload() {
    try {
      const rows = await apiGetVirtualCollections();

      listEl.innerHTML = "";
      rows.forEach((x) => addRow(x));
    } catch (e) {
      toast(String(e?.message || e));
    }
  }

  // add new row
  addBtn.addEventListener("click", () => addRow({}));

  // save/delete (делегирование)
  listEl.addEventListener("click", async (e) => {
    console.log("[vc] click target=", e.target);
    const saveBtn = e.target?.closest?.(".vc-save");
    const delBtn = e.target?.closest?.(".vc-del");
    const row = e.target?.closest?.(".vc-row");
    console.log("[vc] saveBtn?", !!saveBtn, "delBtn?", !!delBtn, "row?", !!row);
    if (!row) return;

    // SAVE
    if (saveBtn) {
      console.log("[vc] SAVE clicked");
      const name = String(row.querySelector(".vc-name")?.value || "").trim();
      const media = String(row.querySelector(".vc-media")?.value || "").trim();
      const poster = String(
        row.querySelector(".vc-poster")?.value || "",
      ).trim();
      const source_label = String(
        row.querySelector(".vc-source-label")?.value || "",
      ).trim();

      const source_url = String(
        row.querySelector(".vc-source-url")?.value || "",
      ).trim();

      console.log("[vc] payload fields:", {
        name,
        media,
        poster,
        source_label,
        source_url,
      });

      if (!name) return toast("VC: имя обязательно");
      if (!media) return toast("VC: media обязательно");

      // если id нет — генерим из имени
      let id = String(row.dataset.id || "").trim();
      if (!id) {
        id = genVcIdFromName(name);
        row.dataset.id = id;
      }

      console.log("[vc] calling apiUpsertVirtualCollection...", id);

      saveBtn.disabled = true;
      try {
        const saved = await apiUpsertVirtualCollection({
          id,
          name,
          media,
          poster,
          source_label,
          source_url,
        });

        console.log("[vc] saved=", saved);

        // на всякий случай синхронизируем из ответа
        if (saved?.id) row.dataset.id = String(saved.id);
        clearDirty(row);
        toast("Сохранено");
      } catch (err) {
        console.error("[vc] upsert failed:", err);
        saveBtn.disabled = false;
        toast(String(err?.message || err));
      }
      return;
    }

    // DELETE
    if (delBtn) {
      console.log("[vc] DELETE clicked");
      const id = String(row.dataset.id || "").trim();

      // если в БД ещё нет — просто удаляем из DOM
      if (!id) {
        row.remove();
        return;
      }

      try {
        await apiDeleteVirtualCollection(id);

        row.remove();
        toast("Удалено");
      } catch (err) {
        toast(String(err?.message || err));
      }
    }
  });

  // initial render
  if (Array.isArray(initial)) {
    listEl.innerHTML = "";
    initial.forEach((x) => addRow(x));
  } else {
    // ✅ автозагрузка из API
    await reload();
  }

  // debug helpers
  window.__vcReload = reload;
}

function uid(prefix = "vcms") {
  return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now()}`;
}

function slugify(s) {
  const x = String(s || "")
    .trim()
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9а-яё]+/gi, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
  return x || "vc";
}

function genVcIdFromName(name) {
  return `vc_${slugify(name)}`;
}

function buildSingleSelect(msRoot, options, getValue, setValue) {
  msRoot.dataset.mode = "single"; // 👈 флаг

  return buildMultiSelect(
    msRoot,
    options,
    () => {
      const v = String(getValue?.() ?? "").trim();
      return v ? [v] : [];
    },
    (arr) => {
      const v = Array.isArray(arr) && arr.length ? String(arr[0] ?? "") : "";
      setValue?.(v);
    },
  );
}
