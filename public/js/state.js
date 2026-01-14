// js/state.js
// Single source of truth for UI state (no frameworks)

function safeJsonParse(v, fallback) {
  try {
    return JSON.parse(v);
  } catch {
    return fallback;
  }
}

function loadSpinFromLS() {
  const duration = Number(localStorage.getItem("won:spinDuration"));
  const speed = Number(localStorage.getItem("won:spinSpeed"));
  return {
    duration: Number.isFinite(duration) ? duration : 20,
    speed: Number.isFinite(speed) ? speed : 1.0,
  };
}

const initial = {
  view: localStorage.getItem("won:view") || "wheel",
  rightPanel: localStorage.getItem("won:rightPanel") || "list",
  spin: loadSpinFromLS(),
  presetDraft: {
    name: "",
    media: safeJsonParse(localStorage.getItem("won:presetMedia"), []),
    categories: safeJsonParse(localStorage.getItem("won:presetCategories"), []),
    weights: safeJsonParse(localStorage.getItem("won:presetWeights"), {}),
  },
  activePresetId: null,
  result: {
    item: null, // текущая карточка слева
  },

  wheel: {
    items: [], // массив элементов колеса в нужном порядке
    winnerId: null, // id победителя (из items)
    updatedAt: null, // Date.now() для триггера перерисовки
  },
};

export const wonState = (window.wonState = initial);

const subs = new Set();
export function subscribe(fn) {
  subs.add(fn);
  return () => subs.delete(fn);
}
export function getState() {
  return wonState;
}

function emit() {
  for (const fn of subs) fn(wonState);
}

function isObject(x) {
  return x && typeof x === "object" && !Array.isArray(x);
}

function isPlainObject(x) {
  return !!x && typeof x === "object" && !Array.isArray(x);
}

/**
 * Глубокий merge БЕЗ мутаций вложенных "entity" объектов.
 * - массивы всегда заменяем целиком
 * - result.item всегда заменяем целиком
 */
function mergeDeep(target, patch, path = "") {
  if (!isPlainObject(patch)) return target;

  for (const [key, val] of Object.entries(patch)) {
    const nextPath = path ? `${path}.${key}` : key;

    // 1) массивы — replace
    if (Array.isArray(val)) {
      target[key] = val;
      continue;
    }

    // 2) result.item — replace (критично)
    if (nextPath === "result.item") {
      target[key] = val;
      continue;
    }

    // 3) простые объекты — рекурсивно
    if (isPlainObject(val)) {
      if (!isPlainObject(target[key])) target[key] = {};
      mergeDeep(target[key], val, nextPath);
      continue;
    }

    // 4) примитивы / null / функции — replace
    target[key] = val;
  }

  return target;
}

export function setState(patch) {
  // --- DEBUG: кто меняет result ---
  try {
    if (patch && Object.prototype.hasOwnProperty.call(patch, "result")) {
      const it = patch?.result?.item;
    }
  } catch {}

  mergeDeep(wonState, patch);
  emit();
}

// Small helpers (optional, but удобно)
export function setView(view) {
  setState({ view });
  localStorage.setItem("won:view", view);
}

export function setRightPanel(rightPanel) {
  setState({ rightPanel });
  localStorage.setItem("won:rightPanel", rightPanel);
}

export function setSpin(spin) {
  setState({ spin });
  localStorage.setItem("won:spinDuration", String(spin.duration));
  localStorage.setItem("won:spinSpeed", String(spin.speed));
}

export function setPresetDraft(presetDraft) {
  setState({ presetDraft });
  localStorage.setItem(
    "won:presetMedia",
    JSON.stringify(presetDraft.media || [])
  );
  localStorage.setItem(
    "won:presetCategories",
    JSON.stringify(presetDraft.categories || [])
  );
  localStorage.setItem(
    "won:presetWeights",
    JSON.stringify(presetDraft.weights || {})
  );
}
