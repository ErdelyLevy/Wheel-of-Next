import { getState, setPresetDraft, setState, $ } from "../shared/state.js";
import { apiGetMeta, apiGetVirtualCollections } from "../shared/api.js";

let __msMediaRoot = null;
let __msCollectionRoot = null;
let __metaCache = { media_types: [], collections: [] };
let __msVcRoot = null;
let __vcCache = []; // [{id,name,media,poster,...}]
const DEFAULT_WEIGHT = 1.0;

export async function initPresetDropdowns() {
  const msMedia = document.getElementById("ms-media");
  const msCollection = document.getElementById("ms-collection");
  const msVc = document.getElementById("ms-vc");
  if (!msMedia || !msCollection || !msVc) return;

  const meta = await apiGetMeta();

  const vcRows = await apiGetVirtualCollections(); // [{id,name,media,...}]
  __vcCache = vcRows || [];

  // после __vcCache = vcRows || [];
  msVc.__labelOf = (id) => {
    const sid = String(id || "");
    const row = (__vcCache || []).find((x) => String(x?.id || "") === sid);
    return String(row?.name || sid);
  };

  const vcOptions = (__vcCache || []).map((x) => ({
    value: String(x.id),
    label: String(x.name || x.id),
  }));

  const s = getState();

  __msMediaRoot = msMedia;
  __msCollectionRoot = msCollection;
  __msVcRoot = msVc;
  __metaCache = meta;

  // ✅ MEDIA
  buildMultiSelect(
    msMedia,
    meta.media_types || [],
    () => getState().presetDraft.media || [],
    (arr) => {
      setPresetDraft({ ...getState().presetDraft, media: arr || [] });
      syncHidden("preset-media", arr || []);
      renderWeights(); // необязательно, но пусть будет консистентно
    },
  );

  // ✅ RYOT COLLECTIONS
  buildMultiSelect(
    msCollection,
    meta.collections || [],
    () => getState().presetDraft.categories || [],
    (arr) => {
      setPresetDraft({ ...getState().presetDraft, categories: arr || [] });
      syncHidden("preset-category", arr || []);
      renderWeights();
    },
  );

  // ✅ VIRTUAL COLLECTIONS
  buildMultiSelect(
    msVc,
    vcOptions,
    () => getState().presetDraft.virtual_collection_ids || [],
    (arr) => {
      setPresetDraft({
        ...getState().presetDraft,
        virtual_collection_ids: arr || [],
      });
      syncHidden("preset-vc", arr || []);
      renderWeights();
    },
  );

  // initial sync
  syncHidden("preset-media", s.presetDraft.media || []);
  syncHidden("preset-category", s.presetDraft.categories || []);
  syncHidden("preset-vc", s.presetDraft.virtual_collection_ids || []);
  renderWeights(); // ✅ без аргументов

  syncPresetEditorFromState();
}

export function syncPresetEditorFromState() {
  const s = getState();
  const draft = s.presetDraft || {
    name: "",
    media: [],
    categories: [],
    virtual_collection_ids: [],
    weights: {},
  };

  const nameEl = document.getElementById("preset-name");
  if (nameEl) nameEl.value = draft.name || "";

  syncHidden("preset-media", draft.media || []);
  syncHidden("preset-category", draft.categories || []);
  syncHidden("preset-vc", draft.virtual_collection_ids || []);

  if (__msMediaRoot) __applyMultiSelectUI(__msMediaRoot, draft.media || []);
  if (__msCollectionRoot)
    __applyMultiSelectUI(__msCollectionRoot, draft.categories || []);
  if (__msVcRoot)
    __applyMultiSelectUI(__msVcRoot, draft.virtual_collection_ids || []);

  renderWeights(); // ✅ без аргументов
}

function resetPresetEditorForm() {
  // очисти поля формы (name, collections, media_types, weights и т.д.)
  // и главное:
  setState({ editor: { presetId: null } }); // или как у тебя устроен state
}

document.getElementById("preset-new-btn")?.addEventListener("click", () => {
  resetPresetEditorForm();
});

function renderMsLabel(msRoot, selected) {
  const textEl = $(".ms-text", msRoot);
  const placeholder = textEl?.dataset?.placeholder || "Выбрать…";
  if (!textEl) return;

  if (!selected.length) textEl.textContent = placeholder;
  const labelOf =
    typeof msRoot.__labelOf === "function"
      ? msRoot.__labelOf
      : (x) => String(x);

  const labels = selected.map(labelOf);

  if (!labels.length) textEl.textContent = placeholder;
  else if (labels.length <= 2) textEl.textContent = labels.join(", ");
  else textEl.textContent = `${labels[0]}, ${labels[1]} +${labels.length - 2}`;
}

function syncHidden(id, arr) {
  const el = document.getElementById(id);
  if (el) el.value = JSON.stringify(arr || []);
}

export function buildMultiSelect(
  msRoot,
  values,
  getSelected,
  setSelected,
  onChange,
) {
  const btn = $(".ms-btn", msRoot);
  const pop = $(".ms-pop", msRoot);
  const list = $(".ms-list", msRoot);
  const search = $(".ms-search-input", msRoot);
  const clearBtn = $(".ms-clear", msRoot);

  if (!btn || !pop || !list) return;

  const all = [...(values || [])].map((v) => {
    if (v && typeof v === "object") {
      const value = String(v.value ?? "").trim();
      const label = String(v.label ?? value).trim();
      return { value, label };
    }
    const value = String(v ?? "").trim();
    return { value, label: value };
  });

  // ✅ режим: по умолчанию multi, single только если явно выставлен
  const isSingle = (msRoot?.dataset?.mode || "").toLowerCase() === "single";

  // не даём кликам внутри popover всплывать до document
  pop.addEventListener("click", (e) => e.stopPropagation());

  function close() {
    pop.classList.add("is-hidden");
    btn.setAttribute("aria-expanded", "false");
    document.removeEventListener("keydown", onKeyDown);
  }

  function open() {
    pop.classList.remove("is-hidden");
    btn.setAttribute("aria-expanded", "true");
    renderList(search?.value || "");
    search?.focus();
    document.addEventListener("keydown", onKeyDown);
  }

  function onKeyDown(e) {
    if (e.key === "Escape") close();
  }

  // кнопка очистки
  clearBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    setSelected([]);
    renderMsLabel(msRoot, []);
    if (typeof onChange === "function") onChange([]);

    if (search) search.value = "";
    renderList("");
  });

  function renderList(filter = "") {
    list.innerHTML = "";
    const f = String(filter || "")
      .trim()
      .toLowerCase();
    const selected = Array.isArray(getSelected?.()) ? getSelected() : [];

    for (const opt of all) {
      const vs = opt.label; // фильтруем по label
      if (f && !vs.toLowerCase().includes(f)) continue;

      const value = opt.value;

      if (isSingle) {
        const row = document.createElement("button");
        row.type = "button";
        row.className = "ms-opt ms-opt-single";
        row.setAttribute("role", "option");

        const isSel = selected.length && String(selected[0]) === value;
        row.setAttribute("aria-selected", isSel ? "true" : "false");
        if (isSel) row.classList.add("is-selected");

        row.textContent = opt.label;

        row.addEventListener("click", () => {
          const next = [value];
          setSelected(next);
          renderMsLabel(msRoot, next);
          if (typeof onChange === "function") onChange(next);
          renderList(search?.value || "");
          close();
        });

        list.appendChild(row);
      } else {
        const row = document.createElement("label");
        row.className = "ms-opt";

        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.dataset.value = value; // ✅ ВАЖНО
        cb.value = vs;
        cb.checked = selected.includes(value);

        cb.addEventListener("change", () => {
          let next = Array.isArray(getSelected?.()) ? getSelected() : [];
          if (cb.checked) {
            if (!next.includes(value)) next = [...next, value];
          } else {
            next = next.filter((x) => x !== value);
          }
          setSelected(next);
          renderMsLabel(msRoot, next);
          if (typeof onChange === "function") onChange(next);
          renderList(search?.value || "");
        });

        const txt = document.createElement("span");
        txt.textContent = opt.label;

        row.appendChild(cb);
        row.appendChild(txt);
        list.appendChild(row);
      }
    }
  }

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const isOpen = !pop.classList.contains("is-hidden");
    isOpen ? close() : open();
  });

  document.addEventListener("click", (e) => {
    if (!msRoot.contains(e.target)) close();
  });

  search?.addEventListener("input", () => renderList(search.value));

  // initial label
  renderMsLabel(msRoot, Array.isArray(getSelected?.()) ? getSelected() : []);
  renderList("");
}

function stableSortEntries(entries) {
  return [...(entries || [])].sort((a, b) =>
    String(a?.label ?? a?.key ?? "").localeCompare(
      String(b?.label ?? b?.key ?? ""),
      "ru",
      { sensitivity: "base", numeric: true },
    ),
  );
}

function normalizeWeightsEntries(entries, weights) {
  const w = weights || {};
  const out = {};

  const sorted = stableSortEntries(entries);

  for (const e of sorted) {
    const v = Number(w[e.key]);
    out[e.key] = Number.isFinite(v) && v >= 0 ? v : DEFAULT_WEIGHT;
  }

  return { sortedEntries: sorted, weights: out };
}

function buildWeightEntriesFromDraft(draft) {
  const cats = (draft?.categories || []).map((c) => ({
    kind: "cat",
    key: String(c),
    label: String(c),
  }));

  const vcs = (draft?.virtual_collection_ids || []).map((id) => ({
    kind: "vc",
    key: "vc:" + String(id),
    label: vcNameById(id), // у тебя уже есть
  }));

  return [...cats, ...vcs];
}

function getWeightEntriesFromDraft(draft) {
  const cats = Array.isArray(draft?.categories) ? draft.categories : [];
  const vcIds = Array.isArray(draft?.virtual_collection_ids)
    ? draft.virtual_collection_ids
    : [];

  const entries = [];

  for (const c of cats) {
    const key = String(c || "").trim();
    if (!key) continue;
    entries.push({ key, label: key, kind: "cat" });
  }

  for (const id of vcIds) {
    const sid = String(id || "").trim();
    if (!sid) continue;
    entries.push({ key: "vc:" + sid, label: vcNameById(sid), kind: "vc" });
  }

  return entries;
}

function renderWeights() {
  const box = document.getElementById("preset-weights");
  if (!box) return;

  const st = getState();
  const draft = st.presetDraft || {};

  const entries = getWeightEntriesFromDraft(draft);

  const norm = normalizeWeightsEntries(entries, draft.weights || {});
  const sortedEntries = norm.sortedEntries;
  const weights = norm.weights;

  // ⚠️ ВАЖНО: не трогаем virtual_collection_ids тут вообще
  // и не пересобираем draft “с нуля”
  const prevWJson = JSON.stringify(draft.weights || {});
  const nextWJson = JSON.stringify(weights);

  if (prevWJson !== nextWJson) {
    setPresetDraft({ ...draft, weights });

    setTimeout(() => {
      const d = getState().presetDraft;
      console.log(
        "  AFTER setPresetDraft, draft.virtual_collection_ids =",
        d.virtual_collection_ids,
      );
    }, 0);
  }

  box.innerHTML = "";

  if (!sortedEntries.length) {
    const div = document.createElement("div");
    div.className = "muted";
    div.textContent = "Выбери коллекции и/или VC, чтобы задать веса.";
    box.appendChild(div);
    return;
  }

  for (const e of sortedEntries) {
    const row = document.createElement("div");
    row.className = "weight-row";

    const left = document.createElement("div");
    left.className = "name";
    left.textContent = e.label;

    const inp = document.createElement("input");
    inp.type = "number";
    inp.min = "0";
    inp.step = "0.1";
    inp.value = String(weights[e.key]);

    inp.addEventListener("input", () => {
      const v = Number(inp.value);
      const st2 = getState();
      const d2 = st2.presetDraft || {};

      const entries2 = getWeightEntriesFromDraft(d2);
      const next = normalizeWeightsEntries(entries2, {
        ...(d2.weights || {}),
        [e.key]: Number.isFinite(v) && v >= 0 ? v : DEFAULT_WEIGHT,
      });

      // опять же: только weights
      setPresetDraft({ ...d2, weights: next.weights });
    });

    row.appendChild(left);
    row.appendChild(inp);
    box.appendChild(row);
  }
}

function vcNameById(id) {
  const sid = String(id || "");
  const row = (__vcCache || []).find((x) => String(x?.id || "") === sid);
  const name = String(row?.name || "").trim();
  return name || sid;
}

function __qs(sel, root) {
  return root.querySelector(sel);
}

function __applyMultiSelectUI(msRoot, selected) {
  // обновить лейбл
  renderMsLabel(msRoot, selected);

  // если поповер открыт — перерисовать чекбоксы согласно state
  const pop = __qs(".ms-pop", msRoot);
  const isOpen = pop && !pop.classList.contains("is-hidden");
  if (!isOpen) return;

  const list = __qs(".ms-list", msRoot);
  if (!list) return;

  // просто пробежим по чекбоксам и выставим checked
  const set = new Set((selected || []).map((x) => String(x)));

  list.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
    const set = new Set((selected || []).map((x) => String(x)));
    list.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
      // ✅ сначала пробуем value (правильно), потом fallback на текст (старое поведение)
      const v = String(cb.value || "").trim();
      if (v) {
        cb.checked = set.has(v);
        return;
      }

      const label = cb.closest(".ms-opt");
      const text = String(
        label?.querySelector("span")?.textContent ?? "",
      ).trim();
      cb.checked = set.has(text);
    });
  });
}
