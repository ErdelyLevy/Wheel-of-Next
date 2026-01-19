import { $, getState, setState } from "../../shared/state.js";

export function initRightPanels() {
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

export function setActiveTabs(container, predicate) {
  if (!container) return;
  [...container.querySelectorAll(".tab")].forEach((b) =>
    b.classList.toggle("active", predicate(b)),
  );
}

function setRightPanel(rightPanel) {
  setState({ rightPanel });
  localStorage.setItem("won:rightPanel", rightPanel);
}
