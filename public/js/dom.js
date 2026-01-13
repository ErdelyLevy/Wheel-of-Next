// js/dom.js — Модуль для работы с DOM элементами

import { svgPoster } from "./data.js";
import { setLazyImg } from "./img.js";

// Объект с ссылками на DOM элементы
export const dom = {
  fullListEl: null,
  resultTitleEl: null,
  resultCoverEl: null,
  resultBadgeEl: null,
  resultInfoEl: null,
  resultActionsEl: null,
  spinBtn: null,
  wheelCanvas: null,
  mediaTabs: null,
  platformTabs: null
};

function must(el, id) {
  if (!el) console.error(`[Wheel] Не найден элемент #${id}. Проверь index.html (id="${id}")`);
  return el;
}

export function initDom() {
  dom.fullListEl = must(document.getElementById("full-list"), "full-list");
  dom.resultTitleEl = must(document.getElementById("result-title"), "result-title");
  dom.resultCoverEl = must(document.getElementById("result-cover"), "result-cover");
  dom.resultBadgeEl = must(document.getElementById("result-badge"), "result-badge");
  dom.resultInfoEl = must(document.getElementById("result-info"), "result-info");
  dom.resultActionsEl = must(document.getElementById("result-actions"), "result-actions");

  dom.spinBtn = must(document.getElementById("spin-btn"), "spin-btn");
  dom.wheelCanvas = must(document.getElementById("wheel"), "wheel");

  dom.mediaTabs = must(document.getElementById("media-tabs"), "media-tabs");
  dom.platformTabs = must(document.getElementById("platform-tabs"), "platform-tabs");
}

export function renderFullList(items, onClickItem, selectedId) {
  if (!dom.fullListEl) return;
  dom.fullListEl.innerHTML = "";

  for (const item of items) {
    const li = document.createElement("li");
    li.className = "list-item";
    li.dataset.id = String(item.id);
    if (String(item.id) === String(selectedId)) li.classList.add("active");

    const img = document.createElement("img");
    img.alt = "";

    const placeholder = svgPoster(item.title || "NO IMAGE");
    setLazyImg(img, item.poster, placeholder);
    img.addEventListener("error", () => (img.src = placeholder));

    const span = document.createElement("span");
    span.textContent = item.title;

    li.appendChild(img);
    li.appendChild(span);
    li.addEventListener("click", () => onClickItem(item));

    dom.fullListEl.appendChild(li);
  }
}

export function setActiveInList(selectedId) {
  document.querySelectorAll(".list-item").forEach(el => {
    el.classList.toggle("active", el.dataset.id === String(selectedId));
  });
}