import { showToast } from "./shared/showToast.js";
import { getState, setView, $ } from "./shared/state.js";
import { setActiveTabs } from "./wheelView/rightPanel/initRightPanels.js";

let __applyRetry = 0;
const __maxRetries = 60; // ~ 1 сек при rAF, можно увеличить при необходимости

export function initTopTabs() {
  const topTabs = $("top-tabs");

  if (topTabs) {
    topTabs.addEventListener("click", (e) => {
      const btn = e.target.closest(".tab");
      if (!btn) return;
      setView(btn.dataset.view);
      applyView();
    });
  }

  applyView();
}

function isWheelSpinning() {
  const canvas = document.getElementById("wheel");
  return !!canvas?.__spinning;
}

function scheduleApplyRetry() {
  if (__applyRetry >= __maxRetries) {
    return;
  }
  __applyRetry += 1;
  requestAnimationFrame(() => applyView());
}

function applyView() {
  if (isWheelSpinning()) {
    showToast?.("Дождись окончания вращения", 1200);
    return;
  }

  const s = getState();

  const topTabs = $("top-tabs");
  const viewWheel = $("view-wheel");
  const viewSettings = $("view-settings");

  // ключевая правка: если view контейнеров еще нет — ретраим
  if (!viewWheel || !viewSettings) {
    scheduleApplyRetry("missing view DOM");
    return;
  }

  // раз контейнеры появились — больше ретраи не нужны
  __applyRetry = __maxRetries;

  const isWheel = s.view === "wheel";

  viewWheel.classList.toggle("is-hidden-visually", !isWheel);
  viewSettings.classList.toggle("is-hidden-visually", isWheel);

  if (topTabs) {
    try {
      setActiveTabs(topTabs, (b) => b.dataset.view === s.view);
    } catch {}
  }
}
