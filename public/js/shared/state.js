let rightListAllItems = [];
let rightListById = new Map();
const initial = {
  view: localStorage.getItem("won:view") || "wheel",
  rightPanel: localStorage.getItem("won:rightPanel") || "list",
  spin: loadSpinFromLS(),
  presetDraft: {
    name: "",
    media: [],
    categories: [],
    weights: {},
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
const wonState = (window.wonState = initial);
const subs = new Set();

function loadSpinFromLS() {
  const duration = Number(localStorage.getItem("won:spinDuration"));
  const speed = Number(localStorage.getItem("won:spinSpeed"));
  return {
    duration: Number.isFinite(duration) ? duration : 20,
    speed: Number.isFinite(speed) ? speed : 1.0,
  };
}

function emit() {
  for (const fn of subs) fn(wonState);
}

function isPlainObject(x) {
  return !!x && typeof x === "object" && !Array.isArray(x);
}

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

export function $(sel, root = document) {
  if (!sel) return null;

  const s = String(sel);

  // если это простой id (как раньше)
  if (
    !s.startsWith("#") &&
    !s.startsWith(".") &&
    !s.includes(" ") &&
    !s.includes("[") &&
    !s.includes(">") &&
    !s.includes(":")
  ) {
    return document.getElementById(s);
  }

  return root.querySelector(s);
}

export function getState() {
  return wonState;
}

export function setPresetDraft(presetDraft) {
  setState({ presetDraft });

  localStorage.setItem(
    "won:presetMedia",
    JSON.stringify(presetDraft.media || []),
  );

  localStorage.setItem(
    "won:presetCategories",
    JSON.stringify(presetDraft.categories || []),
  );

  localStorage.setItem(
    "won:presetWeights",
    JSON.stringify(presetDraft.weights || {}),
  );

  // ✅ НОВОЕ: виртуальные коллекции
  localStorage.setItem(
    "won:presetVirtualCollections",
    JSON.stringify(presetDraft.virtual_collection_ids || []),
  );
}

export function setSpin(spin) {
  setState({ spin });
  localStorage.setItem("won:spinDuration", String(spin.duration));
  localStorage.setItem("won:spinSpeed", String(spin.speed));
}

export function setState(patch) {
  mergeDeep(wonState, patch);
  emit();
}

export function setView(view) {
  setState({ view });
  localStorage.setItem("won:view", view);
}

export function subscribe(fn) {
  subs.add(fn);
  return () => subs.delete(fn);
}

export function syncSpinInputsFromState() {
  const s = getState();
  const dur = document.getElementById("spin-duration");
  const spd = document.getElementById("spin-speed");

  if (dur && s.spin?.duration != null) {
    dur.value = s.spin.duration;
  }

  if (spd && s.spin?.speed != null) {
    spd.value = s.spin.speed;
  }
}

export function getRightListAllItems() {
  return rightListAllItems;
}

export function getRightListById() {
  return rightListById;
}

export function getRightListItemById(id) {
  return rightListById.get(String(id));
}

export function setRightListAllItems(items) {
  const arr = Array.isArray(items) ? items : [];
  rightListAllItems = arr;

  // rebuild index
  const m = new Map();
  for (const it of arr) {
    const key = String(it?.id ?? "");
    if (key) m.set(key, it);
  }
  rightListById = m;
}

export function resetRightList() {
  rightListAllItems = [];
  rightListById = new Map();
}
