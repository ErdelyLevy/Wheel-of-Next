// server.js
import "dotenv/config";
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { pool } from "./db.js";
import { clampInt } from "./utils.js";
import fs from "fs";
import fsp from "fs/promises";
import crypto from "crypto";
import sharp from "sharp";
import dns from "node:dns";

dns.setDefaultResultOrder("ipv4first");

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "2mb" }));

// ---- helpers ----
function proxifyPoster(posterUrl, { w = 512, fmt = "webp" } = {}) {
  const u = String(posterUrl || "").trim();
  if (!u) return "";
  return `/api/poster?u=${encodeURIComponent(u)}&w=${w}&fmt=${fmt}`;
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

// ---- poster cache ----
const POSTER_CACHE_DIR = path.join(__dirname, ".cache", "posters");
const POSTER_MAX_BYTES = 15 * 1024 * 1024; // 15MB safety per file

await fsp.mkdir(POSTER_CACHE_DIR, { recursive: true });

function sha1(s) {
  return crypto.createHash("sha1").update(String(s)).digest("hex");
}

// SSRF guard: разрешаем только https/http и только внешние хосты (без localhost/lan)
function isPrivateHost(hostname) {
  const h = String(hostname || "").toLowerCase();
  if (!h) return true;
  if (h === "localhost") return true;
  if (h.endsWith(".local")) return true;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) {
    // ipv4
    const parts = h.split(".").map((x) => Number(x));
    const [a, b] = parts;
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 169 && b === 254) return true;
  }
  return false;
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
    [name]
  );
  return !!rows.length;
}

async function getColumns(tableName) {
  const { rows } = await pool.query(
    `select column_name
     from information_schema.columns
     where table_schema='public' and table_name=$1
     order by ordinal_position`,
    [tableName]
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
    PRESET_COL_COLLECTIONS
  );
  console.log("[DB] history table:", T_HISTORY);
}

// ---- API ----
app.get("/api/health", async (req, res) => {
  try {
    await pool.query("select 1 as ok");
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

// META: dropdown data from view wheel_items
app.get("/api/meta", async (req, res) => {
  try {
    const media = await pool.query(
      `select distinct media_type from wheel_items where media_type is not null order by 1`
    );
    const cols = await pool.query(
      `select distinct category_name from wheel_items where category_name is not null order by 1`
    );

    res.json({
      ok: true,
      media_types: media.rows.map((r) => r.media_type),
      collections: cols.rows.map((r) => r.category_name),
    });
  } catch (e) {
    console.error("[API] /api/meta failed:", e);
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

// PRESETS
app.get("/api/presets", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `select * from ${T_PRESETS} order by created_at asc nulls last, name asc`
    );

    // нормализуем форму под фронт
    const presets = rows.map((p) => ({
      id: p.id,
      name: p.name,
      media_types: p.media_types ?? p.media ?? [],
      collections:
        p[PRESET_COL_COLLECTIONS] ?? p.categories ?? p.collections ?? [],
      weights: p.weights ?? {},
      created_at: p.created_at ?? null,
      updated_at: p.updated_at ?? null,
    }));

    res.json({ ok: true, presets });
  } catch (e) {
    console.error("[API] /api/presets failed:", e);
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

app.post("/api/presets", async (req, res) => {
  try {
    const body = req.body || {};

    const id = body.id ? String(body.id).trim() : null;
    const name = String(body.name || "").trim();
    const media_types = asTextArray(body.media_types ?? body.media);
    const collections = asTextArray(
      body.collections ?? body.categories ?? body.category_names
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

    // upsert by id (если нет id — create)
    if (id) {
      const { rows } = await pool.query(
        `
        update ${T_PRESETS}
           set name = $2,
               media_types = $3,
               ${colCollections} = $4,
               weights = $5,
               updated_at = now()
         where id = $1
         returning *
        `,
        [id, name, media_types, collections, weights]
      );

      if (rows[0]) {
        return res.json({ ok: true, preset: rows[0] });
      }

      // если id не найден — создаём с этим id (если колонка id допускает вставку)
      const ins = await pool.query(
        `
        insert into ${T_PRESETS} (id, name, media_types, ${colCollections}, weights, created_at, updated_at)
        values ($1, $2, $3, $4, $5, now(), now())
        returning *
        `,
        [id, name, media_types, collections, weights]
      );
      return res.json({ ok: true, preset: ins.rows[0] });
    }

    const { rows } = await pool.query(
      `
      insert into ${T_PRESETS} (name, media_types, ${colCollections}, weights, created_at, updated_at)
      values ($1, $2, $3, $4, now(), now())
      returning *
      `,
      [name, media_types, collections, weights]
    );

    res.json({ ok: true, preset: rows[0] });
  } catch (e) {
    console.error("[API] POST /api/presets failed:", e);
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

app.delete("/api/presets/:id", async (req, res) => {
  try {
    const id = String(req.params.id || "").trim();
    if (!id) return res.status(400).json({ ok: false, error: "id required" });

    await pool.query(`delete from ${T_PRESETS} where id = $1`, [id]);
    res.json({ ok: true });
  } catch (e) {
    console.error("[API] DELETE /api/presets failed:", e);
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

// HISTORY
app.get("/api/history", async (req, res) => {
  try {
    const limit = clampInt(req.query.limit, 1, 200, 50);
    const { rows } = await pool.query(
      `select * from ${T_HISTORY} order by created_at desc limit $1`,
      [limit]
    );
    res.json({ ok: true, rows });
  } catch (e) {
    console.error("[API] /api/history failed:", e);
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

app.get("/api/history/:id", async (req, res) => {
  try {
    const id = String(req.params.id || "").trim();
    if (!id) return res.status(400).json({ ok: false, error: "id required" });

    const { rows } = await pool.query(
      `select * from ${T_HISTORY} where id = $1 limit 1`,
      [id]
    );
    if (!rows[0])
      return res.status(404).json({ ok: false, error: "not found" });

    res.json({ ok: true, row: rows[0] });
  } catch (e) {
    console.error("[API] /api/history/:id failed:", e);
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

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
      [presetId]
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
    const { rows: poolRows } = await pool.query(
      `
      select *
        from wheel_items
       where media_type = any($1::text[])
         and category_name = any($2::text[])
      `,
      [media_types, collections]
    );
    if (!poolRows.length)
      return res
        .status(404)
        .json({ ok: false, error: "No items for this preset" });

    const weightFn = (it) => {
      const key = String(it?.category_name || "");
      const w = weights[key];
      return Number.isFinite(Number(w)) ? Math.max(0, Number(w)) : 1.0;
    };

    const winnerIndexInPool = weightedPickIndex(poolRows, weightFn);
    const winner = poolRows[winnerIndexInPool];
    const winnerId = winner?.id ?? null;

    // fillers
    const exclude = new Set();
    if (winnerId != null) exclude.add(String(winnerId));

    const fillers = poolRows.filter(
      (x) => x && x.id != null && !exclude.has(String(x.id))
    );
    shuffleInPlace(fillers);

    const wheelItems = [winner, ...fillers.slice(0, Math.max(0, size - 1))];
    shuffleInPlace(wheelItems);

    const winnerIndex = wheelItems.findIndex(
      (x) => String(x?.id) === String(winnerId)
    );

    // ✅ enrich wheel items with per-item weight (for drawing weighted wheel)
    const wheelItemsWithW = wheelItems.map((it) => {
      const w = weightFn(it);
      // возвращаем новый объект, чтобы не мутировать poolRows
      return { ...it, w };
    });

    // winner тоже лучше отдать с w (удобно на фронте)
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
          [presetId, presetName, winnerId, winnerJson, itemsJson]
        );
        historyId = rows[0]?.id ?? null;
      } else {
        const { rows } = await pool.query(
          `
          insert into ${T_HISTORY} (preset_id, preset_name, winner, wheel_items, created_at)
          values ($1, $2, $3::jsonb, $4::jsonb, now())
          returning id
          `,
          [presetId, presetName, winnerJson, itemsJson]
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

    // где-то внутри /api/random, когда уже есть poolRows/preset/winner/wheelItems:
    const poolCountsByCategory = countBy(poolRows, (x) => x?.category_name);
    const poolCountsByMedia = countBy(poolRows, (x) => x?.media_type);

    const weightsObj = normalizeWeightsObject(preset?.weights);
    const weightKeys = Object.keys(weightsObj);

    // полезно: какие категории из пула НЕ имеют веса (значит будет fallback)
    const missingWeightKeys = Object.keys(poolCountsByCategory).filter(
      (k) => !(k in weightsObj)
    );

    // и наоборот: какие веса заданы, но в пуле таких категорий нет
    const unusedWeightKeys = weightKeys.filter(
      (k) => !(k in poolCountsByCategory)
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
      pool_total: poolRows.length,
      wheel_size: wheelItemsWithW.length,
    });
  } catch (e) {
    console.error("[API] /api/random failed:", e);
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

app.get("/api/items", async (req, res) => {
  try {
    const presetId = String(req.query.preset_id || "").trim();
    if (!presetId)
      return res.status(400).json({ ok: false, error: "preset_id required" });

    const { rows: pres } = await pool.query(
      `select * from ${T_PRESETS} where id=$1 limit 1`,
      [presetId]
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

    const { rows } = await pool.query(
      `
      select *
        from wheel_items
       where media_type = any($1::text[])
         and category_name = any($2::text[])
       order by title asc
      `,
      [media_types, collections]
    );

    res.set("Cache-Control", "no-store");

    const out = rows.map((it) => ({
      ...it,
      poster: it?.poster
        ? proxifyPoster(it.poster, { w: 256, fmt: "webp" })
        : it.poster,
    }));
    return res.json({ ok: true, rows: out });

    return res.json({ ok: true, rows });
  } catch (e) {
    console.error("[API] /api/items failed:", e);
    return res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

app.get("/api/poster", async (req, res) => {
  try {
    const raw = String(req.query.u || "").trim();
    if (!raw) return res.status(400).send("u is required");

    let url;
    try {
      url = new URL(raw);
    } catch {
      return res.status(400).send("bad url");
    }

    if (!(url.protocol === "http:" || url.protocol === "https:")) {
      return res.status(400).send("bad protocol");
    }
    if (isPrivateHost(url.hostname)) {
      return res.status(403).send("forbidden host");
    }

    const { w, fmt } = normalizePosterParams(req.query);

    // ключ кэша: url + params
    const key = sha1(`${fmt}|w=${w}|${url.toString()}`);
    const filePath = path.join(POSTER_CACHE_DIR, `${key}.${fmt}`);
    const etag = `"${key}"`;

    // если клиент уже имеет
    if (req.headers["if-none-match"] === etag) {
      res.status(304).end();
      return;
    }

    // hit дискового кэша
    if (fs.existsSync(filePath)) {
      res.setHeader("Content-Type", `image/${fmt === "jpg" ? "jpeg" : fmt}`);
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      res.setHeader("ETag", etag);
      fs.createReadStream(filePath).pipe(res);
      return;
    }

    // --- miss: скачиваем ---
    const r = await fetch(url, {
      // чуть помогаем CDN
      headers: {
        "User-Agent": "WheelOfNext/1.0",
        Accept: "image/avif,image/webp,image/*,*/*;q=0.8",
      },
    });

    if (!r.ok) {
      return res.status(502).send(`upstream ${r.status}`);
    }

    const ab = await r.arrayBuffer();
    if (ab.byteLength <= 0) return res.status(502).send("empty image");
    if (ab.byteLength > POSTER_MAX_BYTES) {
      return res.status(413).send("image too large");
    }

    const buf = Buffer.from(ab);

    // ресайз + конверт
    let out;
    const img = sharp(buf, { failOn: "none" }).resize({
      width: w,
      withoutEnlargement: true,
    });

    if (fmt === "webp") out = await img.webp({ quality: 78 }).toBuffer();
    else if (fmt === "avif") out = await img.avif({ quality: 50 }).toBuffer();
    else if (fmt === "png")
      out = await img.png({ compressionLevel: 8 }).toBuffer();
    else out = await img.jpeg({ quality: 82 }).toBuffer();

    // сохранить на диск (атомарно)
    const tmp = filePath + "." + process.pid + ".tmp";
    await fsp.writeFile(tmp, out);
    await fsp.rename(tmp, filePath);

    res.setHeader("Content-Type", `image/${fmt === "jpg" ? "jpeg" : fmt}`);
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    res.setHeader("ETag", etag);
    res.end(out);
  } catch (e) {
    console.error("[API] /api/poster failed:", e);
    res.status(500).send("poster proxy failed");
  }
});

// ---- static frontend ----
// public/ — фронтенд
const PUBLIC_DIR = path.join(__dirname, "public");
app.use(express.static(PUBLIC_DIR));

// SPA fallback: всегда public/index.html (кроме /api/*)
app.get(/^(?!\/api\/).*/, (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

// ---- start ----
const PORT = Number(process.env.PORT || 3000);

await resolveSchema();
app.listen(PORT, () => {
  console.log(`[BOOT] server listening on http://localhost:${PORT}`);
});
