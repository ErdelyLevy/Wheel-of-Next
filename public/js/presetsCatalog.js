// js/presetsCatalog.js
import { subscribe, getState, setState, setPresetDraft } from "./state.js";
import { syncPresetEditorFromState } from "./presetsUi.js";
import { apiSavePreset, apiDeletePreset } from "./api.js";
import { refreshPresetTabsFromDB } from "./main.js"; // если в одном модуле — адаптируй импорт

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

    const id = String(btn.dataset.presetId || "");
    if (!id) return;

    const s = getState();
    const presets = Array.isArray(s.presets) ? s.presets : [];
    const preset = presets.find((x) => String(x.id) === id);
    if (!preset) return;

    // нормализуем форму под редактор (у тебя редактор ожидает media/categories)
    applyPresetToEditor({
      id: String(preset.id),
      name: preset.name,
      media: preset.media_types ?? preset.media ?? [],
      categories: preset.collections ?? preset.categories ?? [],
      weights: preset.weights ?? {},
    });
  });
}

async function fetchPresets() {
  const r = await fetch("/api/presets", { cache: "no-store" });
  const j = await r.json();
  if (!r.ok || j?.ok === false)
    throw new Error(j?.error || "presets fetch failed");
  return j.presets || [];
}

async function upsertPreset(payload) {
  const r = await fetch("/api/presets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const j = await r.json();
  if (!r.ok || j?.ok === false)
    throw new Error(j?.error || "preset save failed");
  return j.preset || j; // на случай разного формата
}

async function deletePreset(id) {
  const r = await fetch(`/api/presets/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  const j = await r.json().catch(() => ({ ok: true }));
  if (!r.ok || j?.ok === false)
    throw new Error(j?.error || "preset delete failed");
  return true;
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
      // если редактируем существующий — шлём id, иначе null
      id: s.activePresetId || null,
      name,
      media_types: d.media || [],
      collections: d.categories || [],
      weights: d.weights || {},
    };

    try {
      addBtn.disabled = true;

      const saved = await upsertPreset(payload);

      // обновляем activePresetId в state
      setState({ activePresetId: saved.id });

      // перерисуем каталог из БД
      const presets = await fetchPresets();

      // проще: добавь renderCatalogFrom(presets) или сохрани presets в state.
      // Я делаю минимально: сохраняю в state и вызываю renderCatalog()
      setState({ presets }); // ✅ добавим presets в wonState (если ещё нет — просто появится)
      renderCatalog(presets);

      // применяем сохранённый пресет в редактор (чтобы поля стали консистентны)
      applyPresetToEditor({
        id: String(saved.id),
        name: saved.name,
        media: saved.media_types ?? saved.media ?? [],
        categories: saved.collections ?? saved.categories ?? [],
        weights: saved.weights ?? {},
      });

      // обновить вкладки режимов на странице колеса
      // если у тебя есть функция refreshPresetTabsFromDB — вызывай её
      if (typeof window.refreshPresetTabsFromDB === "function") {
        await window.refreshPresetTabsFromDB({ selectId: saved.id });
      }
    } catch (e) {
      console.error(e);
      alert(`Ошибка сохранения пресета: ${e.message || e}`);
    } finally {
      addBtn.disabled = false;
    }
  });

  delBtn?.addEventListener("click", async () => {
    const s = getState();
    if (!s.activePresetId) return;

    try {
      delBtn.disabled = true;

      await deletePreset(s.activePresetId);

      setState({ activePresetId: null });

      const presets = await fetchPresets();
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
      console.error(e);
      alert(`Ошибка удаления пресета: ${e.message || e}`);
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

export async function initPresetCatalog() {
  // 1) загрузить пресеты из БД и положить в state
  try {
    const presets = await fetchPresets(); // это твой helper из предыдущего шага (GET /api/presets)
    setState({ presets });
  } catch (e) {
    console.error("[presets] fetch failed:", e);
    setState({ presets: [] });
  }

  // 2) первый рендер каталога + валидации
  renderCatalog(getState().presets);
  applyPresetValidationUI();
  initCatalogClick();
  initUpsertDelete();
  initNameBinding();

  // 3) авто-выбор первого пресета при старте
  const s = getState();
  const list = Array.isArray(s.presets) ? s.presets : [];
  if (!s.activePresetId && list[0]) {
    applyPresetToEditor({
      id: String(list[0].id),
      name: list[0].name,
      media: list[0].media_types ?? list[0].media ?? [],
      categories: list[0].collections ?? list[0].categories ?? [],
      weights: list[0].weights ?? {},
    });
    setState({ activePresetId: String(list[0].id) });
  }

  // 4) подписка на state: только UI валидации (каталог не перерисовываем на каждое изменение)
  subscribe(() => applyPresetValidationUI());
}
