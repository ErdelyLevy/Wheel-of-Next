import { getRightListById } from "../../shared/state.js";
import { openResult } from "../leftPanel/openResult.js";

export function initRightListClicks() {
  const ul = document.getElementById("full-list");
  if (!ul) return;

  ul.addEventListener("click", (e) => {
    const btn = e.target.closest(".history-btn");
    if (!btn) return;

    const id = String(btn.dataset.id || "");
    const it = getRightListById()?.get?.(id) || null;

    if (!it) return;
    openResult(it);
  });
}
