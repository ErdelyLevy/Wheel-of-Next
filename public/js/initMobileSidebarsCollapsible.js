export function initMobileSidebarsCollapsible() {
  if (window.__mobSidebarsInited) return;
  window.__mobSidebarsInited = true;
  const mq = window.matchMedia("(max-width: 1024px)");
  const app = document.querySelector(".app");
  const left = document.querySelector("aside.left");
  const right = document.querySelector("aside.right");
  if (!app || !left || !right) return;

  const h2Left = left.querySelector("h2");
  const h2Right = right.querySelector("h2");
  if (!h2Left || !h2Right) return;

  const syncRightCollapsedHeight = () => {
    if (!mq.matches) return;

    // меряем ТОЛЬКО в collapsed состоянии
    if (!right.classList.contains("is-collapsed")) return;

    const head = right.querySelector(".right-head") || right;
    const headH = Math.round(head.getBoundingClientRect().height);

    const cs = getComputedStyle(right);
    const padT = parseFloat(cs.paddingTop) || 0;
    const padB = parseFloat(cs.paddingBottom) || 0;
    const bT = parseFloat(cs.borderTopWidth) || 0;
    const bB = parseFloat(cs.borderBottomWidth) || 0;

    const h = Math.max(0, Math.round(headH + padT + padB + bT + bB));
    document.documentElement.style.setProperty("--right-collapsed-h", `${h}px`);
  };

  const updateStateClasses = () => {
    if (!mq.matches) {
      app.classList.remove(
        "m-left-open",
        "m-right-open",
        "m-left-collapsed",
        "m-right-collapsed",
        "m-both-collapsed",
      );
      document.documentElement.classList.remove("m-screen");
      return;
    }

    const leftCollapsed = left.classList.contains("is-collapsed");
    const rightCollapsed = right.classList.contains("is-collapsed");
    const both = leftCollapsed && rightCollapsed;

    app.classList.toggle("m-left-collapsed", leftCollapsed);
    app.classList.toggle("m-right-collapsed", rightCollapsed);
    app.classList.toggle("m-left-open", !leftCollapsed);
    app.classList.toggle("m-right-open", !rightCollapsed);
    app.classList.toggle("m-both-collapsed", both);

    // ✅ m-screen включаем ТОЛЬКО если активен view-wheel
    const viewWheel = document.getElementById("view-wheel");
    const wheelActive =
      viewWheel && !viewWheel.classList.contains("is-hidden-visually");

    document.documentElement.classList.toggle("m-screen", both && wheelActive);
  };

  const applyAfterLayout = () => {
    updateStateClasses();
    syncRightCollapsedHeight();
    syncHeaderHeightVar(); // <- добавить
  };

  const setDefault = () => {
    if (mq.matches) {
      left.classList.add("is-collapsed");
      right.classList.add("is-collapsed");
    } else {
      left.classList.remove("is-collapsed");
      right.classList.remove("is-collapsed");
    }
    requestAnimationFrame(applyAfterLayout);
  };

  const toggle = (el) => {
    el.classList.toggle("is-collapsed");
    requestAnimationFrame(applyAfterLayout);
  };

  h2Left.addEventListener("click", () => toggle(left));
  h2Right.addEventListener("click", () => toggle(right));

  mq.addEventListener?.("change", setDefault);
  setDefault();

  window.addEventListener("resize", () =>
    requestAnimationFrame(applyAfterLayout),
  );
}

export function syncHeaderHeightVar() {
  const header = document.querySelector("header.topbar");
  if (!header) return;
  const h = Math.round(header.getBoundingClientRect().height);
  document.documentElement.style.setProperty("--header-h", `${h}px`);
}
