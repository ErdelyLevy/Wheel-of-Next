// js/actions.js
import { getState, setState } from "./state.js";

/**
 * Открыть карточку слева (результат)
 */
export function openResult(item) {
  setState({
    result: { item: item || null },
  });
}

/**
 * Применить снимок колеса:
 * - wheelItems: массив элементов колеса в нужном порядке
 * - winnerId: (опционально) id победителя
 * - winnerItem: (опционально) объект победителя для карточки слева
 *
 * Если winnerId не передан, но есть winnerItem.id — используем его.
 * Если winnerItem не передан, но winnerId есть — result не трогаем.
 */
export function applyWheelSnapshot({ wheelItems, winnerId, winnerItem } = {}) {
  const s = getState();

  const computedWinnerId =
    winnerId ?? (winnerItem?.id != null ? winnerItem.id : null);

  setState({
    result: winnerItem ? { item: winnerItem } : s.result,
    wheel: {
      items: Array.isArray(wheelItems) ? wheelItems : [],
      winnerId: computedWinnerId,
      updatedAt: Date.now(),
    },
  });
}
