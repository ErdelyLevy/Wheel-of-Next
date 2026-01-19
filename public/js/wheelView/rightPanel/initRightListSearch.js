import {
  getRightListAllItems,
  setRightListAllItems,
} from "../../shared/state.js";
import { bindLazyPoster } from "../../shared/posters/bindLazyPoster.js";

export function initRightListSearch() {
  const input = document.getElementById("search-input");
  if (!input) return;

  input.addEventListener("input", () => {
    const term = input.value.trim().toLowerCase();
    const base = getRightListAllItems();

    if (!term) {
      renderRightList(base);
      return;
    }

    const filtered = base.filter((it) =>
      String(it?.title || "")
        .toLowerCase()
        .includes(term),
    );
    renderRightList(filtered);
  });
}

export function renderRightList(items) {
  const ul = document.getElementById("full-list");
  if (!ul) return;

  const arr = Array.isArray(items) ? items : [];
  setRightListAllItems(arr);

  ul.innerHTML = "";

  if (!arr.length) {
    const li = document.createElement("li");
    li.className = "muted";
    li.textContent = "Список пуст";
    ul.appendChild(li);
    return;
  }

  const CHUNK = 40; // 30–60 обычно ок
  let i = 0;

  function step() {
    const frag = document.createDocumentFragment();
    const end = Math.min(arr.length, i + CHUNK);

    for (; i < end; i++) {
      frag.appendChild(makeRightListRow(arr[i]));
    }

    ul.appendChild(frag);

    if (i < arr.length) {
      requestAnimationFrame(step);
    }
  }

  requestAnimationFrame(step);
}

function makeRightListRow(it) {
  const li = document.createElement("li");
  li.className = "history-item";

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "history-btn";
  btn.dataset.id = String(it.id || "");

  const img = document.createElement("img");
  img.className = "history-poster";
  img.alt = it?.title ? `Poster: ${it.title}` : "Poster";
  img.decoding = "async";
  img.loading = "lazy"; // можно оставить, но IO важнее

  bindLazyPoster(img, it);

  const text = document.createElement("div");
  text.className = "history-text";

  const title = document.createElement("div");
  title.className = "history-title";
  title.textContent = it?.title || "(без названия)";

  const meta = document.createElement("div");
  meta.className = "history-meta";
  meta.textContent = [it?.media_type, it?.category_name]
    .filter(Boolean)
    .join(" • ");

  text.appendChild(title);
  text.appendChild(meta);

  btn.appendChild(img);
  btn.appendChild(text);

  li.appendChild(btn);
  return li;
}
