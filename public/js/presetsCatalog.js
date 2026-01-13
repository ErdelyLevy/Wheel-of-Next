// js/presetsCatalog.js
import { getState, setState, setPresetDraft } from "./state.js";
import { syncPresetEditorFromState } from "./presetsUi.js";

const LS_PRESETS = "won:presets";

function validateDraft(d) {
  const errors = [];

  const name = String(d?.name || "").trim();
  if (!name) errors.push("Укажи название пресета");

  const media = Array.isArray(d?.media) ? d.media : [];
  if (media.length < 1) errors.push("Выбери хотя бы 1 вид медиа");

  const cats = Array.isArray(d?.categories) ? d.categories : [];
  if (cats.length < 1) errors.push("Выбери хотя бы 1 коллекцию");

  const weights = d?.weights && typeof d.weights === "object" ? d.weights : {};
  for (const c of cats) {
    const v = Number(weights[c]);
    if (!Number.isFinite(v) || v < 0) {
      errors.push(`Вес для "${c}" должен быть ≥ 0`);
      break; // коротко, одной ошибкой
    }
  }

  return { ok: errors.length === 0, errors };
}

function setInvalid(el, on) {
  if (!el) return;
  el.classList.toggle("is-invalid", !!on);
}

function applyPresetValidationUI() {
  const hint = document.getElementById("preset-hint");
  const addBtn = document.getElementById("preset-add");

  const nameEl = document.getElementById("preset-name");
  const msMedia = document.getElementById("ms-media")?.querySelector(".ms-btn");
  const msCollection = document
    .getElementById("ms-collection")
    ?.querySelector(".ms-btn");

  const s = getState();
  const d = s.presetDraft;

  const v = validateDraft(d);

  // кнопка
  if (addBtn) addBtn.disabled = !v.ok;

  // подсказка
  if (hint) {
    if (v.ok) {
      hint.textContent = "";
      hint.classList.remove("is-bad");
    } else {
      hint.textContent = v.errors[0]; // коротко — первая ошибка
      hint.classList.add("is-bad");
    }
  }

  // подсветка полей (мягко)
  setInvalid(nameEl, !String(d?.name || "").trim());
  setInvalid(msMedia, !(Array.isArray(d?.media) && d.media.length));
  setInvalid(
    msCollection,
    !(Array.isArray(d?.categories) && d.categories.length)
  );

  return v;
}

function safeParse(v, fb) {
  try {
    return JSON.parse(v);
  } catch {
    return fb;
  }
}

function loadPresets() {
  const arr = safeParse(localStorage.getItem(LS_PRESETS), []);
  return Array.isArray(arr) ? arr : [];
}

function savePresets(presets) {
  localStorage.setItem(LS_PRESETS, JSON.stringify(presets));
}

function uid() {
  return "p_" + Math.random().toString(16).slice(2) + Date.now().toString(16);
}

function renderCatalog() {
  const ul = document.getElementById("preset-list");
  if (!ul) return;

  const s = getState();
  const presets = loadPresets();

  ul.innerHTML = "";

  if (!presets.length) {
    const li = document.createElement("li");
    li.className = "preset-item";
    const btn = document.createElement("button");
    btn.className = "preset-btn";
    btn.type = "button";
    btn.textContent = "Нет пресетов";
    btn.disabled = true;
    li.appendChild(btn);
    ul.appendChild(li);
    return;
  }

  for (const p of presets) {
    const li = document.createElement("li");
    li.className = "preset-item";

    const btn = document.createElement("button");
    btn.className =
      "preset-btn" + (p.id === s.activePresetId ? " is-active" : "");
    btn.type = "button";
    btn.dataset.presetId = p.id;
    btn.textContent = p.name || "(без названия)";

    li.appendChild(btn);
    ul.appendChild(li);
  }
}

function applyPresetToEditor(preset) {
  setState({ activePresetId: preset.id });
  setPresetDraft({
    name: preset.name || "",
    media: preset.media || [],
    categories: preset.categories || [],
    weights: preset.weights || {},
  });
  syncPresetEditorFromState();
  renderCatalog();
  applyPresetValidationUI();
}

function initCatalogClick() {
  const ul = document.getElementById("preset-list");
  if (!ul) return;

  ul.addEventListener("click", (e) => {
    const btn = e.target.closest(".preset-btn");
    if (!btn || btn.disabled) return;

    const id = btn.dataset.presetId;
    const presets = loadPresets();
    const preset = presets.find((x) => x.id === id);
    if (!preset) return;

    applyPresetToEditor(preset);
  });
}

function initUpsertDelete() {
  const addBtn = document.getElementById("preset-add");
  const delBtn = document.getElementById("preset-delete");

  addBtn?.addEventListener("click", () => {
    const verdict = applyPresetValidationUI();
    if (!verdict.ok) return;
    const s = getState();
    const d = s.presetDraft;

    // минимальная защита от пустого названия (без UI-валидации пока)
    const name = (d.name || "").trim() || "Новый пресет";

    const presets = loadPresets();
    const id = s.activePresetId || uid();

    const preset = {
      id,
      name,
      media: d.media || [],
      categories: d.categories || [],
      weights: d.weights || {},
    };

    const idx = presets.findIndex((x) => x.id === id);
    if (idx >= 0) presets[idx] = preset;
    else presets.unshift(preset);

    savePresets(presets);
    applyPresetToEditor(preset);
  });

  delBtn?.addEventListener("click", () => {
    const s = getState();
    if (!s.activePresetId) return;

    const presets = loadPresets().filter((x) => x.id !== s.activePresetId);
    savePresets(presets);

    // сброс active + каталог
    setState({ activePresetId: null });
    renderCatalog();

    // если остались пресеты — выберем первый
    if (presets[0]) applyPresetToEditor(presets[0]);
  });
}

function initNameBinding() {
  const nameEl = document.getElementById("preset-name");
  if (!nameEl) return;

  // name -> state
  nameEl.addEventListener("input", () => {
    const s = getState();
    setPresetDraft({ ...s.presetDraft, name: nameEl.value });
  });
  applyPresetValidationUI();
}

export function initPresetCatalog() {
  // если пусто — можно оставить пустым, но удобнее добавить дефолт:
  const presets = loadPresets();
  if (!presets.length) {
    const s = getState();
    const seed = {
      id: uid(),
      name: "Default",
      media: s.presetDraft.media || [],
      categories: s.presetDraft.categories || [],
      weights: s.presetDraft.weights || {},
    };
    savePresets([seed]);
  }

  renderCatalog();
  applyPresetValidationUI();
  initCatalogClick();
  initUpsertDelete();
  initNameBinding();

  // авто-выбор первого пресета при старте, если activePresetId ещё нет
  const s = getState();
  const list = loadPresets();
  if (!s.activePresetId && list[0]) {
    applyPresetToEditor(list[0]);
  }

  // подписка: при любом изменении state — обновляем валидацию
  subscribe(() => applyPresetValidationUI());
}
