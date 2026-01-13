// js/main.js
import "./ui.js";
import { initPresetDropdowns } from "./presetsUi.js";
import { initPresetCatalog } from "./presetsCatalog.js";
import { initHistoryUI } from "./historyUi.js";
import { initResultUI } from "./resultUi.js";

async function boot() {
  // 1) dropdowns (зависят от /api/meta)
  await initPresetDropdowns();

  // 2) catalog + buttons + validation
  initPresetCatalog();
  initHistoryUI();
  initResultUI();
}

boot().catch((e) => console.error("[boot] failed:", e));
