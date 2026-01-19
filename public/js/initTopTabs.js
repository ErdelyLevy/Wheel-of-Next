import { showToast } from "./shared/showToast.js";
import { getState, setView, $ } from "./shared/state.js";
import { setActiveTabs } from "./wheelView/rightPanel/applyRightPanel.js";

const __log = (...a) => console.log("[initTopTabs]", ...a);

let __applyRetry = 0;
const __maxRetries = 60; // ~ 1 сек при rAF, можно увеличить при необходимости

export function initTopTabs() {
  __log("initTopTabs() ENTER");
  const topTabs = $("top-tabs");
  __log("topTabs:", topTabs);

  if (topTabs) {
    topTabs.addEventListener("click", (e) => {
      const btn = e.target.closest(".tab");
      __log("click:", { target: e.target, btn, view: btn?.dataset?.view });
      if (!btn) return;
      setView(btn.dataset.view);
      __log("after setView, state.view =", getState()?.view);
      applyView();
    });
  } else {
    __log("NO #top-tabs -> continuing without tabs");
  }

  __log("calling applyView() on init");
  applyView();
}

function isWheelSpinning() {
  const canvas = document.getElementById("wheel");
  __log("isWheelSpinning:", { canvas, __spinning: canvas?.__spinning });
  return !!canvas?.__spinning;
}

function scheduleApplyRetry(reason) {
  if (__applyRetry >= __maxRetries) {
    __log("applyView retry limit reached -> stop retrying", {
      retries: __applyRetry,
      reason,
    });
    return;
  }
  __applyRetry += 1;
  __log("schedule applyView retry", { retry: __applyRetry, reason });
  requestAnimationFrame(() => applyView());
}

function applyView() {
  __log("applyView() ENTER");

  if (isWheelSpinning()) {
    __log("blocked: wheel is spinning -> toast + return");
    showToast?.("Дождись окончания вращения", 1200);
    return;
  }

  const s = getState();
  __log("state snapshot:", s);

  const topTabs = $("top-tabs");
  const viewWheel = $("view-wheel");
  const viewSettings = $("view-settings");

  __log("dom:", {
    topTabs,
    viewWheel,
    viewSettings,
    viewWheelClass: viewWheel?.className,
    viewSettingsClass: viewSettings?.className,
  });

  // ключевая правка: если view контейнеров еще нет — ретраим
  if (!viewWheel || !viewSettings) {
    __log("missing required dom -> retry", {
      hasWheel: !!viewWheel,
      hasSettings: !!viewSettings,
    });
    scheduleApplyRetry("missing view DOM");
    return;
  }

  // раз контейнеры появились — больше ретраи не нужны
  __applyRetry = __maxRetries;

  const isWheel = s.view === "wheel";
  __log("computed:", { view: s.view, isWheel });

  viewWheel.classList.toggle("is-hidden-visually", !isWheel);
  viewSettings.classList.toggle("is-hidden-visually", isWheel);

  __log("after toggle:", {
    viewWheelClass: viewWheel.className,
    viewSettingsClass: viewSettings.className,
  });

  if (topTabs) {
    try {
      setActiveTabs(topTabs, (b) => b.dataset.view === s.view);
      __log("setActiveTabs OK");
    } catch (e) {
      console.error("[initTopTabs] setActiveTabs FAILED:", e);
    }
  } else {
    __log("skip setActiveTabs: no topTabs");
  }
}
