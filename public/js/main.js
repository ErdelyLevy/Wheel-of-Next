import { initPresetCatalog } from "./settingsView/initPresetCatalog.js";
import { initPresetDropdowns } from "./settingsView/initPresetDropdowns.js";
import { initVirtualCollectionsUI } from "./settingsView/initVirtualCollectionsUI.js";
import { setState, syncSpinInputsFromState } from "./shared/state.js";
import { initResultUI } from "./wheelView/leftPanel/initResultUI.js";
import { initHistoryUI } from "./wheelView/rightPanel/initHistoryUI.js";
import { applyPresetToWheelPage } from "./wheelView/applyPresetToWheelPage.js";
import {
  initMobileSidebarsCollapsible,
  syncHeaderHeightVar,
} from "./initMobileSidebarsCollapsible.js";
import {
  getActivePresetId,
  initPresetTabsClicksFromDB,
  refreshPresetTabsFromDB,
} from "./wheelView/center/tabs.js";
import { initRightListClicks } from "./wheelView/rightPanel/initRightListClicks.js";
import { initRightListSearch } from "./wheelView/rightPanel/initRightListSearch.js";
import {
  initRollButton,
  initWheelRefreshButton,
  initSoundToggleButton,
} from "./wheelView/center/roll.js";
import { initWheelCanvas } from "./wheelView/center/initWheelCanvas.js";
import { initSettingsSliders } from "./settingsView/initSettingsSliders.js";
import { initTopTabs } from "./initTopTabs.js";
import { initRightPanels } from "./wheelView/rightPanel/initRightPanels.js";
import { initAuthButton } from "./initAuthButton.js";

async function boot() {
  initTopTabs();
  initAuthButton();
  initRightPanels();
  initSettingsSliders();
  syncHeaderHeightVar();
  initMobileSidebarsCollapsible();

  await initPresetDropdowns();
  await initPresetCatalog();

  initVirtualCollectionsUI();
  initRightListClicks();
  initRightListSearch();
  initHistoryUI();
  initResultUI();
  initRollButton();
  initWheelRefreshButton();
  initSoundToggleButton();
  initWheelCanvas();

  await refreshPresetTabsFromDB();

  initPresetTabsClicksFromDB(async (presetId) => {
    try {
      await applyPresetToWheelPage(presetId);
    } catch (e) {
      alert(e.message || e);
    }
  });

  const active = getActivePresetId();
  if (active) {
    await applyPresetToWheelPage(active);
  }
  const spin = {
    duration: Number(localStorage.getItem("won:spinDuration")) || 20,
    speed: Number(localStorage.getItem("won:spinSpeed")) || 1,
  };

  setState({ spin });
  requestAnimationFrame(syncSpinInputsFromState);
}
boot().catch((e) => alert(e.message || e));

window.addEventListener("resize", () =>
  requestAnimationFrame(syncHeaderHeightVar),
);

window.refreshPresetTabsFromDB = refreshPresetTabsFromDB;
