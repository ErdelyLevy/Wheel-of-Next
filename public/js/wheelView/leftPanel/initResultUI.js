import { getFallbackPosterSrc } from "../../shared/posters/getFallbackPosterSrc.js";
import { getPosterSrc } from "../../shared/posters/getPosterSrc.js";
import { getState, subscribe, $ } from "../../shared/state.js";

const __log = () => {};

let __renderRetry = 0;
const __maxRenderRetries = 90; // ~1.5с при rAF, можно поднять при необходимости

export function initResultUI() {
  __log("initResultUI() ENTER");

  // первичный рендер (может случиться до готовности DOM)
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

function normalizeValue(value) {
  if (value == null) return "";

  if (Array.isArray(value)) {
    return value.filter(Boolean).join(", ");
  }

  return String(value).trim();
}

function addInfoRow(box, label, value) {
  if (!box) return;

  const v = normalizeValue(value);
  if (!v) return;

  const row = document.createElement("div");
  row.className = "info-row";

  const k = document.createElement("span");
  k.className = "info-k";
  k.textContent = label;

  const val = document.createElement("span");
  val.className = "info-v";
  val.textContent = v;

  row.appendChild(k);
  row.appendChild(val);
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

function scheduleRenderRetry(reason) {
  if (__renderRetry >= __maxRenderRetries) {
    __log("render retry limit reached -> stop retrying", {
      retries: __renderRetry,
      reason,
    });
    return;
  }
  __renderRetry += 1;
  __log("schedule render retry", { retry: __renderRetry, reason });
  requestAnimationFrame(() => render(getState().result?.item || null));
}

function render(item) {
  const titleEl = $("result-title");
  const imgEl = $("result-cover");
  const badgeEl = $("result-badge");
  const infoEl = $("result-info");
  const actionsEl = $("result-actions");

  // ключевая правка: если DOM результата ещё не готов — ретраим
  if (!titleEl && !imgEl && !badgeEl && !infoEl && !actionsEl) {
    scheduleRenderRetry("result DOM not ready");
    return;
  }

  // как только DOM появился — ретраи больше не нужны
  __renderRetry = __maxRenderRetries;

  if (!item) {
    setText(titleEl, "—");
    setImg(imgEl, "", "");
    setText(badgeEl, "—");
    clear(infoEl);
    clear(actionsEl);
    return;
  }

  // title
  const title = item.title || item.name || "—";
  setText(titleEl, title);

  const fallback = getFallbackPosterSrc(item);
  const src = getPosterSrc(item, { w: 768, fmt: "webp" });

  // сначала ставим fallback — сразу красиво
  setImg(imgEl, fallback, title);

  if (imgEl) {
    imgEl.onerror = () => setImg(imgEl, fallback, title);
    imgEl.src = src;
    imgEl.style.opacity = "1";
  }

  // badge: media_type приоритетнее
  const badge = item.media_type
    ? String(item.media_type)
    : item.category_name
      ? String(item.category_name)
      : "—";
  setText(badgeEl, badge);

  // сброс старых классов типов
  badgeEl?.classList?.remove(
    "badge--movie",
    "badge--anime",
    "badge--show",
    "badge--video_game",
    "badge--book",
  );

  // добавим новый
  const mt = String(item.media_type || "")
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "");
  if (mt) badgeEl?.classList?.add(`badge--${mt}`);

  clear(infoEl);

  // базовые
  addInfoRow(infoEl, "Коллекция", normalizeValue(item.category_name));
  addInfoRow(infoEl, "Год", normalizeValue(item.publish_year));
  addInfoRow(infoEl, "Статус", normalizeValue(item.production_status));
  addInfoRow(infoEl, "Платформы", normalizeValue(item.platforms));
  addInfoRow(infoEl, "Сезонов", normalizeValue(item.total_seasons));
  addInfoRow(
    infoEl,
    "Эпизодов",
    normalizeValue(item.total_episodes || item.anime_episodes),
  );
  addInfoRow(infoEl, "Страницы", normalizeValue(item.pages));
  addInfoRow(infoEl, "Описание", normalizeValue(item.description));

  // actions
  clear(actionsEl);

  // ===== VC =====
  if (item.__kind === "vc") {
    if (item.source_url) {
      addActionLink(
        actionsEl,
        item.source_label ? String(item.source_label).toUpperCase() : "SOURCE",
        item.source_url,
      );
    }
    return;
  }

  // Ryot
  const ryotId = item.meta_id || item.id || "";
  if (ryotId) {
    const url = `${window.location.origin}/media/item/${encodeURIComponent(ryotId)}`;
    addActionLink(actionsEl, "Ryot", url);
  }

  // source_url
  if (item.source_url) {
    addActionLink(
      actionsEl,
      item.source ? String(item.source).toUpperCase() : "SOURCE",
      item.source_url,
    );
  }
}
