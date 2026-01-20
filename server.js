// server.js
import "dotenv/config";
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { pool } from "./db.js";
import fs from "fs";
import fsp from "fs/promises";
import crypto from "crypto";
import dns from "node:dns";
import { Agent, setGlobalDispatcher } from "undici";
import swaggerUi from "swagger-ui-express";
import swaggerJsdoc from "swagger-jsdoc";

const BAD_IP = new Set(["127.0.0.1", "0.0.0.0", "::1"]);

// если хочешь сторонний DNS — можно явно:
dns.setServers(["1.1.1.1", "8.8.8.8"]);

async function resolveHost(hostname) {
  // 1) если hostname уже IP — просто вернём
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname))
    return [{ address: hostname, family: 4 }];
  if (hostname.includes(":")) return [{ address: hostname, family: 6 }];

  // 2) сначала IPv4
  try {
    const v4 = await dns.promises.resolve4(hostname);
    const addrs4 = v4
      .filter((ip) => ip && !BAD_IP.has(ip))
      .map((ip) => ({ address: ip, family: 4 }));
    if (addrs4.length) return addrs4;
  } catch {}

  // 3) потом IPv6
  try {
    const v6 = await dns.promises.resolve6(hostname);
    const addrs6 = v6
      .filter((ip) => ip && !BAD_IP.has(ip))
      .map((ip) => ({ address: ip, family: 6 }));
    if (addrs6.length) return addrs6;
  } catch {}

  return [];
}

function lookup(hostname, options, cb) {
  resolveHost(hostname)
    .then((addrs) => {
      if (!addrs.length)
        return cb(new Error(`DNS resolve failed for ${hostname}`));

      // ⚠️ ВАЖНО: если options.all=true — возвращаем массив адресов
      if (options && options.all) return cb(null, addrs);

      // иначе — один адрес
      const first = addrs[0];
      return cb(null, first.address, first.family);
    })
    .catch((err) => cb(err));
}

setGlobalDispatcher(
  new Agent({
    connect: {
      timeout: 30_000,
      lookup, // ✅ вот сюда
    },
    headersTimeout: 30_000,
    bodyTimeout: 60_000,
  }),
);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "2mb" }));

// ---- helpers ----
const openapiSpec = swaggerJsdoc({
  definition: {
    openapi: "3.0.0",
    info: {
      title: "My API",
      version: "1.0.0",
    },
  },
  apis: ["./server.js"], // позже расширим на ./routes/*.js если надо
});

// Swagger UI
app.use("/docs", swaggerUi.serve, swaggerUi.setup(openapiSpec));

// Raw OpenAPI JSON (это будет нужно Postman)
app.get("/openapi.json", (req, res) => res.json(openapiSpec));

function clampInt(v, min, max, fallback = min) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

function proxifyPoster(posterUrl, { w = 512, fmt = "webp" } = {}) {
  const u = String(posterUrl || "").trim();
  if (!u) return "";
  return `/wheel/api/poster?u=${encodeURIComponent(u)}&w=${w}&fmt=${fmt}`;
}

function asTextArray(x) {
  if (Array.isArray(x)) return x.map((v) => String(v).trim()).filter(Boolean);
  if (typeof x === "string")
    return x
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  return [];
}

function normalizeWeightsObject(obj) {
  const out = {};
  if (!obj || typeof obj !== "object") return out;
  for (const [k, v] of Object.entries(obj)) {
    const n = Number(v);
    if (!Number.isFinite(n)) continue;
    out[String(k)] = Math.max(0, n);
  }
  return out;
}

function shuffleInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function weightedPickIndex(items, weightFn) {
  if (!items.length) return -1;
  const ws = items.map(weightFn);
  const total = ws.reduce((a, b) => a + b, 0);
  if (!(total > 0)) return Math.floor(Math.random() * items.length);

  let r = Math.random() * total;
  for (let i = 0; i < items.length; i++) {
    r -= ws[i];
    if (r <= 0) return i;
  }
  return items.length - 1;
}

const POSTER_CACHE_MAX_BYTES = 4 * 1024 * 1024 * 1024; // 4GB
let posterCacheCleanupRunning = false;

async function enforcePosterCacheLimit(maxBytes = POSTER_CACHE_MAX_BYTES) {
  if (posterCacheCleanupRunning) return;
  posterCacheCleanupRunning = true;

  try {
    const entries = await fsp.readdir(POSTER_CACHE_DIR, {
      withFileTypes: true,
    });
    const files = [];

    for (const ent of entries) {
      if (!ent.isFile()) continue;
      const full = path.join(POSTER_CACHE_DIR, ent.name);
      try {
        const st = await fsp.stat(full);
        files.push({
          full,
          size: st.size || 0,
          mtimeMs: st.mtimeMs || 0,
        });
      } catch {}
    }

    let total = files.reduce((a, f) => a + f.size, 0);
    if (total <= maxBytes) return;

    // удаляем самые старые
    files.sort((a, b) => a.mtimeMs - b.mtimeMs);

    for (const f of files) {
      if (total <= maxBytes) break;
      try {
        await fsp.unlink(f.full);
        total -= f.size;
      } catch {}
    }
  } finally {
    posterCacheCleanupRunning = false;
  }
}

// --- poster fetch: dedupe + concurrency limit ---
const POSTER_FETCH_CONCURRENCY = Number(
  process.env.POSTER_FETCH_CONCURRENCY || 4,
);

// key(sha1(url)) -> Promise<{ filePath, ct }>
const posterInFlight = new Map();

let posterActive = 0;
const posterWaitQ = [];

async function posterAcquire() {
  if (posterActive < POSTER_FETCH_CONCURRENCY) {
    posterActive++;
    return;
  }
  await new Promise((resolve) => posterWaitQ.push(resolve));
  posterActive++;
}

function posterRelease() {
  posterActive = Math.max(0, posterActive - 1);
  const next = posterWaitQ.shift();
  if (next) next();
}

async function fetchPosterToCache({ url, key, filePath }) {
  await posterAcquire();
  try {
    async function logPosterTarget(u) {
      try {
        const U = new URL(u);
        const host = U.hostname;

        console.log("[poster] url =", u);
        console.log("[poster] host =", host);

        // ✅ логируем ИМЕННО то, что пойдёт в undici lookup
        const addrs = await resolveHost(host);
        console.log("[poster] resolved =", addrs);
      } catch (e) {
        console.log("[poster] bad url =", u, "err =", String(e?.message || e));
      }
    }

    // ...
    await logPosterTarget(url);

    const r = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(12_000),
      headers: {
        "User-Agent": "WheelOfNext/1.0",
        Accept: "image/*,*/*;q=0.8",
      },
    });

    if (!r.ok) {
      throw Object.assign(new Error(`poster fetch failed: ${r.status}`), {
        status: 502,
      });
    }

    const ct = r.headers.get("content-type") || "";
    if (!ct.startsWith("image/")) {
      throw Object.assign(new Error("not an image"), { status: 415 });
    }

    const buf = Buffer.from(await r.arrayBuffer());
    if (!buf || buf.length < 200) {
      throw Object.assign(new Error("empty image"), { status: 502 });
    }

    // атомарно: пишем во временный и потом rename
    const tmp = filePath + ".tmp-" + process.pid + "-" + Date.now();
    await fsp.writeFile(tmp, buf);
    await fsp.rename(tmp, filePath);

    // чистку можно пускать "в фоне"
    enforcePosterCacheLimit().catch(() => {});

    return { filePath, ct };
  } finally {
    posterRelease();
  }
}

const POSTER_CACHE_DIR = path.join(__dirname, ".cache", "posters");
await fsp.mkdir(POSTER_CACHE_DIR, { recursive: true });

function sha1(s) {
  return crypto.createHash("sha1").update(String(s)).digest("hex");
}

function normalizePosterParams(q) {
  const w = clampInt(q.w, 64, 1024, 512); // ширина по умолчанию 512
  const fmt = String(q.fmt || "webp").toLowerCase();
  const outFmt = ["webp", "jpeg", "png", "avif"].includes(fmt) ? fmt : "webp";
  return { w, fmt: outFmt };
}

// ---- dynamic DB names (wheel_* or won_*) ----
let T_PRESETS = "wheel_presets";
let T_HISTORY = "wheel_history";

async function tableExists(name) {
  const { rows } = await pool.query(
    `select 1
     from information_schema.tables
     where table_schema='public' and table_name=$1
     limit 1`,
    [name],
  );
  return !!rows.length;
}

async function getColumns(tableName) {
  const { rows } = await pool.query(
    `select column_name
     from information_schema.columns
     where table_schema='public' and table_name=$1
     order by ordinal_position`,
    [tableName],
  );
  return new Set(rows.map((r) => r.column_name));
}

let presetsCols = new Set();
let historyCols = new Set();
let PRESET_COL_COLLECTIONS = "categories"; // or "collections"

async function resolveSchema() {
  // prefer won_* if exists
  if (await tableExists("won_presets")) T_PRESETS = "won_presets";
  if (await tableExists("won_history")) T_HISTORY = "won_history";

  presetsCols = await getColumns(T_PRESETS);
  historyCols = await getColumns(T_HISTORY);

  PRESET_COL_COLLECTIONS = presetsCols.has("collections")
    ? "collections"
    : "categories";

  console.log(
    "[DB] presets table:",
    T_PRESETS,
    "collections col:",
    PRESET_COL_COLLECTIONS,
  );
  console.log("[DB] history table:", T_HISTORY);
}

function normStr(x) {
  return String(x ?? "").trim();
}

function toVcId(x) {
  // id: text primary key — лучше нормализовать, чтобы не было пробелов/слешей
  // если хочешь — замени на uuid, но сейчас под твою схему:
  return normStr(x);
}

async function enrichVcInHistoryRow(client, row) {
  if (!row) return row;

  // row.winner и row.wheel_items могут быть jsonb (объект/массив) или строкой — страхуемся
  const winner =
    typeof row.winner === "string" ? safeJsonParse(row.winner) : row.winner;
  const wheel_items =
    typeof row.wheel_items === "string"
      ? safeJsonParse(row.wheel_items)
      : row.wheel_items;

  const ids = new Set();

  function collect(x) {
    if (!x || x.__kind !== "vc") return;
    const id = String(x.__vc_id || x.id || "").trim();
    if (id) ids.add(id);
  }

  collect(winner);
  (Array.isArray(wheel_items) ? wheel_items : []).forEach(collect);

  const vcIds = [...ids];
  if (!vcIds.length) {
    // просто вернём, но уже нормализованные winner/wheel_items
    return { ...row, winner, wheel_items };
  }

  const { rows } = await client.query(
    `
    select id, name, media, poster, source_label, source_url
      from won_virtual_collections
     where id = any($1::text[])
    `,
    [vcIds],
  );

  const map = new Map(rows.map((r) => [String(r.id), r]));

  function merge(x) {
    if (!x || x.__kind !== "vc") return x;

    const id = String(x.__vc_id || x.id || "").trim();
    const vc = map.get(id);
    if (!vc) return x;

    return {
      ...x,
      // подтягиваем “справочные” поля, но не перетираем уже существующие
      title: x.title || vc.name || x.name || "—",
      name: x.name || vc.name || "—",
      media_type: x.media_type || vc.media || "book",
      poster: x.poster || vc.poster || "",
      source_label: x.source_label || vc.source_label || "",
      source_url: x.source_url || vc.source_url || "",
    };
  }

  return {
    ...row,
    winner: merge(winner),
    wheel_items: (Array.isArray(wheel_items) ? wheel_items : []).map(merge),
  };
}

function safeJsonParse(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

// ---- API ----

/**
 * @openapi
 * /api/virtual-collections:
 *   get:
 *     tags: [Virtual Collections]
 *     summary: List virtual collections
 *     responses:
 *       200: { description: OK }
 */
app.get("/api/virtual-collections", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `
  select id, name, media, poster, source_label, source_url, created_at, updated_at
    from won_virtual_collections
   order by name asc
  `,
    );

    res.json({ ok: true, rows });
  } catch (e) {
    console.error("[API] /wheel/api/virtual-collections GET failed:", e);
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

/**
 * @openapi
 * /api/virtual-collections:
 *   post:
 *     tags: [Virtual Collections]
 *     summary: Create or update virtual collection (upsert)
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [id, name, media]
 *             properties:
 *               id: { type: string }
 *               name: { type: string }
 *               media: { type: string }
 *               poster: { type: string, nullable: true }
 *     responses:
 *       200: { description: OK }
 *       400: { description: Bad Request }
 */
app.post("/api/virtual-collections", async (req, res) => {
  try {
    const b = req.body || {};
    const id = toVcId(b.id);
    const name = normStr(b.name);
    const media = normStr(b.media);
    const poster = normStr(b.poster);
    const source_label = normStr(b.source_label ?? b.sourceLabel);
    const source_url = normStr(b.source_url ?? b.sourceUrl);

    if (!id) return res.status(400).json({ ok: false, error: "id required" });
    if (!name)
      return res.status(400).json({ ok: false, error: "name required" });
    if (!media)
      return res.status(400).json({ ok: false, error: "media required" });

    const { rows } = await pool.query(
      `
  insert into won_virtual_collections (id, name, media, poster, source_label, source_url)
  values ($1, $2, $3, nullif($4,''), nullif($5,''), nullif($6,''))
  on conflict (id) do update
    set name = excluded.name,
        media = excluded.media,
        poster = excluded.poster,
        source_label = excluded.source_label,
        source_url = excluded.source_url,
        updated_at = now()
  returning id, name, media, poster, source_label, source_url, created_at, updated_at
  `,
      [id, name, media, poster, source_label, source_url],
    );

    res.json({ ok: true, row: rows[0] || null });
  } catch (e) {
    console.error("[API] /wheel/api/virtual-collections POST failed:", e);
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

/**
 * @openapi
 * /api/virtual-collections/{id}:
 *   delete:
 *     tags: [Virtual Collections]
 *     summary: Delete virtual collection by id (and remove from presets)
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: OK }
 *       400: { description: Bad Request }
 *       404: { description: Not Found }
 */
app.delete("/api/virtual-collections/:id", async (req, res) => {
  const id = toVcId(req.params.id);
  if (!id) return res.status(400).json({ ok: false, error: "id required" });

  const client = await pool.connect();
  try {
    await client.query("begin");

    // 1) удаляем VC
    const del = await client.query(
      `delete from won_virtual_collections where id = $1 returning id`,
      [id],
    );
    if (!del.rowCount) {
      await client.query("rollback");
      return res.status(404).json({ ok: false, error: "not found" });
    }

    // 2) чистим все пресеты, которые ссылались на неё
    await client.query(
      `
      update won_presets
         set virtual_collection_ids =
             array_remove(virtual_collection_ids, $1)
       where $1 = any(virtual_collection_ids)
      `,
      [id],
    );

    await client.query("commit");
    res.json({ ok: true, id });
  } catch (e) {
    await client.query("rollback");
    console.error("[API] /wheel/api/virtual-collections DELETE failed:", e);
    res.status(500).json({ ok: false, error: String(e.message || e) });
  } finally {
    client.release();
  }
});

/**
 * @openapi
 * /api/poster:
 *   get:
 *     tags: [Assets]
 *     summary: Proxy and cache poster by URL
 *     parameters:
 *       - in: query
 *         name: u
 *         required: true
 *         schema: { type: string }
 *         description: Source URL (http/https). You can also pass `url`.
 *     responses:
 *       200: { description: OK (image bytes) }
 *       400: { description: Bad Request }
 *       404: { description: Not Found }
 *       502: { description: Bad Gateway }
 */
app.get("/api/poster", async (req, res) => {
  try {
    let url = String(req.query.u || req.query.url || "").trim();

    // ✅ если прилетел уже проксированный url вида "/wheel/api/poster?u=..."
    if (url.startsWith("/wheel/api/poster")) {
      const inner = new URL(url, "http://localhost"); // базовый домен любой, нужен только для парсинга
      const u2 =
        inner.searchParams.get("u") || inner.searchParams.get("url") || "";
      url = decodeURIComponent(String(u2).trim());
    }

    // ✅ сначала валидация, потом new URL(...)
    if (!url) return res.status(400).json({ ok: false, error: "url required" });
    if (!/^https?:\/\//i.test(url)) {
      return res.status(400).json({ ok: false, error: "invalid url" });
    }

    // логи — только когда url уже валиден
    try {
      console.log("[poster] url =", url);
      console.log("[poster] host =", new URL(url).hostname);
    } catch {}

    const key = sha1(url);
    const filePath = path.join(POSTER_CACHE_DIR, key);

    // 1) если уже есть на диске — отдаем сразу
    if (fs.existsSync(filePath)) {
      res.set("Cache-Control", "public, max-age=31536000, immutable");
      return res.sendFile(key, { root: POSTER_CACHE_DIR });
    }

    // 2) DEDUPE: если уже качаем этот url — ждём тот же promise
    let p = posterInFlight.get(key);
    if (!p) {
      p = (async () => fetchPosterToCache({ url, key, filePath }))();
      posterInFlight.set(key, p);

      // ✅ чистим inFlight всегда (даже при ошибке)
      p.finally(() => posterInFlight.delete(key)).catch(() => {});
    }

    // 3) ждём результат (скачалось/закэшировалось) — но ошибки превращаем в нормальные ответы
    let ct = "application/octet-stream";
    try {
      const out = await p;
      ct = out?.ct || ct;
    } catch (e) {
      const msg = String(e?.message || e);
      const st = Number(e?.status) || 502;

      // ✅ если источник вернул 404/410 — это не "ошибка прокси", а "нет постера"
      const isNotFound =
        st === 404 ||
        st === 410 ||
        /\bfetch failed:\s*404\b/i.test(msg) ||
        /\bfetch failed:\s*410\b/i.test(msg) ||
        /\b404\b/.test(msg);

      if (isNotFound) {
        // можно 404 json, можно 204 без контента — оставляю 404 как ты логически ожидал
        return res.status(404).json({ ok: false, error: "poster not found" });
      }

      // остальные — логируем и возвращаем статус
      console.error("[API] /wheel/api/poster fetch failed:", e);
      return res.status(st).json({ ok: false, error: msg });
    }

    // 4) отдаем с диска (а не buf) — чтобы не держать память
    res.set("Content-Type", ct || "application/octet-stream");
    res.set("Cache-Control", "public, max-age=31536000, immutable");
    return res.sendFile(key, { root: POSTER_CACHE_DIR });
  } catch (e) {
    const status = Number(e?.status) || 500;
    if (status >= 500) console.error("[API] /wheel/api/poster failed:", e);
    return res
      .status(status)
      .json({ ok: false, error: String(e.message || e) });
  }
});

/**
 * @openapi
 * /api/health:
 *   get:
 *     tags: [System]
 *     summary: Health check (DB ping)
 *     responses:
 *       200: { description: OK }
 *       500: { description: Server Error }
 */
app.get("/api/health", async (req, res) => {
  try {
    await pool.query("select 1 as ok");
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

/**
 * @openapi
 * /api/meta:
 *   get:
 *     tags: [Meta]
 *     summary: Dropdown meta (media types + collections)
 *     responses:
 *       200: { description: OK }
 */
app.get("/api/meta", async (req, res) => {
  try {
    const media = await pool.query(
      `select distinct media_type from wheel_items where media_type is not null order by 1`,
    );
    const cols = await pool.query(
      `select distinct category_name from wheel_items where category_name is not null order by 1`,
    );

    res.json({
      ok: true,
      media_types: media.rows.map((r) => r.media_type),
      collections: cols.rows.map((r) => r.category_name),
    });
  } catch (e) {
    console.error("[API] /wheel/api/meta failed:", e);
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

/**
 * @openapi
 * /api/presets:
 *   get:
 *     tags: [Presets]
 *     summary: List presets
 *     responses:
 *       200: { description: OK }
 */
app.get("/api/presets", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `select * from ${T_PRESETS} order by created_at asc nulls last, name asc`,
    );

    const asTextArray = (v) => {
      if (!v) return [];
      if (Array.isArray(v))
        return v.map((x) => String(x ?? "").trim()).filter(Boolean);
      // на всякий случай, если вдруг прилетит строкой
      return String(v)
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean);
    };

    // нормализуем форму под фронт
    const presets = rows.map((p) => ({
      id: p.id,
      name: p.name,

      media_types: asTextArray(p.media_types ?? p.media ?? []),

      collections: asTextArray(
        p[PRESET_COL_COLLECTIONS] ?? p.categories ?? p.collections ?? [],
      ),

      // ✅ NEW
      virtual_collection_ids: asTextArray(
        p.virtual_collection_ids ?? p.virtualCollections ?? [],
      ),

      weights: p.weights ?? {},
      created_at: p.created_at ?? null,
      updated_at: p.updated_at ?? null,
    }));

    res.json({ ok: true, presets });
  } catch (e) {
    console.error("[API] /wheel/api/presets failed:", e);
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

/**
 * @openapi
 * /api/presets:
 *   post:
 *     tags: [Presets]
 *     summary: Create or update preset (upsert)
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, media_types, collections]
 *             properties:
 *               id: { type: string, nullable: true }
 *               name: { type: string }
 *               media_types:
 *                 type: array
 *                 items: { type: string }
 *               collections:
 *                 type: array
 *                 items: { type: string }
 *               virtual_collection_ids:
 *                 type: array
 *                 items: { type: string }
 *               weights:
 *                 type: object
 *                 additionalProperties: { type: number }
 *               save: { type: boolean }
 *     responses:
 *       200: { description: OK }
 *       400: { description: Bad Request }
 */
app.post("/api/presets", async (req, res) => {
  try {
    const body = req.body || {};

    const id = body.id ? String(body.id).trim() : null;
    const name = String(body.name || "").trim();

    const media_types = asTextArray(body.media_types ?? body.media);

    const collections = asTextArray(
      body.collections ?? body.categories ?? body.category_names,
    );

    // ✅ NEW: virtual collections ids (optional)
    const virtual_collection_ids = asTextArray(
      body.virtual_collection_ids ??
        body.virtualCollections ??
        body.virtual_collections ??
        body.vc_ids,
    );

    const weights = normalizeWeightsObject(body.weights);

    if (!name)
      return res.status(400).json({ ok: false, error: "name is required" });
    if (!media_types.length)
      return res
        .status(400)
        .json({ ok: false, error: "media_types is required" });
    if (!collections.length)
      return res
        .status(400)
        .json({ ok: false, error: "collections is required" });

    const colCollections = PRESET_COL_COLLECTIONS;

    // ✅ имя колонки в БД
    const colVC = "virtual_collection_ids";

    // upsert by id (если нет id — create)
    if (id) {
      const { rows } = await pool.query(
        `
        update ${T_PRESETS}
           set name = $2,
               media_types = $3,
               ${colCollections} = $4,
               ${colVC} = $5,
               weights = $6,
               updated_at = now()
         where id = $1
         returning *
        `,
        [id, name, media_types, collections, virtual_collection_ids, weights],
      );

      if (rows[0]) {
        return res.json({ ok: true, preset: rows[0] });
      }

      // если id не найден — создаём с этим id
      const ins = await pool.query(
        `
        insert into ${T_PRESETS} (id, name, media_types, ${colCollections}, ${colVC}, weights, created_at, updated_at)
        values ($1, $2, $3, $4, $5, $6, now(), now())
        returning *
        `,
        [id, name, media_types, collections, virtual_collection_ids, weights],
      );
      return res.json({ ok: true, preset: ins.rows[0] });
    }

    const { rows } = await pool.query(
      `
      insert into ${T_PRESETS} (name, media_types, ${colCollections}, virtual_collection_ids, weights, created_at, updated_at)
      values ($1, $2, $3, $4, $5, now(), now())
      returning *
      `,
      [name, media_types, collections, virtual_collection_ids, weights],
    );

    res.json({ ok: true, preset: rows[0] });
  } catch (e) {
    console.error("[API] POST /wheel/api/presets failed:", e);
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

/**
 * @openapi
 * /api/presets/{id}:
 *   delete:
 *     tags: [Presets]
 *     summary: Delete preset by id
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: OK }
 *       400: { description: Bad Request }
 */
app.delete("/api/presets/:id", async (req, res) => {
  try {
    const id = String(req.params.id || "").trim();
    if (!id) return res.status(400).json({ ok: false, error: "id required" });

    await pool.query(`delete from ${T_PRESETS} where id = $1`, [id]);
    res.json({ ok: true });
  } catch (e) {
    console.error("[API] DELETE /wheel/api/presets failed:", e);
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

/**
 * @openapi
 * /api/history:
 *   get:
 *     tags: [History]
 *     summary: List history (latest first)
 *     parameters:
 *       - in: query
 *         name: limit
 *         required: false
 *         schema: { type: integer, minimum: 1, maximum: 200, default: 50 }
 *     responses:
 *       200: { description: OK }
 */
app.get("/api/history", async (req, res) => {
  try {
    const limit = clampInt(req.query.limit, 1, 200, 50);
    const { rows } = await pool.query(
      `select * from ${T_HISTORY} order by created_at desc limit $1`,
      [limit],
    );

    // обогащаем VC (можно параллельно)
    const out = await Promise.all(
      rows.map((r) => enrichVcInHistoryRow(pool, r)),
    );

    res.json({ ok: true, rows: out });
  } catch (e) {
    console.error("[API] /wheel/api/history failed:", e);
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

/**
 * @openapi
 * /api/history/{id}:
 *   get:
 *     tags: [History]
 *     summary: Get history item by id
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: OK }
 *       400: { description: Bad Request }
 *       404: { description: Not Found }
 */
app.get("/api/history/:id", async (req, res) => {
  try {
    const id = String(req.params.id || "").trim();
    if (!id) return res.status(400).json({ ok: false, error: "id required" });

    const { rows } = await pool.query(
      `select * from ${T_HISTORY} where id = $1 limit 1`,
      [id],
    );
    if (!rows[0])
      return res.status(404).json({ ok: false, error: "not found" });

    const row = await enrichVcInHistoryRow(pool, rows[0]);
    res.json({ ok: true, row });
  } catch (e) {
    console.error("[API] /wheel/api/history/:id failed:", e);
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

/**
 * @openapi
 * /api/random:
 *   post:
 *     tags: [Wheel]
 *     summary: Pick random winner and build wheel items
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [preset_id]
 *             properties:
 *               preset_id: { type: string }
 *               size: { type: integer, minimum: 3, maximum: 128, default: 18 }
 *               save: { type: boolean, default: false }
 *     responses:
 *       200: { description: OK }
 *       400: { description: Bad Request }
 *       404: { description: Not Found }
 */
app.post("/api/random", async (req, res) => {
  try {
    const body = req.body || {};
    const presetId = String(body.preset_id || body.presetId || "").trim();
    const size = clampInt(body.size, 3, 128, 18);
    const save = !!body.save;

    if (!presetId)
      return res.status(400).json({ ok: false, error: "preset_id required" });

    const { rows: pres } = await pool.query(
      `select * from ${T_PRESETS} where id = $1 limit 1`,
      [presetId],
    );
    const preset = pres[0];
    if (!preset)
      return res.status(404).json({ ok: false, error: "preset not found" });

    const media_types = asTextArray(preset.media_types);
    const collections = asTextArray(preset[PRESET_COL_COLLECTIONS]);
    const weights = normalizeWeightsObject(preset.weights || {});

    if (!media_types.length || !collections.length) {
      return res.status(400).json({
        ok: false,
        error: "preset has empty media_types or collections",
      });
    }

    // Pool from view
    // берём ещё vcIds из пресета
    const vcIds = asTextArray(preset.virtual_collection_ids);

    // Pool from view (обычные Items)
    const { rows: poolRows } = await pool.query(
      `
  select *
    from wheel_items
   where media_type = any($1::text[])
     and category_name = any($2::text[])
  `,
      [media_types, collections],
    );

    // Virtual collections rows (VC)
    let vcRows = [];
    if (vcIds.length) {
      const r = await pool.query(
        `
select id, name, media, poster, source_label, source_url, created_at, updated_at
  from won_virtual_collections
 where id = any($1::text[])

    `,
        [vcIds],
      );
      vcRows = r.rows || [];
    }

    // если вообще нет кандидатов — 404
    if (!poolRows.length && !vcRows.length) {
      return res.status(404).json({
        ok: false,
        error: "No items or virtual collections for this preset",
      });
    }

    // --- helpers ---

    function vcToWheelItem(vc) {
      return {
        id: String(vc.id),
        title: String(vc.name || "—"),
        name: String(vc.name || "—"),
        media_type: String(vc.media || "book"),
        category_name: "__virtual__", // просто маркер
        poster: vc.poster || "",
        // ✅ ДОБАВИТЬ
        source_label: vc.source_label || "",
        source_url: vc.source_url || "",
        __kind: "vc",
        __vc_id: String(vc.id),
      };
    }

    // веса: обычные категории -> key=category_name
    // VC -> key="vc:"+id
    function getCollectionWeight(key) {
      const w = weights[key];
      return Number.isFinite(Number(w)) ? Math.max(0, Number(w)) : 1.0;
    }

    function weightFn(it) {
      if (it && it.__kind === "vc") {
        return getCollectionWeight("vc:" + String(it.__vc_id || it.id || ""));
      }
      return getCollectionWeight(String(it?.category_name || ""));
    }

    // 1) строим список “коллекций” (обычные + VC) для выбора
    const collectionCandidates = [];

    // обычные: только те, у которых реально есть items (иначе шанс уйдёт в пустоту)
    if (poolRows.length) {
      const presentCats = new Set(
        poolRows.map((x) => String(x?.category_name || "")),
      );
      for (const c of collections) {
        const key = String(c);
        if (!presentCats.has(key)) continue;
        collectionCandidates.push({ kind: "cat", key, value: key });
      }
    }

    // VC: только те, что реально нашли в таблице
    for (const vc of vcRows) {
      const id = String(vc.id);
      collectionCandidates.push({ kind: "vc", key: "vc:" + id, value: id });
    }

    if (!collectionCandidates.length) {
      return res.status(404).json({
        ok: false,
        error: "No selectable collections (check preset collections/vcIds)",
      });
    }

    // 2) выбираем коллекцию по весам (ВАЖНО: независимо от кол-ва items внутри)
    const pickedColIdx = weightedPickIndex(collectionCandidates, (c) =>
      getCollectionWeight(c.key),
    );
    const picked = collectionCandidates[pickedColIdx];

    // 3) внутри выбранной коллекции выбираем winner
    let winner = null;

    if (picked.kind === "vc") {
      const vc = vcRows.find((x) => String(x.id) === String(picked.value));
      winner = vc ? vcToWheelItem(vc) : null;
    } else {
      const bucket = poolRows.filter(
        (x) => String(x?.category_name || "") === String(picked.value),
      );
      if (bucket.length) winner = bucket[(Math.random() * bucket.length) | 0];
    }

    // финальная страховка
    if (!winner) {
      return res.status(500).json({ ok: false, error: "winner pick failed" });
    }

    const winnerId = winner?.id ?? null;

    const vcWheelItems = vcRows.map(vcToWheelItem);
    const allCandidates = [...poolRows, ...vcWheelItems];

    // exclude winner (и item, и VC)
    const exclude = new Set();
    if (winner && winner.__kind === "vc") {
      exclude.add("vc:" + String(winner.__vc_id || winner.id || ""));
    } else if (winnerId != null) {
      exclude.add("it:" + String(winnerId));
    }

    // fillers from combined pool
    const fillersPool = allCandidates.filter((x) => {
      if (!x) return false;

      if (x.__kind === "vc") {
        const key = "vc:" + String(x.__vc_id || x.id || "");
        return !exclude.has(key);
      }

      if (x.id == null) return false;
      const key = "it:" + String(x.id);
      return !exclude.has(key);
    });

    shuffleInPlace(fillersPool);

    const need = Math.max(0, size - 1);
    const fillers = fillersPool.slice(0, need);

    const wheelItems = [winner, ...fillers];
    shuffleInPlace(wheelItems);

    // winner index (учитываем VC)
    const winnerIndex = wheelItems.findIndex((x) => {
      if (!x) return false;

      if (winner && winner.__kind === "vc") {
        return (
          x.__kind === "vc" &&
          String(x.__vc_id || x.id) === String(winner.__vc_id || winner.id)
        );
      }

      return String(x?.id) === String(winnerId);
    });

    // ✅ enrich wheel items with per-item weight (collection weight)
    const wheelItemsWithW = wheelItems.map((it) => ({
      ...it,
      w: weightFn(it),
    }));

    // winner тоже лучше отдать с w
    const winnerWithW = winner ? { ...winner, w: weightFn(winner) } : null;

    let historyId = null;
    if (save) {
      const presetName = preset.name || "";
      const winnerJson = JSON.stringify(winnerWithW);
      const itemsJson = JSON.stringify(wheelItemsWithW);

      // поддержка разных схем history (winner_id может отсутствовать)
      if (historyCols.has("winner_id")) {
        const { rows } = await pool.query(
          `
          insert into ${T_HISTORY} (preset_id, preset_name, winner_id, winner, wheel_items, created_at)
          values ($1, $2, $3, $4::jsonb, $5::jsonb, now())
          returning id
          `,
          [presetId, presetName, winnerId, winnerJson, itemsJson],
        );
        historyId = rows[0]?.id ?? null;
      } else {
        const { rows } = await pool.query(
          `
          insert into ${T_HISTORY} (preset_id, preset_name, winner, wheel_items, created_at)
          values ($1, $2, $3::jsonb, $4::jsonb, now())
          returning id
          `,
          [presetId, presetName, winnerJson, itemsJson],
        );
        historyId = rows[0]?.id ?? null;
      }
    }
    // poolRows = массив всех кандидатов (до выбора победителя)
    // wheelItems = массив, который ты отправляешь на фронт (отрендерить колесо)
    // preset = строка из БД с weights/collections/media_types и т.п.
    // winner = выбранный объект

    function countBy(arr, keyFn) {
      const m = new Map();
      for (const x of arr || []) {
        const k = String(keyFn(x) ?? "");
        m.set(k, (m.get(k) || 0) + 1);
      }
      return Object.fromEntries([...m.entries()].sort((a, b) => b[1] - a[1]));
    }

    function normalizeWeightsObject(w) {
      // на всякий случай — чтобы увидеть именно объект ключ->число
      if (!w) return {};
      if (typeof w === "object" && !Array.isArray(w)) return w;
      return {};
    }

    const poolCountsByCategory = countBy(poolRows, (x) => x?.category_name);
    const poolCountsByMedia = countBy(poolRows, (x) => x?.media_type);

    const weightsObj = normalizeWeightsObject(preset?.weights);
    const weightKeys = Object.keys(weightsObj);

    // полезно: какие категории из пула НЕ имеют веса (значит будет fallback)
    const missingWeightKeys = Object.keys(poolCountsByCategory).filter(
      (k) => !(k in weightsObj),
    );

    // и наоборот: какие веса заданы, но в пуле таких категорий нет
    const unusedWeightKeys = weightKeys.filter(
      (k) => !(k in poolCountsByCategory),
    );

    const winnerOut = winnerWithW
      ? {
          ...winnerWithW,
          poster: winnerWithW.poster
            ? proxifyPoster(winnerWithW.poster, { w: 512, fmt: "webp" })
            : winnerWithW.poster,
        }
      : null;

    const wheelItemsOut = wheelItemsWithW.map((it) => ({
      ...it,
      poster: it?.poster
        ? proxifyPoster(it.poster, { w: 512, fmt: "webp" })
        : it?.poster,
    }));

    res.json({
      ok: true,
      preset_id: presetId,
      preset_name: preset.name || null,

      winner_id: winnerId,
      winner_index: winnerIndex,

      winner: winnerOut,
      wheel_items: wheelItemsOut,

      history_id: historyId,
      pool_total: allCandidates.length,

      wheel_size: wheelItemsWithW.length,
    });
  } catch (e) {
    console.error("[API] /wheel/api/random failed:", e);
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

/**
 * @openapi
 * /api/items:
 *   get:
 *     tags: [Wheel]
 *     summary: List items for preset (filtered by preset media_types + collections)
 *     parameters:
 *       - in: query
 *         name: preset_id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: OK }
 *       400: { description: Bad Request }
 *       404: { description: Not Found }
 */
app.get("/api/items", async (req, res) => {
  try {
    const presetId = String(req.query.preset_id || "").trim();
    if (!presetId)
      return res.status(400).json({ ok: false, error: "preset_id required" });

    const { rows: pres } = await pool.query(
      `select * from ${T_PRESETS} where id=$1 limit 1`,
      [presetId],
    );
    const preset = pres[0];
    if (!preset)
      return res.status(404).json({ ok: false, error: "preset not found" });

    const media_types = Array.isArray(preset.media_types)
      ? preset.media_types
      : [];
    const collections = Array.isArray(preset[PRESET_COL_COLLECTIONS])
      ? preset[PRESET_COL_COLLECTIONS]
      : [];

    // ✅ NEW: VC ids from preset
    const vcIds = Array.isArray(preset.virtual_collection_ids)
      ? preset.virtual_collection_ids
      : [];

    // --- items from view ---
    const { rows: itemRows } = await pool.query(
      `
      select *
        from wheel_items
       where media_type = any($1::text[])
         and category_name = any($2::text[])
       order by title asc
      `,
      [media_types, collections],
    );

    // --- VC rows ---
    let vcRows = [];
    if (vcIds.length) {
      const r = await pool.query(
        `
        select id, name, media, poster, source_label, source_url, created_at, updated_at
          from won_virtual_collections
         where id = any($1::text[])
         order by name asc
        `,
        [vcIds],
      );
      vcRows = r.rows || [];
    }

    function vcToWheelItem(vc) {
      return {
        id: String(vc.id),
        title: String(vc.name || "—"),
        name: String(vc.name || "—"),
        media_type: String(vc.media || "book"),
        category_name: "__virtual__",
        poster: vc.poster || "",
        source_label: vc.source_label || null,
        source_url: vc.source_url || null,
        __kind: "vc",
        __vc_id: String(vc.id),
      };
    }

    res.set("Cache-Control", "no-store");

    const outItems = (itemRows || []).map((it) => ({
      ...it,
      poster: it?.poster
        ? proxifyPoster(it.poster, { w: 256, fmt: "webp" })
        : it.poster,
    }));

    const outVcs = (vcRows || []).map(vcToWheelItem).map((it) => ({
      ...it,
      poster: it?.poster
        ? proxifyPoster(it.poster, { w: 256, fmt: "webp" })
        : it.poster,
    }));

    return res.json({ ok: true, rows: [...outItems, ...outVcs] });
  } catch (e) {
    console.error("[API] /wheel/api/items failed:", e);
    return res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

// ---- static frontend ----
// public/ — фронтенд
const PUBLIC_DIR = path.join(__dirname, "public");
app.use(express.static(PUBLIC_DIR));

// SPA fallback: всегда index.html из PUBLIC_DIR (кроме /wheel/api/*)
app.get(/^(?!\/api\/).*/, (req, res) => {
  res.sendFile("index.html", { root: PUBLIC_DIR }, (err) => {
    if (err) {
      console.error("[SPA] sendFile failed:", err);
      res.status(err.statusCode || 500).end();
    }
  });
});

// ---- start ----

await resolveSchema();

const PORT = process.env.PORT || 3000;
const HOST = "0.0.0.0";

app.listen(PORT, () => {
  console.log(`[BOOT] server listening on http://${HOST}:${PORT}`);
});
