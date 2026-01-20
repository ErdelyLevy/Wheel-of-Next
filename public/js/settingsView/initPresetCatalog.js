import {
  apiDeletePreset,
  apiGetPresets,
  apiUpsertPreset,
} from "../shared/api.js";
import {
  getState,
  setPresetDraft,
  setState,
  subscribe,
} from "../shared/state.js";
import { syncPresetEditorFromState } from "./initPresetDropdowns.js";
import { toast } from "../shared/showToast.js";

export async function initPresetCatalog() {
  // 1) загрузить пресеты из БД и положить в state
  try {
    const presets = await apiGetPresets();
    setState({ presets });
  } catch {
    setState({ presets: [] });
  }

  // 2) первый рендер каталога + валидации
  renderCatalog(getState().presets);
  applyPresetValidationUI();
  initCatalogClick();
  initUpsertDelete();
  initNameBinding();

  // ✅ по умолчанию — создаём новый (пустой) пресет
  startNewPresetDraft();

  // 3) авто-выбор первого пресета при старте
  const s = getState();
  const list = Array.isArray(s.presets) ? s.presets : [];
  if (s.activePresetId) {
    // если активный уже есть — подтянем его (по желанию, можно оставить как есть)
  } else if (list[0]) {
    // оставь как было
  }

  // 4) подписка на state: только UI валидации (каталог не перерисовываем на каждое изменение)
  subscribe(() => applyPresetValidationUI());
}

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
    !(Array.isArray(d?.categories) && d.categories.length),
  );

  return v;
}

function renderCatalog(presetsArg) {
  const ul = document.getElementById("preset-list");
  if (!ul) return;

  const s = getState();

  // Источник истины:
  // 1) явный аргумент
  // 2) state.presets
  const presets = Array.isArray(presetsArg)
    ? presetsArg
    : Array.isArray(s.presets)
      ? s.presets
      : [];

  ul.innerHTML = "";

  {
    const li = document.createElement("li");
    li.className = "preset-item";

    const btn = document.createElement("button");
    btn.className =
      "preset-btn is-create" + (!s.activePresetId ? " is-active" : "");

    btn.type = "button";
    btn.dataset.action = "preset-create";
    btn.textContent = "Создать…";

    li.appendChild(btn);
    ul.appendChild(li);
  }

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

    const id = String(p.id);

    const btn = document.createElement("button");
    btn.className =
      "preset-btn" + (String(s.activePresetId) === id ? " is-active" : "");
    btn.type = "button";
    btn.dataset.presetId = id;
    btn.textContent = p.name || "(без названия)";

    li.appendChild(btn);
    ul.appendChild(li);
  }
}

function applyPresetToEditor(preset) {
  const name =
    preset?.name ??
    preset?.preset_name ??
    preset?.presetName ??
    preset?.title ??
    "";

  const media = preset?.media ?? preset?.media_types ?? [];
  const categories = preset?.categories ?? preset?.collections ?? [];
  const weights = preset?.weights ?? {};

  // ✅ НОВОЕ: виртуальные коллекции (массив ID)
  const virtual_collection_ids =
    preset?.virtual_collection_ids ??
    preset?.virtualCollections ??
    preset?.virtual_collections ??
    preset?.vc_ids ??
    [];

  setState({ activePresetId: preset.id });

  setPresetDraft({
    name,
    media,
    categories,
    weights,
    virtual_collection_ids: Array.isArray(virtual_collection_ids)
      ? virtual_collection_ids
          .map((x) => String(x || "").trim())
          .filter(Boolean)
      : [],
  });


  // если у тебя есть синк скрытого поля под VC — раскомментируй
  // syncHidden("preset-virtual-collections", getState().presetDraft.virtual_collection_ids || []);

  syncPresetEditorFromState();
  renderCatalog();
  applyPresetValidationUI();
}

function startNewPresetDraft() {
  // важно: чтобы "Сохранить" создавало новый, а не перезаписывало
  setState({ activePresetId: null });

  setPresetDraft({
    name: "",
    media: [],
    categories: [],
    weights: {},
    virtual_collection_ids: [], // ✅ NEW
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

    // ✅ "Создать…"
    if (btn.dataset.action === "preset-create") {
      startNewPresetDraft();
      return;
    }

    const id = String(btn.dataset.presetId || "");
    if (!id) return;

    const s = getState();
    const presets = Array.isArray(s.presets) ? s.presets : [];
    const preset = presets.find((x) => String(x.id) === id);
    if (!preset) return;

    applyPresetToEditor({
      id: String(preset.id),
      name: preset.name ?? preset.preset_name ?? preset.title ?? "",
      media: preset.media_types ?? preset.media ?? [],
      categories: preset.collections ?? preset.categories ?? [],
      virtual_collection_ids: preset.virtual_collection_ids ?? [],
      weights: preset.weights ?? {},
    });
  });
}

function initUpsertDelete() {
  const addBtn = document.getElementById("preset-add");
  const delBtn = document.getElementById("preset-delete");

  addBtn?.addEventListener("click", async () => {
    const verdict = applyPresetValidationUI();
    if (!verdict.ok) return;

    const s = getState();
    const d = s.presetDraft;

    const name = (d.name || "").trim();
    const payload = {
      id: s.activePresetId || null,
      name,
      media_types: d.media || [],
      collections: d.categories || [],
      weights: d.weights || {},

      // ✅ ВАЖНО: новое поле
      virtual_collection_ids: d.virtual_collection_ids || [],
    };

    try {
      addBtn.disabled = true;

      const saved = await apiUpsertPreset(payload);

      // обновляем activePresetId в state
      setState({ activePresetId: saved.id });

      // перерисуем каталог из БД
      const presets = await apiGetPresets({ force: true });

      // проще: добавь renderCatalogFrom(presets) или сохрани presets в state.
      // Я делаю минимально: сохраняю в state и вызываю renderCatalog()
      setState({ presets });
      renderCatalog(presets);

      // применяем сохранённый пресет в редактор (чтобы поля стали консистентны)
      applyPresetToEditor({
        id: String(saved.id),
        name: saved.name,
        media: saved.media_types ?? saved.media ?? [],
        categories: saved.collections ?? saved.categories ?? [],
        virtual_collection_ids: saved.virtual_collection_ids ?? [],
        weights: saved.weights ?? {},
      });

      // обновить вкладки режимов на странице колеса
      if (typeof window.refreshPresetTabsFromDB === "function") {
        await window.refreshPresetTabsFromDB({ selectId: saved.id });
      }
    } catch (e) {
      if (e?.status === 401) {
        toast("Необходимо авторизоваться");
      } else {
        toast(`Ошибка сохранения пресета: ${e.message || e}`);
      }
    } finally {
      addBtn.disabled = false;
    }
  });

  delBtn?.addEventListener("click", async () => {
    const s = getState();
    if (!s.activePresetId) return;

    try {
      delBtn.disabled = true;

      await apiDeletePreset(s.activePresetId);

      setState({ activePresetId: null });

      const presets = await apiGetPresets({ force: true });
      setState({ presets });
      renderCatalog(presets);

      if (presets[0]) {
        // выберем первый оставшийся
        const p = presets[0];
        applyPresetToEditor({
          id: String(p.id),
          name: p.name,
          media: p.media_types ?? p.media ?? [],
          categories: p.collections ?? p.categories ?? [],
          virtual_collection_ids: p.virtual_collection_ids ?? [],
          weights: p.weights ?? {},
        });

        setState({ activePresetId: String(p.id) });
      }

      if (typeof window.refreshPresetTabsFromDB === "function") {
        await window.refreshPresetTabsFromDB({
          selectId: getState().activePresetId,
        });
      }
    } catch (e) {
      if (e?.status === 401) {
        toast("Необходимо авторизоваться");
      } else {
        toast(`Ошибка удаления пресета: ${e.message || e}`);
      }
    } finally {
      delBtn.disabled = false;
    }
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


