import { $, getState, setSpin } from "../shared/state.js";

export function initSettingsSliders() {
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
