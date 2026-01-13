// js/ui.js
import { getState, setView, setRightPanel, setSpin } from "./state.js";

function $(id) {
  return document.getElementById(id);
}

function setActiveTabs(container, predicate) {
  if (!container) return;
  [...container.querySelectorAll(".tab")].forEach((b) =>
    b.classList.toggle("active", predicate(b))
  );
}

function applyView() {
  const s = getState();
  const topTabs = $("top-tabs");
  const viewWheel = $("view-wheel");
  const viewSettings = $("view-settings");

  if (!topTabs || !viewWheel || !viewSettings) return;

  const isWheel = s.view === "wheel";
  viewWheel.classList.toggle("is-hidden", !isWheel);
  viewSettings.classList.toggle("is-hidden", isWheel);
  setActiveTabs(topTabs, (b) => b.dataset.view === s.view);
}

function initTopTabs() {
  const topTabs = $("top-tabs");
  if (!topTabs) return;

  topTabs.addEventListener("click", (e) => {
    const btn = e.target.closest(".tab");
    if (!btn) return;
    setView(btn.dataset.view);
    applyView();
  });

  applyView();
}

function applyRightPanel() {
  const s = getState();
  const rightTabs = $("right-tabs");
  const rightTitle = $("right-title");

  const panelList = $("panel-list");
  const panelHistory = $("panel-history");

  if (panelList)
    panelList.classList.toggle("is-hidden", s.rightPanel !== "list");
  if (panelHistory)
    panelHistory.classList.toggle("is-hidden", s.rightPanel !== "history");

  if (rightTitle)
    rightTitle.textContent = s.rightPanel === "list" ? "Список" : "История";
  setActiveTabs(rightTabs, (b) => b.dataset.panel === s.rightPanel);
}

function initRightPanels() {
  const rightTabs = $("right-tabs");
  if (!rightTabs) return;

  rightTabs.addEventListener("click", (e) => {
    const btn = e.target.closest(".tab");
    if (!btn) return;
    setRightPanel(btn.dataset.panel);
    applyRightPanel();
  });

  applyRightPanel();
}

function initSettingsSliders() {
  const duration = $("spin-duration");
  const durationVal = $("spin-duration-val");
  const speed = $("spin-speed");
  const speedVal = $("spin-speed-val");
  const saveBtn = $("save-spin-settings");
  const hint = $("spin-save-hint");

  if (!duration || !durationVal || !speed || !speedVal) return;

  // применяем state -> DOM
  const s = getState();
  duration.value = String(s.spin.duration);
  speed.value = String(s.spin.speed);

  function syncLabels() {
    durationVal.textContent = String(duration.value);
    speedVal.textContent = Number(speed.value).toFixed(1);
  }

  duration.addEventListener("input", () => {
    syncLabels();
  });

  speed.addEventListener("input", () => {
    syncLabels();
  });

  let hintTimer = 0;
  saveBtn?.addEventListener("click", () => {
    setSpin({
      duration: Number(duration.value),
      speed: Number(speed.value),
    });

    if (hint) {
      hint.textContent = "Сохранено";
      hint.classList.add("is-on");
      clearTimeout(hintTimer);
      hintTimer = setTimeout(() => hint.classList.remove("is-on"), 1400);
    }
  });

  syncLabels();
}

// entry
initTopTabs();
initRightPanels();
initSettingsSliders();
