// public/js/virtualCollectionsUi.js
import { buildSingleSelect, fetchMeta } from "./presetsUi.js";

function escapeHtml(s) {
  return String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      }[c])
  );
}

function uid(prefix = "vcms") {
  return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now()}`;
}

/**
 * Инициализация UI виртуальных коллекций.
 * Опционально можно передать initial массив [{name, media, poster}]
 */
export async function initVirtualCollectionsUI({ initial = null } = {}) {
  const listEl = document.getElementById("vc-list");
  const addBtn = document.getElementById("vc-add");
  if (!listEl || !addBtn) return;

  let __vcMeta = null;

  async function initMediaSelect(row) {
    const msRoot = row.querySelector(".vc-ms");
    const hidden = row.querySelector(".vc-media");
    if (!msRoot || !hidden) return;

    const meta = await fetchMeta(); // твой fetchMeta из presetsUi.js

    buildSingleSelect(
      msRoot,
      meta.media_types || [],
      () => hidden.value,
      (v) => {
        hidden.value = String(v || "");
      }
    );
  }

  function makeRow(data = {}) {
    const row = document.createElement("div");
    row.className = "vc-row";

    const msId = uid();

    row.innerHTML = `
      <div class="form-row">
        <input
          class="vc-name"
          type="text"
          placeholder="Название (напр. Marvel Comics)"
          value="${escapeHtml(data.name || "")}"
          aria-label="Название"
        />
      </div>

      <div class="form-row">
        <div class="ms vc-ms" id="${msId}">
          <button class="ms-btn" type="button" aria-haspopup="listbox" aria-expanded="false">
            <span class="ms-text" data-placeholder="Выбрать…">Выбрать…</span>
            <span class="ms-caret">▾</span>
          </button>

          <div class="ms-pop is-hidden">
            <div class="ms-search">
              <input type="search" class="ms-search-input" placeholder="Поиск…" />
              <button class="tab ms-clear" type="button" title="Очистить">×</button>
            </div>
            <div class="ms-list" role="listbox"></div>
          </div>

          <input type="hidden" class="vc-media" value="${escapeHtml(
            (data.media || "").trim()
          )}" />
        </div>
      </div>

      <div class="form-row">
        <input
          class="vc-poster"
          type="text"
          placeholder="Постер (https://…)"
          value="${escapeHtml(data.poster || "")}"
          aria-label="Постер"
        />
      </div>

      <button class="tab vc-del" type="button" title="Удалить" aria-label="Удалить">×</button>
    `;

    initMediaSelect(row);
    return row;
  }

  function addRow(data = {}) {
    listEl.appendChild(makeRow(data));
  }

  // add
  addBtn.addEventListener("click", () => addRow());

  // delete (делегирование)
  listEl.addEventListener("click", (e) => {
    const btn = e.target?.closest?.(".vc-del");
    if (!btn) return;
    const row = btn.closest(".vc-row");
    if (row) row.remove();
  });

  // initial render
  if (Array.isArray(initial)) {
    listEl.innerHTML = "";
    initial.forEach((x) => addRow(x));
  }

  // удобные хелперы (можно убрать позже)
  window.__vcGet = () => getVirtualCollectionsFromUI(listEl);
  window.__vcSet = (arr) => {
    listEl.innerHTML = "";
    (Array.isArray(arr) ? arr : []).forEach((x) => addRow(x));
  };
}

/**
 * Сбор данных из UI
 */
function getVirtualCollectionsFromUI(
  rootEl = document.getElementById("vc-list")
) {
  const root = rootEl;
  if (!root) return [];

  return [...root.querySelectorAll(".vc-row")]
    .map((row) => {
      const name = String(row.querySelector(".vc-name")?.value || "").trim();
      const media = String(row.querySelector(".vc-media")?.value || "").trim();
      const poster = String(
        row.querySelector(".vc-poster")?.value || ""
      ).trim();

      if (!name && !media && !poster) return null;
      return { name, media, poster };
    })
    .filter(Boolean);
}
