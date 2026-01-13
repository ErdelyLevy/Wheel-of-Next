console.log("=== SERVER.JS LOADED ===", new Date().toISOString());
import "dotenv/config";
import express from "express";
import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import https from "https";
import { fileURLToPath } from "url";
import dns from "dns/promises";
import { Resolver } from "dns";
import { pool } from "./db.js";

// Если в окружении заданы прокси (напр. HTTP_PROXY/HTTPS_PROXY),
// встроенный fetch/undici может пытаться подключиться к ним.
// Удаляем эти переменные для процесса, чтобы делать прямые запросы.
delete process.env.HTTP_PROXY;
delete process.env.http_proxy;
delete process.env.HTTPS_PROXY;
delete process.env.https_proxy;
delete process.env.ALL_PROXY;
delete process.env.all_proxy;

// If needed, enable CORS by uncommenting and installing the package

// Keep environment and DNS behaviour unchanged in production.

// Получаем __dirname для ES модулей
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Инициализация Express приложения
const app = express();
// app.use(cors()); // если фронт и бэк на одном порту — можно не нужно
app.use(express.json());

app.use((req, res, next) => {
  console.log("[REQ]", req.method, req.url);
  next();
});


// (Static files and index will be mounted after /img handler)

// Пути к файлам данных
const ITEMS_PATH = path.join(__dirname, "data", "items.json");
const WEIGHTS_PATH = path.join(__dirname, "data", "weights.json");
const ROLLS_PATH = path.join(__dirname, "data", "rolls.json"); // если используешь историю

async function loadAllItems() {
  // ✅ если у тебя уже есть PG view/таблица wheel_items — используй её
  const { rows } = await pool.query(`select * from wheel_items`);
  return rows;
}

// Функция для чтения версионированных данных (новый формат с version и data)
async function readVersioned(filePath, fallbackData) {
  const raw = await readJson(filePath, null);
  if (!raw) return { version: 1, data: fallbackData };

  // новый формат
  if (raw && typeof raw === "object" && "data" in raw) {
    return {
      version: Number(raw.version) || 1,
      data: raw.data ?? fallbackData
    };
  }

  // старый формат (просто объект или массив)
  return { version: 1, data: raw };
}

// Функция для записи версионированных данных
async function writeVersioned(filePath, data, version = 1) {
  await fs.writeFile(filePath, JSON.stringify({ version, data }, null, 2), "utf8");
}

// Функция для очистки и валидации весов (ограничение от 0 до 10)
function sanitizeWeights(input) {
  const out = {};
  if (!input || typeof input !== "object") return out;

  for (const [k, v] of Object.entries(input)) {
    const n = Number(v);
    if (!Number.isFinite(n)) continue;
    out[k] = Math.max(0, Math.min(10, Math.round(n)));
  }
  return out;
}

// Вспомогательная функция: безопасное чтение JSON файла
async function readJson(filePath, fallback) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

// API эндпоинт: получение списка всех элементов
app.get("/api/items", async (req, res) => {
  try {
    const { rows } = await pool.query(`
      select *
      from wheel_items
      order by title asc
    `);
    res.set("Cache-Control", "no-store");
    return res.json(rows);
  } catch (e) {
    console.error("[API] /api/items failed:", e);
    return res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});



// API эндпоинт: получение весов
app.get("/api/weights", async (req, res) => {
  const v = await readVersioned(WEIGHTS_PATH, {});
  res.json(sanitizeWeights(v.data));
});

// API эндпоинт: сохранение весов
app.post("/api/weights", async (req, res) => {
  const cleaned = sanitizeWeights(req.body);
  await writeVersioned(WEIGHTS_PATH, cleaned, 1);
  res.json({ ok: true });
});

// Вспомогательная функция: фильтрация элементов по медиа и платформе (как на фронте)
function filterItems(all, media, platform) {
  if (media === "games") {
    return all.filter(x =>
      x.media_type === "game" &&
      (!platform || platform === "all" || (x.platform || "").toLowerCase() === platform)
    );
  }
  if (media === "books") {
    return all.filter(x => x.media_type === "book");
  }
  // video
  return all.filter(x => x.media_type === "anime" || x.media_type === "tv" || x.media_type === "movie");
}

// Вспомогательная функция: определение ключа веса (важно совпасть логикой с state.js)
function resolveWeightKey(item) {
  const cat = String(item.category || "").toLowerCase();
  const media = String(item.media_type || "").toLowerCase();

  // Games
  if (media === "games" || cat.includes("_game")) {
    if (cat.startsWith("continue_game")) return "continue_game";
    if (cat.startsWith("new_game")) return "new_game";
    if (cat.startsWith("single_game")) return "single_game";
    return cat;
  }

  // Video
  if (cat === "watchlist") return "continue_tv";

  if (cat === "new tv" || cat === "new_tv") return "new_tv";
  if (cat === "single tv" || cat === "single_tv") return "single_tv";

  if (cat === "continue anime" || cat === "continue_anime") return "continue_anime";
  if (cat === "new anime" || cat === "new_anime") return "new_anime";
  if (cat === "single anime" || cat === "single_anime") return "single_anime";

  return cat;
}

// Функция получения веса для элемента
function getWeight(item, weights) {
  const key = resolveWeightKey(item);
  const w = weights?.[key];
  const n = Number(w);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

// Функция взвешенного выбора индекса
function weightedPickIndex(items, weightsMap) {
  const weights = items.map(it => getWeight(it, weightsMap));
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) return Math.floor(Math.random() * items.length);

  let r = Math.random() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r <= 0) return i;
  }
  return items.length - 1;
}

console.log("[BOOT] register GET /api/random");

// API эндпоинт: случайный выбор элемента (серверная сторона)
app.get("/api/random", async (req, res) => {
  try {
    const media = String(req.query.media || "video");
    const platform = String(req.query.platform || "all");
    const q = String(req.query.q || "").trim().toLowerCase();

    const allItems = await loadAllItems();
    const weights = await readJson(WEIGHTS_PATH, {});

    let items = filterItems(allItems, media, platform);

    if (q) {
      items = items.filter(x => String(x.title || "").toLowerCase().includes(q));
    }

    if (!items.length) {
      return res.status(404).json({ ok: false, error: "No items for this mode" });
    }

    const index = weightedPickIndex(items, weights);
    const item = items[index];

    //DUBUG
    if (item?.title?.toLowerCase?.().includes("пример") || String(item?.poster||"").includes("example")) {
      console.warn("[RANDOM] picked suspicious item from", ITEMS_PATH, item?.id, item?.title, item?.poster);
    }

    return res.json({
      ok: true,
      item_id: item?.id ?? null,
      item,
      // index оставим как debug, но фронту лучше на него не полагаться
      index,
      total: items.length
    });
  } catch (e) {
    console.error("[API] /api/random failed:", e);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

// API эндпоинт: получение истории бросков (последние N)
app.get("/api/rolls", async (req, res) => {
  const limit = Math.max(1, Math.min(200, Number(req.query.limit ?? 20) || 20));
  const v = await readVersioned(ROLLS_PATH, []);
  const rolls = Array.isArray(v.data) ? v.data : [];
  res.json(rolls.slice(-limit).reverse());
});

// API эндпоинт: добавление записи в историю бросков
app.post("/api/rolls", async (req, res) => {
  const body = req.body || {};
  const roll = {
    ts: Date.now(),
    media: String(body.media || ""),
    platform: String(body.platform || ""),
    item_id: body.item_id ?? null,
    title: String(body.title || ""),
    poster: String(body.poster || ""),
    category: String(body.category || "")
  };

  if (!roll.title || roll.item_id == null) {
    return res.status(400).json({ ok: false, error: "Invalid roll payload" });
  }

  const v = await readVersioned(ROLLS_PATH, []);
  const rolls = Array.isArray(v.data) ? v.data : [];
  rolls.push(roll);

  const MAX = 5000;
  const trimmed = rolls.length > MAX ? rolls.slice(rolls.length - MAX) : rolls;

  await writeVersioned(ROLLS_PATH, trimmed, 1);
  res.json({ ok: true });
});

// API эндпоинт: проверка здоровья сервера
app.get("/api/health", (req, res) => {
  res.json({ ok: true });
});

const IMG_CACHE_DIR = path.join(process.cwd(), ".cache", "img");

function hashUrl(url) {
  return crypto.createHash("sha1").update(url).digest("hex");
}

function extFromContentType(ct = "") {
  const c = ct.split(";")[0].trim().toLowerCase();
  if (c === "image/jpeg") return "jpg";
  if (c === "image/png") return "png";
  if (c === "image/webp") return "webp";
  if (c === "image/avif") return "avif";
  if (c === "image/gif") return "gif";
  return "bin";
}

async function fileExists(p) {
  try { await fs.access(p); return true; } catch { return false; }
}

app.get("/img", async (req, res) => {
  try {
    const url = String(req.query.url || "");
    if (!url) return res.status(400).send("Missing url");

    console.log('[IMG] proxy request for', url);

    const u = new URL(url);

    // Проверяем резолвинг имени — если оно локально заблокировано (127.0.0.1),
    // пробуем fallback через публичные DNS и возвращаем понятную ошибку,
    // чтобы не пытаться делать внешний fetch в случае блокировки.
    const lookup = await dns.lookup(u.hostname, { all: true });

    let finalLookup = lookup;
    if (lookup.some(r => r.address === "127.0.0.1")) {
      try {
        const resolver = new Resolver();
        resolver.setServers(["1.1.1.1", "8.8.8.8"]);
        const addrs = await new Promise((resolve, reject) => {
          resolver.resolve4(u.hostname, (err, addresses) => err ? reject(err) : resolve(addresses));
        });
        finalLookup = addrs.map(a => ({ address: a, family: 4 }));
      } catch (err) {
        // fallback resolver failed — continue and let fetch handle errors
      }
    }

    if (finalLookup.some(r => r.address === "127.0.0.1")) {
      return res.status(502).send("Upstream host resolves to localhost (blocked). Check hosts file or DNS settings.");
    }

    // allow proxying most external hosts, but keep protection against localhost-resolving hosts
    // (we already checked DNS lookup above for 127.0.0.1). Log host for visibility.
    console.log('[IMG] proxying host', u.hostname);

    await fs.mkdir(IMG_CACHE_DIR, { recursive: true });

    const key = hashUrl(url);
    const metaPath = path.join(IMG_CACHE_DIR, `${key}.json`);

    // 1) из кеша
    if (await fileExists(metaPath)) {
      const meta = JSON.parse(await fs.readFile(metaPath, "utf8"));
      const filePath = path.join(IMG_CACHE_DIR, `${key}.${meta.ext}`);
      if (await fileExists(filePath)) {
        // Read and send buffer to avoid sendFile missing-file race conditions
        const cachedBuf = await fs.readFile(filePath);
        res.setHeader("Content-Type", meta.contentType);
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        res.setHeader("Access-Control-Allow-Origin", "*");
        return res.send(cachedBuf);
      }
    }

        // 2) скачать → сохранить → отдать
        // Выполняем прямой HTTPS-запрос к разрешённому IP (SNI = оригинальный хост),
        // чтобы обойти системные прокси (которые могут перенаправлять на 127.0.0.1).
        const ip = finalLookup[0].address;
        const opts = {
          host: ip,
          port: 443,
          path: u.pathname + (u.search || ""),
          method: "GET",
          headers: {
            "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
            "User-Agent": "WheelOfNext/1.0",
            "Referer": "http://localhost:3000/",
            "Host": u.hostname
          },
          servername: u.hostname
        };

        const { statusCode, headers: upstreamHeaders, body } = await new Promise((resolve, reject) => {
          const req = https.request(opts, (up) => {
            const chunks = [];
            up.on("data", c => chunks.push(c));
            up.on("end", () => {
              resolve({ statusCode: up.statusCode, headers: up.headers, body: Buffer.concat(chunks) });
            });
          });
          req.on("error", reject);
          req.end();
        });

        // 404 от TMDB — нормальная ситуация (битый постер)
        if (statusCode === 404) {
          console.warn('[IMG] upstream 404 for', url);
          return res.status(404).send("Upstream 404");
        }

        // другие не-2xx считаем ошибкой
        if (!statusCode || statusCode < 200 || statusCode >= 300) {
          console.warn('[IMG] upstream error', statusCode, 'for', url);
          return res.status(statusCode || 502).send(`Upstream error: ${statusCode}`);
        }

        const contentType = upstreamHeaders["content-type"] || "image/jpeg";
        const ext = extFromContentType(contentType);
        const buf = body;

    const filePath = path.join(IMG_CACHE_DIR, `${key}.${ext}`);
    await fs.writeFile(filePath, buf);
    await fs.writeFile(metaPath, JSON.stringify({ contentType, ext }), "utf8");

    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    res.setHeader("Access-Control-Allow-Origin", "*");
    return res.send(buf);
  } catch (e) {
    console.error("[IMG] proxy failed:", e);
    return res.status(500).send("Proxy error");
  }
});

// ✅ ПОТОМ: статика
app.use(express.static(path.join(__dirname, "public")));

// ✅ ПОТОМ: index.html
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Запуск сервера на порту 3000
app.listen(3000, () => {
  // minimal startup message
  console.log("API running");
});