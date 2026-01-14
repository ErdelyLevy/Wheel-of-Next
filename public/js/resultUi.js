// js/resultUi.js
import { subscribe, getState } from "./state.js";

function $(id) {
  return document.getElementById(id);
}

function setText(el, v) {
  if (!el) return;
  el.textContent = v == null || v === "" ? "—" : String(v);
}

function setImg(img, url, alt) {
  if (!img) return;
  const u = String(url || "").trim();
  img.alt = alt || "";
  if (!u) {
    img.removeAttribute("src");
    img.style.opacity = "0";
    return;
  }
  img.style.opacity = "1";
  img.src = u;
}

function clear(el) {
  if (!el) return;
  el.innerHTML = "";
}

function addInfoRow(box, label, value) {
  if (!box) return;
  if (value == null || value === "") return;

  const row = document.createElement("div");
  row.className = "info-row";

  const k = document.createElement("span");
  k.className = "info-k";
  k.textContent = label;

  const v = document.createElement("span");
  v.className = "info-v";
  v.textContent = String(value);

  row.appendChild(k);
  row.appendChild(v);
  box.appendChild(row);
}

function addActionLink(box, label, href) {
  if (!box) return;
  const u = String(href || "").trim();
  if (!u) return;

  const a = document.createElement("a");
  a.className = "tab";
  a.href = u;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  a.textContent = label;

  box.appendChild(a);
}

function render(item) {
  const titleEl = $("result-title");
  const imgEl = $("result-cover");
  const badgeEl = $("result-badge");
  const infoEl = $("result-info");
  const actionsEl = $("result-actions");

  if (!item) {
    setText(titleEl, "—");
    setImg(imgEl, "", "");
    setText(badgeEl, "—");
    clear(infoEl);
    clear(actionsEl);
    return;
  }

  // title + poster
  setText(titleEl, item.title || item.name || "—");
  setImg(imgEl, item.poster || item.image || "", item.title || "");

  // badge: можно поменять формат как хочешь
  const badge = item.media_type
    ? String(item.media_type)
    : item.category_name
    ? String(item.category_name)
    : "—";
  setText(badgeEl, badge);

  // info
  clear(infoEl);
  addInfoRow(infoEl, "Коллекция", item.category_name || item.category || "");
  addInfoRow(infoEl, "Год", item.publish_year || item.year || "");
  addInfoRow(infoEl, "Платформа", item.platform || "");
  addInfoRow(infoEl, "Рейтинг", item.provider_rating || "");
  addInfoRow(infoEl, "Статус", item.production_status || "");
  addInfoRow(infoEl, "Описание", item.description || "");

  // actions
  clear(actionsEl);

  // 1) Ryot: открываем карточку в Ryot по meta_id (или id как запасной вариант)
  const ryotId = item.meta_id || item.id || "";
  if (ryotId) {
    const url = `http://erdely.ru/media/item/${encodeURIComponent(ryotId)}`;
    addActionLink(actionsEl, "Ryot", url);
  }

  // 2) SOURCE кнопка -> source_url (заголовок в upper case)
  if (item.source && item.source_url) {
    addActionLink(actionsEl, String(item.source).toUpperCase(), item.source_url);
  } else if (item.source_url) {
    addActionLink(actionsEl, "SOURCE", item.source_url);
  }
}

export function initResultUI() {
  // первичный рендер
  render(getState().result?.item || null);

  // обновление по state
  let lastId = null;
  subscribe((s) => {
    const it = s.result?.item || null;
    const nextId = it
      ? String(it.id ?? it.meta_id ?? it.title ?? "")
      : "__none__";
    if (nextId === lastId) return;
    lastId = nextId;
    render(it);
  });
}
