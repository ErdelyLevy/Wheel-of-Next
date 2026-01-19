import { WHEEL_BASE } from "../../shared/api.js";

let dingAudio = null;
let spinAudio = null;

export function ensureDingAudio(src = `${WHEEL_BASE}/sounds/ding.mp3`) {
  if (dingAudio) return dingAudio;
  dingAudio = new Audio(src);
  dingAudio.loop = false;
  dingAudio.preload = "auto";
  dingAudio.volume = 0.9;
  return dingAudio;
}

export function ensureSpinAudio(src = `${WHEEL_BASE}/sounds/spin.mp3`) {
  if (spinAudio) return spinAudio;
  spinAudio = new Audio(src);
  spinAudio.loop = true;
  spinAudio.preload = "auto";
  spinAudio.volume = 0.35;
  return spinAudio;
}

export async function playDing({
  src = `${WHEEL_BASE}/sounds/ding.mp3`,
  volume = 0.9,
  rate = 1,
} = {}) {
  const a = ensureDingAudio(src);
  a.volume = Math.max(0, Math.min(1, Number(volume)));
  a.playbackRate = Math.max(0.25, Math.min(4, Number(rate)));

  // важно: перематываем в начало
  try {
    a.pause();
    a.currentTime = 0;
  } catch {
    // intentionally ignored
  }

  try {
    await a.play();
  } catch {
    // blocked → просто выходим
    return;
  }

  // ждём окончания
  await new Promise((resolve) => {
    const done = () => {
      a.removeEventListener("ended", done);
      a.removeEventListener("pause", done);
      resolve();
    };
    a.addEventListener("ended", done, { once: true });
    // если кто-то остановит — тоже считаем “концом”
    a.addEventListener("pause", done, { once: true });
  });
}

export async function startSpinSound({ src, volume = 0.35, rate = 1 } = {}) {
  const a = ensureSpinAudio(src);
  a.volume = Math.max(0, Math.min(1, Number(volume)));
  a.playbackRate = Math.max(0.25, Math.min(4, Number(rate)));

  try {
    await a.play();
  } catch {
    // blocked by browser → ignore
  }
}

export function stopSpinSound({ fadeMs = 200 } = {}) {
  const a = spinAudio;
  if (!a) return Promise.resolve();

  const ms = Math.max(0, Number(fadeMs) || 0);

  if (ms === 0) {
    a.pause();
    a.currentTime = 0;
    return Promise.resolve();
  }

  const v0 = a.volume;
  const t0 = performance.now();

  return new Promise((resolve) => {
    function tick(now) {
      const t = Math.min(1, (now - t0) / ms);
      a.volume = v0 * (1 - t);

      if (t < 1) requestAnimationFrame(tick);
      else {
        a.pause();
        a.currentTime = 0;
        a.volume = v0;
        resolve();
      }
    }
    requestAnimationFrame(tick);
  });
}
