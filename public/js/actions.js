// js/actions.js — Модуль для рендеринга действий и результатов

import { SOURCE_LABELS, escapeHtml, svgPoster } from "./data.js";
import { dom } from "./dom.js";
import { getWeight } from "./state.js";
import { proxifyImageUrl } from "./img.js";

// Вспомогательная функция для создания строки информации
function row(label, value) {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value) && value.length === 0) return "";
  const s = Array.isArray(value) ? value.join(", ") : String(value).trim();
  if (!s) return "";
  return `
    <div class="row">
      <span class="tag">${escapeHtml(label)}</span>
      <span class="val">${escapeHtml(s)}</span>
    </div>
  `;
}

// Функция рендеринга действий (ссылок) для элемента
export function renderActions(item) {
  if (!dom.resultActionsEl) return;
  dom.resultActionsEl.innerHTML = "";

  const links = [
    { source: "portal", source_url: `http://erdely.ru/media/item/${item.meta_id}` },
    ...(item.sources || [])
  ];

  for (const s of links) {
    if (!s?.source_url) continue;

    const a = document.createElement("a");
    a.className = "action-btn";
    a.href = s.source_url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";

    const label = SOURCE_LABELS[s.source] ?? String(s.source || "link").toUpperCase();
    a.textContent = label;

    dom.resultActionsEl.appendChild(a);
  }
}

// Функция рендеринга результата выбора
export function renderResult(item) {
  if (dom.resultTitleEl) dom.resultTitleEl.textContent = item.title || "—";
  if (dom.resultCoverEl) {
    dom.resultCoverEl.src = proxifyImageUrl(item.poster) || svgPoster(item.title || "NO IMAGE");
    dom.resultCoverEl.onerror = () => (dom.resultCoverEl.src = svgPoster(item.title || "NO IMAGE"));
  }
  if (dom.resultBadgeEl) dom.resultBadgeEl.textContent = (item.media_type || "—").toUpperCase();

  const weight = getWeight(item);

  const html =
    row("Категория", item.category) +
    row("Вес", weight) +
    row("Год", item.year) +
    row("Жанры", item.genres) +
    row("Метки", item.tags) +
    (item.media_type === "game" ? row("Платформа", item.platform) : "") +
    row("Описание", item.description);

  if (dom.resultInfoEl) dom.resultInfoEl.innerHTML = html || "";

  renderActions(item);
}
