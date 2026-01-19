import { apiGetPresets } from "../../shared/api.js";

const LS_ACTIVE_PRESET = "won:activePresetId";

function setActivePresetId(id) {
  localStorage.setItem(LS_ACTIVE_PRESET, String(id || ""));
}

export async function refreshPresetTabsFromDB({ selectId } = {}) {
  const root = document.getElementById("preset-tabs");
  if (!root) return;

  const presets = await apiGetPresets();
  root.innerHTML = "";

  if (!presets.length) {
    const b = document.createElement("button");
    b.className = "tab active";
    b.type = "button";
    b.textContent = "Нет пресетов";
    b.disabled = true;
    root.appendChild(b);
    return;
  }

  let activeId = selectId || getActivePresetId();
  if (!activeId || !presets.some((p) => String(p.id) === String(activeId))) {
    activeId = String(presets[0].id);
  }
  setActivePresetId(activeId);

  for (const p of presets) {
    const id = String(p.id);
    const btn = document.createElement("button");
    btn.className = "tab";
    btn.type = "button";
    btn.dataset.presetId = id;
    btn.textContent = p.name || "Без названия";
    btn.classList.toggle("active", id === activeId);
    root.appendChild(btn);
  }
}

export function initPresetTabsClicksFromDB(onPresetChange) {
  const root = document.getElementById("preset-tabs");
  if (!root) return;

  root.addEventListener("click", async (e) => {
    const btn = e.target.closest(".tab");
    if (!btn || !btn.dataset.presetId) return;

    const id = String(btn.dataset.presetId);
    setActivePresetId(id);

    [...root.querySelectorAll(".tab")].forEach((b) =>
      b.classList.toggle("active", String(b.dataset.presetId) === id),
    );

    if (typeof onPresetChange === "function") {
      await onPresetChange(id);
    }
  });
}

export function getActivePresetId() {
  return localStorage.getItem(LS_ACTIVE_PRESET) || "";
}
