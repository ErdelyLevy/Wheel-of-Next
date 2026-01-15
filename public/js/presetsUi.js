// js/presetsUi.js
import { getState, setState, setPresetDraft } from "./state.js";

function resetPresetEditorForm() {
  // очисти поля формы (name, collections, media_types, weights и т.д.)
  // и главное:
  setState({ editor: { presetId: null } }); // или как у тебя устроен state
}

document.getElementById("preset-new-btn")?.addEventListener("click", () => {
  resetPresetEditorForm();
});

export async function fetchMeta() {
  const r = await fetch("/api/meta", { cache: "no-store" });
  if (!r.ok) throw new Error("meta fetch failed");
  return r.json();
}

function $(sel, root = document) {
  return root.querySelector(sel);
}

function renderMsLabel(msRoot, selected) {
  const textEl = $(".ms-text", msRoot);
  const placeholder = textEl?.dataset?.placeholder || "Выбрать…";
  if (!textEl) return;

  if (!selected.length) textEl.textContent = placeholder;
  else if (selected.length <= 2) textEl.textContent = selected.join(", ");
  else
    textEl.textContent = `${selected[0]}, ${selected[1]} +${
      selected.length - 2
    }`;
}

function syncHidden(id, arr) {
  const el = document.getElementById(id);
  if (el) el.value = JSON.stringify(arr || []);
}

function buildMultiSelect(msRoot, values, getSelected, setSelected, onChange) {
  const btn = $(".ms-btn", msRoot);
  const pop = $(".ms-pop", msRoot);
  const list = $(".ms-list", msRoot);
  const search = $(".ms-search-input", msRoot);
  const clearBtn = $(".ms-clear", msRoot);

  if (!btn || !pop || !list) return;

  const all = [...(values || [])];

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

    for (const v of all) {
      const vs = String(v);
      if (f && !vs.toLowerCase().includes(f)) continue;

      if (isSingle) {
        // ✅ SINGLE: без чекбоксов, кликабельная строка
        const row = document.createElement("button");
        row.type = "button";
        row.className = "ms-opt ms-opt-single";
        row.setAttribute("role", "option");

        const isSel = selected.length && String(selected[0]) === vs;
        row.setAttribute("aria-selected", isSel ? "true" : "false");
        if (isSel) row.classList.add("is-selected");

        row.textContent = vs;

        row.addEventListener("click", () => {
          const next = [v]; // строго одно значение
          setSelected(next);
          renderMsLabel(msRoot, next);
          if (typeof onChange === "function") onChange(next);

          // обновим список (подсветка)
          renderList(search?.value || "");
          // закрываем попап
          close();
        });

        list.appendChild(row);
      } else {
        // ✅ MULTI: как было (чекбоксы)
        const row = document.createElement("label");
        row.className = "ms-opt";

        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.checked = selected.includes(v);

        cb.addEventListener("change", () => {
          let next = Array.isArray(getSelected?.()) ? getSelected() : [];
          if (cb.checked) {
            if (!next.includes(v)) next = [...next, v];
          } else {
            next = next.filter((x) => x !== v);
          }
          setSelected(next);
          renderMsLabel(msRoot, next);
          if (typeof onChange === "function") onChange(next);
          renderList(search?.value || "");
        });

        const txt = document.createElement("span");
        txt.textContent = vs;

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

const DEFAULT_WEIGHT = 1.0;

function stableSortCategories(arr) {
  // стабильный порядок для UI: алфавит, без сюрпризов
  return [...(arr || [])].sort((a, b) =>
    String(a).localeCompare(String(b), "ru", {
      sensitivity: "base",
      numeric: true,
    })
  );
}

function normalizeWeights(categories, weights) {
  const w = weights || {};
  const out = {};

  // ВАЖНО: сортируем один раз — это и будет "стабильный UI порядок"
  const sorted = stableSortCategories(categories);

  for (const name of sorted) {
    const v = Number(w[name]);
    out[name] = Number.isFinite(v) && v >= 0 ? v : DEFAULT_WEIGHT;
  }

  // out содержит ТОЛЬКО выбранные категории
  return { sortedCategories: sorted, weights: out };
}

function renderWeights(selectedCategories) {
  const box = document.getElementById("preset-weights");
  if (!box) return;

  const s = getState();

  // Нормализуем: (1) сортировка стабильна, (2) дефолты, (3) удаление лишнего
  const norm = normalizeWeights(
    selectedCategories || [],
    s.presetDraft.weights || {}
  );

  const cats = norm.sortedCategories;
  const weights = norm.weights;

  // Синк hidden по нормализованным категориям
  syncHidden("preset-category", cats);

  // Обновляем state ТОЛЬКО если реально есть изменения
  // (важно: не дергать setPresetDraft на каждый рендер)
  const prevCatsJson = JSON.stringify(s.presetDraft.categories || []);
  const nextCatsJson = JSON.stringify(cats);

  const prevWJson = JSON.stringify(s.presetDraft.weights || {});
  const nextWJson = JSON.stringify(weights);

  if (prevCatsJson !== nextCatsJson || prevWJson !== nextWJson) {
    setPresetDraft({
      ...s.presetDraft,
      categories: cats,
      weights,
    });
  }

  // Рендер
  box.innerHTML = "";

  if (!cats.length) {
    const div = document.createElement("div");
    div.className = "muted";
    div.textContent = "Выбери хотя бы одну коллекцию, чтобы задать веса.";
    box.appendChild(div);
    return;
  }

  for (const name of cats) {
    const row = document.createElement("div");
    row.className = "weight-row";

    const left = document.createElement("div");
    left.className = "name";
    left.textContent = name;

    const inp = document.createElement("input");
    inp.type = "number";
    inp.min = "0";
    inp.step = "0.1";
    inp.value = String(weights[name]); // берем из norm.weights

    inp.addEventListener("input", () => {
      const v = Number(inp.value);

      const st = getState();
      const next = normalizeWeights(st.presetDraft.categories || [], {
        ...(st.presetDraft.weights || {}),
        [name]: Number.isFinite(v) && v >= 0 ? v : DEFAULT_WEIGHT,
      });

      setPresetDraft({
        ...st.presetDraft,
        categories: next.sortedCategories,
        weights: next.weights,
      });
    });

    row.appendChild(left);
    row.appendChild(inp);
    box.appendChild(row);
  }
}

export async function initPresetDropdowns() {
  const msMedia = document.getElementById("ms-media");
  const msCollection = document.getElementById("ms-collection");
  if (!msMedia || !msCollection) return;

  const meta = await fetchMeta();
  const s = getState();

  __msMediaRoot = msMedia;
  __msCollectionRoot = msCollection;
  __metaCache = meta;

  // media
  buildMultiSelect(
    msMedia,
    meta.media_types || [],
    () => getState().presetDraft.media || [],
    (arr) => {
      setPresetDraft({ ...getState().presetDraft, media: arr });
      syncHidden("preset-media", arr);
    }
  );

  // collections -> + weights
  buildMultiSelect(
    msCollection,
    meta.collections || [],
    () => getState().presetDraft.categories || [],
    (arr) => {
      renderWeights(arr);
    },
    (arr) => {
      /* onChange тоже через renderWeights */
    }
  );

  // начальный синк hidden + веса
  syncHidden("preset-media", s.presetDraft.media || []);
  syncHidden("preset-category", s.presetDraft.categories || []);
  renderWeights(s.presetDraft.categories || []);
}

export function buildSingleSelect(msRoot, options, getValue, setValue) {
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
    }
  );
}

// ----- Editor sync API for catalog -----
let __msMediaRoot = null;
let __msCollectionRoot = null;
let __metaCache = { media_types: [], collections: [] };

// маленькие локальные хелперы (используем те, что уже есть в файле)
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
  const set = new Set(selected);
  list.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
    const label = cb.closest(".ms-opt");
    const text = label?.querySelector("span")?.textContent ?? "";
    cb.checked = set.has(text);
  });
}

export function syncPresetEditorFromState() {
  const s = getState();
  const draft = s.presetDraft || {
    name: "",
    media: [],
    categories: [],
    weights: {},
  };

  // name
  const nameEl = document.getElementById("preset-name");
  if (nameEl) nameEl.value = draft.name || "";

  // hidden
  syncHidden("preset-media", draft.media || []);
  syncHidden("preset-category", draft.categories || []);

  // обновить UI dropdown лейблы/checkboxes
  if (__msMediaRoot) __applyMultiSelectUI(__msMediaRoot, draft.media || []);
  if (__msCollectionRoot)
    __applyMultiSelectUI(__msCollectionRoot, draft.categories || []);

  // веса
  renderWeights(draft.categories || []);
}
