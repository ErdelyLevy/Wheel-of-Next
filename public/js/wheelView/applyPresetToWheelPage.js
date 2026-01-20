import { showToast } from "../shared/showToast.js";
import { setRightListAllItems } from "../shared/state.js";
import { renderRightList } from "./rightPanel/initRightListSearch.js";
import { apiGetItemsByPreset, apiRandomBegin } from "../shared/api.js";
import { applyWheelSnapshot } from "./center/applyWheelSnapshot.js";
import { openResult } from "./leftPanel/openResult.js";

export async function applyPresetToWheelPage(presetId) {
  if (!presetId) return;

  // ✅ запрет во время вращения
  const canvas = document.getElementById("wheel");
  if (canvas?.__spinning) {
    showToast?.("Подожди окончания вращения", 1200);
    return;
  }

  // сброс поиска при смене пресета (дешево — можно сразу)
  const searchInput = document.getElementById("search-input");
  if (searchInput) searchInput.value = "";

  // 1) Стартуем запросы ПАРАЛЛЕЛЬНО

  const pItems = apiGetItemsByPreset(presetId);
  const pBegin = apiRandomBegin(presetId);

  // 2) Ждем ROLL раньше или одновременно — чтобы быстро показать wheel/result
  let snap;
  try {
    snap = await pBegin;
  } catch (e) {
    console.error("roll failed", e);
    snap = null;
  }

  if (snap?.wheel_items?.length) {
    // ⚡ колесо/результат — ПЕРВЫМИ
    applyWheelSnapshot({
      wheelItems: structuredClone(snap.wheel_items),
      winnerId: snap.winner_id ?? null,
      winnerItem: snap.winner_item ?? null,
      snapshotId: snap.snapshot_id ?? null,
      baseHistoryId: null,
    });

    // важно: первый кадр колеса — сразу
    window.requestWheelRedraw?.();
  }

  // 3) Теперь items (если еще грузятся — дождемся)
  let items = [];
  try {
    items = await pItems;
  } catch (e) {
    console.error("items failed", e);
    items = [];
  }

  // иммутабельная копия для правого списка
  const listItems = structuredClone(items);
  setRightListAllItems(listItems);

  // 4) Правый список + openResult — ЛЕНИВО (после первого кадра)
  const defer = (fn) => {
    if (window.requestIdleCallback) {
      requestIdleCallback(fn, { timeout: 1500 });
    } else {
      setTimeout(fn, 0);
    }
  };

  defer(() => {
    renderRightList(listItems);

    // если roll не дал winner_item — показываем первый элемент
    // (но не раньше, чем нарисовали колесо/результат)
    if (!snap?.winner_item && listItems[0]) {
      openResult(listItems[0]);
    }
  });
}
