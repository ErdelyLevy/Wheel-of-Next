// server.js
import "dotenv/config";
import express from "express";
import session from "express-session";
import path from "path";
import { fileURLToPath } from "url";
import { pool } from "./db.js";
import fs from "fs";
import fsp from "fs/promises";
import crypto from "crypto";
import dns from "node:dns";
import * as oidc from "openid-client";
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
app.set("trust proxy", 1);
app.use(express.json({ limit: "2mb" }));

const TRACE_HEADER = "x-trace-id";
const DEBUG_POSTER_LOGS = process.env.DEBUG_POSTER_LOGS === "true";
const SESSION_COOKIE_NAME = "won.sid";
const MEM_SNAPSHOT_PREFIX = "mem_";
const MEM_SNAPSHOT_TTL_MS = 60 * 60 * 1000;
const MEM_SNAPSHOT_MAX = 20;
const USER_TABLE = "user";

function requireEnv(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

function normalizePublicPrefix(prefix) {
  const value = String(prefix || "").trim();
  if (!value || value === "/") return "";
  const withSlash = value.startsWith("/") ? value : `/${value}`;
  return withSlash.endsWith("/") ? withSlash.slice(0, -1) : withSlash;
}

const APP_PUBLIC_ORIGIN = requireEnv("APP_PUBLIC_ORIGIN");
const APP_PUBLIC_PREFIX = normalizePublicPrefix(requireEnv("APP_PUBLIC_PREFIX"));
const PUBLIC_ROOT_PATH = APP_PUBLIC_PREFIX ? `${APP_PUBLIC_PREFIX}/` : "/";
const REDIRECT_URI = `${APP_PUBLIC_ORIGIN}${APP_PUBLIC_PREFIX}/auth/callback`;
const GOOGLE_CLIENT_ID = requireEnv("GOOGLE_CLIENT_ID");
const GOOGLE_CLIENT_SECRET = requireEnv("GOOGLE_CLIENT_SECRET");
const SESSION_SECRET = requireEnv("SESSION_SECRET");
const GUEST_OWNER_OIDC_ID = requireEnv("GUEST_OWNER_OIDC_ID");

const ryotUserIdByOidcId = new Map();

function nowIso() {
  return new Date().toISOString();
}

function logLine(level, msg, fields = {}) {
  const payload = { ts: nowIso(), level, msg, ...fields };
  const line = JSON.stringify(payload);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

function createTraceId() {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return crypto.randomBytes(16).toString("hex");
}

function getTraceId(req) {
  const incoming = req.get(TRACE_HEADER);
  if (incoming && String(incoming).trim()) return String(incoming).trim();
  return createTraceId();
}

function getRequestPath(req) {
  const raw = String(req?.originalUrl || "");
  const idx = raw.indexOf("?");
  return idx >= 0 ? raw.slice(0, idx) : raw;
}

function logError(req, msg, err, extra = {}) {
  const traceId = req?.traceId || req?.get?.(TRACE_HEADER) || "unknown";
  const payload = {
    trace_id: traceId,
    method: req?.method,
    path: getRequestPath(req),
    error: err?.message || String(err || ""),
    ...extra,
  };
  if (err?.stack) payload.stack = err.stack;
  logLine("error", msg, payload);
}

function isApiRequest(req) {
  const url = String(req?.originalUrl || "");
  return url.startsWith("/api/") || url.startsWith("/wheel/api/");
}

function isPosterRequest(req) {
  const path = getRequestPath(req);
  return path.endsWith("/api/poster");
}

function shouldLogRequest(req) {
  if (!isApiRequest(req)) return false;
  if (isPosterRequest(req) && !DEBUG_POSTER_LOGS) return false;
  return true;
}

app.use((req, res, next) => {
  const traceId = getTraceId(req);
  req.traceId = traceId;
  res.setHeader(TRACE_HEADER, traceId);

  const started = process.hrtime.bigint();
  res.on("finish", () => {
    if (!shouldLogRequest(req)) return;
    const durationMs = Number(process.hrtime.bigint() - started) / 1e6;
    const status = res.statusCode;
    const level = status >= 500 ? "error" : status >= 400 ? "warn" : "info";
    logLine(level, "request", {
      trace_id: traceId,
      method: req.method,
      path: getRequestPath(req),
      status,
      duration_ms: Math.round(durationMs),
    });
  });

  next();
});

app.use(
  session({
    name: SESSION_COOKIE_NAME,
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: "auto",
      sameSite: "lax",
      path: "/",
    },
  }),
);

const oidcConfig = await oidc.discovery(
  new URL("https://accounts.google.com"),
  GOOGLE_CLIENT_ID,
  {
    client_secret: GOOGLE_CLIENT_SECRET,
    redirect_uris: [REDIRECT_URI],
    response_types: ["code"],
  },
);

function buildExternalCallbackUrl(req) {
  const url = new URL(`${APP_PUBLIC_ORIGIN}${APP_PUBLIC_PREFIX}${req.path}`);
  const queryIndex = req.originalUrl.indexOf("?");
  if (queryIndex >= 0) url.search = req.originalUrl.slice(queryIndex);
  return url;
}

function requireAuth(req, res, next) {
  if (!req.session?.user)
    return res.status(401).json({ error: "unauthorized" });
  return next();
}

async function lookupRyotUserIdByOidcId(oidcId) {
  if (!oidcId) return null;
  if (ryotUserIdByOidcId.has(oidcId)) return ryotUserIdByOidcId.get(oidcId);

  try {
    const { rows } = await pool.query(
      `select id from "${USER_TABLE}" where oidc_issuer_id = $1 limit 1`,
      [oidcId],
    );
    const id = rows[0]?.id ?? null;
    ryotUserIdByOidcId.set(oidcId, id);
    return id;
  } catch (err) {
    logLine("error", "lookup_user_failed", {
      oidc_issuer_id: oidcId,
      error: err?.message || String(err || ""),
    });
    return null;
  }
}

async function resolveUserScope(req) {
  if (req.userScope) return req.userScope;

  const authOidcId = req.session?.user?.sub || null;
  const isGuest = !authOidcId;
  const oidcId = authOidcId || GUEST_OWNER_OIDC_ID;
  const ryotUserId = await lookupRyotUserIdByOidcId(oidcId);
  const dataUserId = oidcId;
  const dataUserIds =
    ryotUserId && ryotUserId !== dataUserId
      ? [dataUserId, ryotUserId]
      : [dataUserId];

  const scope = { oidcId, dataUserId, dataUserIds, ryotUserId, isGuest };
  req.userScope = scope;
  return scope;
}

async function requireAuthedUser(req, res, next) {
  if (!req.session?.user)
    return res.status(401).json({ error: "unauthorized" });
  const scope = await resolveUserScope(req);
  req.dataUserId = scope.dataUserId;
  req.dataUserIds = scope.dataUserIds;
  req.ryotUserId = scope.ryotUserId;
  return next();
}

function isAuthenticated(req) {
  return !!req.session?.user;
}

function isMemSnapshotId(id) {
  return typeof id === "string" && id.startsWith(MEM_SNAPSHOT_PREFIX);
}

function getMemSnapshotStore(req, { create = false } = {}) {
  if (!req.session) return null;
  if (!req.session.memSnapshots) {
    if (!create) return null;
    req.session.memSnapshots = {};
  }
  return req.session.memSnapshots;
}

function pruneMemSnapshots(store) {
  const now = Date.now();
  for (const [id, snap] of Object.entries(store)) {
    const createdAt = Number(snap?.createdAt || 0);
    if (!createdAt || now - createdAt > MEM_SNAPSHOT_TTL_MS) {
      delete store[id];
    }
  }

  const ids = Object.keys(store);
  if (ids.length <= MEM_SNAPSHOT_MAX) return;
  ids.sort(
    (a, b) => Number(store[a]?.createdAt || 0) - Number(store[b]?.createdAt || 0),
  );
  for (let i = 0; i < ids.length - MEM_SNAPSHOT_MAX; i++) {
    delete store[ids[i]];
  }
}

function createMemSnapshotId() {
  if (typeof crypto.randomUUID === "function")
    return `${MEM_SNAPSHOT_PREFIX}${crypto.randomUUID()}`;
  return `${MEM_SNAPSHOT_PREFIX}${crypto.randomBytes(8).toString("hex")}`;
}

function storeMemSnapshot(req, data) {
  const store = getMemSnapshotStore(req, { create: true });
  if (!store) return null;
  pruneMemSnapshots(store);
  const id = createMemSnapshotId();
  store[id] = { ...data, createdAt: Date.now() };
  return id;
}

function getMemSnapshot(req, id) {
  if (!isMemSnapshotId(id)) return null;
  const store = getMemSnapshotStore(req);
  if (!store) return null;
  const snap = store[id];
  if (!snap) return null;
  const createdAt = Number(snap?.createdAt || 0);
  if (!createdAt || Date.now() - createdAt > MEM_SNAPSHOT_TTL_MS) {
    delete store[id];
    return null;
  }
  return snap;
}

function deleteMemSnapshot(req, id) {
  if (!isMemSnapshotId(id)) return false;
  const store = getMemSnapshotStore(req);
  if (!store || !store[id]) return false;
  delete store[id];
  return true;
}

function clearSession(req, res) {
  if (!req.session) return res.redirect(PUBLIC_ROOT_PATH);
  req.session.destroy((err) => {
    if (err) logError(req, "auth_logout_failed", err);
    res.clearCookie(SESSION_COOKIE_NAME, { path: "/" });
    res.redirect(PUBLIC_ROOT_PATH);
  });
}

app.get("/auth/login", async (req, res) => {
  try {
    const state = oidc.randomState();
    const nonce = oidc.randomNonce();
    const codeVerifier = oidc.randomPKCECodeVerifier();
    const codeChallenge = await oidc.calculatePKCECodeChallenge(codeVerifier);
    req.session.oidc = { state, nonce, codeVerifier };

    const authUrl = oidc.buildAuthorizationUrl(oidcConfig, {
      scope: "openid email profile",
      redirect_uri: REDIRECT_URI,
      state,
      nonce,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
    });

    res.redirect(authUrl.href);
  } catch (err) {
    logError(req, "auth_login_failed", err);
    res.status(500).send("Auth failed");
  }
});

app.get("/auth/callback", async (req, res) => {
  try {
    const { state, nonce, codeVerifier } = req.session?.oidc || {};
    if (!state || !nonce || !codeVerifier)
      return res.status(400).send("Missing auth session");

    const currentUrl = buildExternalCallbackUrl(req);
    const tokenSet = await oidc.authorizationCodeGrant(
      oidcConfig,
      currentUrl,
      {
        expectedState: state,
        expectedNonce: nonce,
        pkceCodeVerifier: codeVerifier,
      },
      {
        redirect_uri: REDIRECT_URI,
      },
    );
    const claims = tokenSet.claims();
    if (!claims) throw new Error("Missing ID token claims");
    req.session.user = {
      sub: claims.sub,
      email: claims.email || null,
      name: claims.name || null,
    };
    delete req.session.oidc;
    return res.redirect(PUBLIC_ROOT_PATH);
  } catch (err) {
    delete req.session?.oidc;
    logError(req, "auth_callback_failed", err);
    return res.status(500).send("Auth failed");
  }
});

app.all("/auth/logout", (req, res) => {
  clearSession(req, res);
});

app.get("/api/me", requireAuth, (req, res) => {
  const { email, name, sub } = req.session.user;
  res.json({ email, name, sub });
});

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

function vcToWheelItem(vc) {
  return {
    id: String(vc.id),
    title: String(vc.name || "-"),
    name: String(vc.name || "-"),
    media_type: String(vc.media || "book"),
    category_name: "__virtual__",
    poster: vc.poster || "",
    source_label: vc.source_label || "",
    source_url: vc.source_url || "",
    __kind: "vc",
    __vc_id: String(vc.id),
  };
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

function itemKey(it) {
  if (it && (it.__kind === "vc" || it.__vc_id != null)) {
    const id = String(it.__vc_id || it.id || "").trim();
    return `vc:${id}`;
  }
  const id = String(it?.id ?? "").trim();
  return `it:${id}`;
}

function categoryKeyForItem(it) {
  if (it && (it.__kind === "vc" || it.__vc_id != null)) {
    const id = String(it.__vc_id || it.id || "").trim();
    return `vc:${id}`;
  }
  return String(it?.category_name || "").trim();
}

function normalizeCategoryWeights(categories, weightsObj) {
  const weights = new Map();
  const hasWeights = weightsObj && typeof weightsObj === "object";
  let total = 0;

  for (const c of categories) {
    const key = c.key;
    const hasKey = hasWeights && Object.hasOwn(weightsObj, key);
    let w = hasKey ? Number(weightsObj[key]) : 1;
    if (!Number.isFinite(w)) w = hasKey ? 0 : 1;
    w = Math.max(0, w);
    weights.set(key, w);
    total += w;
  }

  if (!(total > 0)) {
    total = categories.length || 1;
    for (const c of categories) weights.set(c.key, 1);
  }

  return { weights, total };
}

function allocateCategoryCounts(categories, size, weightsObj) {
  const out = new Map();
  const weightMap = new Map();
  if (!categories.length || !(size > 0)) return { counts: out, weights: weightMap };

  const { weights, total } = normalizeCategoryWeights(categories, weightsObj);

  const rows = categories.map((c) => {
    const w = weights.get(c.key) || 0;
    const raw = (size * w) / total;
    const base = Math.floor(raw);
    const rem = raw - base;
    return { key: c.key, base, rem, weight: w };
  });

  shuffleInPlace(rows);
  rows.sort((a, b) => b.rem - a.rem);

  let sum = rows.reduce((acc, r) => acc + r.base, 0);
  let left = size - sum;
  for (let i = 0; i < left; i++) {
    const row = rows[i % rows.length];
    row.base += 1;
  }

  for (const r of rows) {
    out.set(r.key, r.base);
    weightMap.set(r.key, r.weight);
  }

  return { counts: out, weights: weightMap };
}

function pickItemsForCategory(items, count, weight) {
  const out = [];
  if (!(count > 0)) return out;
  if (!items.length) return out;

  const pool = items.slice();
  shuffleInPlace(pool);

  for (let i = 0; i < count; i++) {
    const it = pool[i % pool.length];
    out.push({ ...it, w: weight });
  }
  return out;
}

function reorderNoAdjacent(items) {
  const buckets = new Map();
  for (const it of items) {
    const key = itemKey(it);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(it);
  }

  const entries = [];
  for (const [key, list] of buckets.entries()) {
    shuffleInPlace(list);
    entries.push({ key, list, count: list.length });
  }

  const res = [];
  let prevKey = null;

  while (entries.length) {
    entries.sort(
      (a, b) => b.count - a.count || (Math.random() < 0.5 ? -1 : 1),
    );
    let idx = entries.findIndex((e) => e.key !== prevKey);
    if (idx < 0) idx = 0;

    const bucket = entries[idx];
    res.push(bucket.list.pop());
    bucket.count -= 1;
    prevKey = bucket.key;

    if (bucket.count <= 0) entries.splice(idx, 1);
  }

  return res;
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
const T_VC = "won_virtual_collections";

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
let vcCols = new Set();
let PRESETS_HAS_USER_ID = false;
let HISTORY_HAS_USER_ID = false;
let VC_HAS_USER_ID = false;
let wheelItemsCols = new Set();
let WHEEL_ITEMS_HAS_USER_ID = false;

async function resolveSchema() {
  // prefer won_* if exists
  if (await tableExists("won_presets")) T_PRESETS = "won_presets";
  if (await tableExists("won_history")) T_HISTORY = "won_history";

  presetsCols = await getColumns(T_PRESETS);
  historyCols = await getColumns(T_HISTORY);
  if (await tableExists(T_VC)) {
    vcCols = await getColumns(T_VC);
  } else {
    vcCols = new Set();
  }
  if (await tableExists("wheel_items")) {
    wheelItemsCols = await getColumns("wheel_items");
  } else {
    wheelItemsCols = new Set();
  }

  PRESET_COL_COLLECTIONS = presetsCols.has("collections")
    ? "collections"
    : "categories";

  PRESETS_HAS_USER_ID = presetsCols.has("user_id");
  HISTORY_HAS_USER_ID = historyCols.has("user_id");
  VC_HAS_USER_ID = vcCols.has("user_id");
  WHEEL_ITEMS_HAS_USER_ID = wheelItemsCols.has("user_id");

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

  const userId = row.user_id ?? null;
  const { rows } = await client.query(
    VC_HAS_USER_ID && userId
      ? `
    select id, name, media, poster, source_label, source_url
      from ${T_VC}
     where id = any($1::text[]) and user_id = $2
    `
      : `
    select id, name, media, poster, source_label, source_url
      from ${T_VC}
     where id = any($1::text[])
    `,
    VC_HAS_USER_ID && userId ? [vcIds, userId] : [vcIds],
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

function parseWheelItems(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    const parsed = safeJsonParse(value);
    return Array.isArray(parsed) ? parsed : [];
  }
  return [];
}

async function buildWheelSnapshotFromPreset(
  preset,
  size,
  { itemsUserId = null, dataUserIds = [] } = {},
) {
  const media_types = asTextArray(preset.media_types);
  const collections = asTextArray(preset[PRESET_COL_COLLECTIONS]);
  const weightsObj = normalizeWeightsObject(preset.weights || {});
  const vcIds = asTextArray(preset.virtual_collection_ids);

  if (!collections.length && !vcIds.length) {
    return { wheelItems: [], poolTotal: 0 };
  }
  if (collections.length && !media_types.length) {
    return { wheelItems: [], poolTotal: 0 };
  }

  let poolRows = [];
  if (collections.length && media_types.length) {
    const pool = await pool.query(
      WHEEL_ITEMS_HAS_USER_ID
        ? `
    select *
      from wheel_items
     where user_id = $3
       and media_type = any($1::text[])
       and category_name = any($2::text[])
    `
        : `
    select *
      from wheel_items
     where media_type = any($1::text[])
       and category_name = any($2::text[])
    `,
      WHEEL_ITEMS_HAS_USER_ID
        ? [media_types, collections, itemsUserId]
        : [media_types, collections],
    );
    poolRows = pool.rows || [];
  }

  let vcRows = [];
  if (vcIds.length) {
    const r = await pool.query(
      VC_HAS_USER_ID
        ? `
      select id, name, media, poster, source_label, source_url, created_at, updated_at
        from ${T_VC}
       where id = any($1::text[]) and user_id = any($2::text[])
      `
        : `
      select id, name, media, poster, source_label, source_url, created_at, updated_at
        from ${T_VC}
       where id = any($1::text[])
      `,
      VC_HAS_USER_ID ? [vcIds, dataUserIds] : [vcIds],
    );
    vcRows = r.rows || [];
  }

  const itemsByCat = new Map();
  for (const it of poolRows) {
    const key = String(it?.category_name || "").trim();
    if (!key) continue;
    if (!itemsByCat.has(key)) itemsByCat.set(key, []);
    itemsByCat.get(key).push(it);
  }

  const categories = [];
  for (const c of collections) {
    const key = String(c);
    const items = itemsByCat.get(key);
    if (!items || !items.length) continue;
    categories.push({ key, items });
  }

  for (const vc of vcRows) {
    const id = String(vc.id);
    categories.push({ key: `vc:${id}`, items: [vcToWheelItem(vc)] });
  }

  if (!categories.length) {
    return { wheelItems: [], poolTotal: poolRows.length + vcRows.length };
  }

  const { counts, weights } = allocateCategoryCounts(categories, size, weightsObj);
  const selected = [];

  for (const c of categories) {
    const count = counts.get(c.key) || 0;
    const weight = weights.get(c.key) || 1;
    const picked = pickItemsForCategory(c.items, count, weight);
    selected.push(...picked);
  }

  const wheelItems = reorderNoAdjacent(selected);
  return { wheelItems, poolTotal: poolRows.length + vcRows.length };
}

async function insertHistorySnapshot({
  presetId,
  presetName,
  wheelItems,
  winnerItem,
  winnerId,
  baseHistoryId = null,
  dataUserId = null,
}) {
  const cols = [];
  const placeholders = [];
  const vals = [];
  let i = 1;

  function add(col, val, cast = "") {
    cols.push(col);
    if (val === "now()") {
      placeholders.push("now()");
      return;
    }
    placeholders.push(`$${i}${cast}`);
    vals.push(val);
    i++;
  }

  if (historyCols.has("preset_id")) add("preset_id", presetId);
  if (historyCols.has("preset_name")) add("preset_name", presetName);
  if (HISTORY_HAS_USER_ID && dataUserId) add("user_id", dataUserId);
  if (historyCols.has("wheel_items"))
    add("wheel_items", JSON.stringify(wheelItems || []), "::jsonb");
  if (historyCols.has("winner"))
    add("winner", JSON.stringify(winnerItem ?? null), "::jsonb");
  if (historyCols.has("winner_id")) add("winner_id", winnerId ?? null);
  if (historyCols.has("base_history_id") && baseHistoryId)
    add("base_history_id", baseHistoryId);
  if (historyCols.has("created_at")) add("created_at", "now()");
  if (historyCols.has("updated_at")) add("updated_at", "now()");

  const sql = `insert into ${T_HISTORY} (${cols.join(", ")})
               values (${placeholders.join(", ")})
               returning id`;
  const { rows } = await pool.query(sql, vals);
  return rows[0]?.id ?? null;
}

async function updateHistoryWinner(
  snapshotId,
  winnerItem,
  winnerId,
  dataUserIds = [],
) {
  const sets = [];
  const vals = [];
  let i = 1;

  if (historyCols.has("winner")) {
    sets.push(`winner = $${i}::jsonb`);
    vals.push(JSON.stringify(winnerItem));
    i++;
  }
  if (historyCols.has("winner_id")) {
    sets.push(`winner_id = $${i}`);
    vals.push(winnerId ?? null);
    i++;
  }
  if (historyCols.has("updated_at")) {
    sets.push("updated_at = now()");
  }

  if (!sets.length) return null;

  vals.push(snapshotId);
  let where = `id = $${i}`;
  if (HISTORY_HAS_USER_ID && dataUserIds.length) {
    i += 1;
    vals.push(dataUserIds);
    where += ` and user_id = any($${i}::text[])`;
  }
  const sql = `update ${T_HISTORY}
                 set ${sets.join(", ")}
               where ${where}
               returning id`;
  const { rows } = await pool.query(sql, vals);
  return rows[0]?.id ?? null;
}

function buildSnapshotCategories(items) {
  const map = new Map();

  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const key = categoryKeyForItem(it);
    if (!key) continue;

    if (!map.has(key)) {
      map.set(key, { key, weight: null, entries: [] });
    }

    const bucket = map.get(key);
    bucket.entries.push({ item: it, index: i });

    const w = Number(it?.w);
    if (Number.isFinite(w) && w > 0 && bucket.weight == null) {
      bucket.weight = w;
    }
  }

  const categories = [...map.values()];
  if (!categories.length) return [];

  let total = 0;
  for (const c of categories) {
    if (!(c.weight > 0)) c.weight = 1;
    total += c.weight;
  }

  if (!(total > 0)) {
    for (const c of categories) c.weight = 1;
  }

  return categories;
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
    const scope = await resolveUserScope(req);
    const dataUserIds = scope?.dataUserIds || [];
    if (VC_HAS_USER_ID && !dataUserIds.length)
      return res.json({ ok: true, rows: [] });

    const { rows } = await pool.query(
      VC_HAS_USER_ID
        ? `
  select id, name, media, poster, source_label, source_url, created_at, updated_at
    from ${T_VC}
   where user_id = any($1::text[])
   order by name asc
  `
        : `
  select id, name, media, poster, source_label, source_url, created_at, updated_at
    from ${T_VC}
   order by name asc
  `,
      VC_HAS_USER_ID ? [dataUserIds] : [],
    );

    res.json({ ok: true, rows });
  } catch (e) {
    logError(req, "api_virtual_collections_get_failed", e);
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
app.post("/api/virtual-collections", requireAuthedUser, async (req, res) => {
  try {
    const dataUserId = req.dataUserId;
    const dataUserIds = req.dataUserIds || [];
    const b = req.body || {};
    let id = toVcId(b.id);
    const name = normStr(b.name);
    const media = normStr(b.media);
    const poster = normStr(b.poster);
    const source_label = normStr(b.source_label ?? b.sourceLabel);
    const source_url = normStr(b.source_url ?? b.sourceUrl);

    if (!name)
      return res.status(400).json({ ok: false, error: "name required" });
    if (!media)
      return res.status(400).json({ ok: false, error: "media required" });
    if (!id && VC_HAS_USER_ID) {
      id = `vc_${String(dataUserId).replace(/[^a-z0-9]+/gi, "")}_${Date.now().toString(36)}_${crypto
        .randomBytes(4)
        .toString("hex")}`;
    }
    if (!id) return res.status(400).json({ ok: false, error: "id required" });

    const upsert = async (vcId) =>
      await pool.query(
        VC_HAS_USER_ID
          ? `
  insert into ${T_VC} (id, user_id, name, media, poster, source_label, source_url)
  values ($1, $2, $3, $4, nullif($5,''), nullif($6,''), nullif($7,''))
  on conflict (id) do update
    set name = excluded.name,
        media = excluded.media,
        poster = excluded.poster,
        source_label = excluded.source_label,
        source_url = excluded.source_url,
        updated_at = now()
  where ${T_VC}.user_id = any($8::text[])
  returning id, name, media, poster, source_label, source_url, created_at, updated_at
  `
          : `
  insert into ${T_VC} (id, name, media, poster, source_label, source_url)
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
        VC_HAS_USER_ID
          ? [
              vcId,
              dataUserId,
              name,
              media,
              poster,
              source_label,
              source_url,
              dataUserIds,
            ]
          : [vcId, name, media, poster, source_label, source_url],
      );

    let result = await upsert(id);
    if (!result.rows[0] && VC_HAS_USER_ID) {
      const exists = await pool.query(
        `select id from ${T_VC} where id = $1 limit 1`,
        [id],
      );
      if (exists.rowCount) {
        const newId = `vc_${String(dataUserId).replace(/[^a-z0-9]+/gi, "")}_${Date.now().toString(36)}_${crypto
          .randomBytes(4)
          .toString("hex")}`;
        result = await upsert(newId);
      }
    }

    if (!result.rows[0]) {
      return res.status(409).json({ ok: false, error: "conflict" });
    }
    res.json({ ok: true, row: result.rows[0] || null });
  } catch (e) {
    logError(req, "api_virtual_collections_post_failed", e);
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
app.delete("/api/virtual-collections/:id", requireAuthedUser, async (req, res) => {
  const id = toVcId(req.params.id);
  if (!id) return res.status(400).json({ ok: false, error: "id required" });
  const dataUserIds = req.dataUserIds || [];

  const client = await pool.connect();
  try {
    await client.query("begin");

    // 1) удаляем VC
    const del = await client.query(
      VC_HAS_USER_ID
        ? `delete from ${T_VC} where id = $1 and user_id = any($2::text[]) returning id`
        : `delete from ${T_VC} where id = $1 returning id`,
      VC_HAS_USER_ID ? [id, dataUserIds] : [id],
    );
    if (!del.rowCount) {
      if (VC_HAS_USER_ID) {
        const check = await client.query(
          `select id from ${T_VC} where id = $1 limit 1`,
          [id],
        );
        if (check.rowCount) {
          await client.query("rollback");
          return res.status(403).json({ ok: false, error: "forbidden" });
        }
      }
      await client.query("rollback");
      return res.status(404).json({ ok: false, error: "not found" });
    }

    // 2) чистим все пресеты, которые ссылались на неё
    await client.query(
      PRESETS_HAS_USER_ID
        ? `
      update ${T_PRESETS}
         set virtual_collection_ids =
             array_remove(virtual_collection_ids, $1)
       where $1 = any(virtual_collection_ids) and user_id = any($2::text[])
      `
        : `
      update ${T_PRESETS}
         set virtual_collection_ids =
             array_remove(virtual_collection_ids, $1)
       where $1 = any(virtual_collection_ids)
      `,
      PRESETS_HAS_USER_ID ? [id, dataUserIds] : [id],
    );

    await client.query("commit");
    res.json({ ok: true, id });
  } catch (e) {
    await client.query("rollback");
    logError(req, "api_virtual_collections_delete_failed", e);
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
      logError(req, "api_poster_fetch_failed", e);
      return res.status(st).json({ ok: false, error: msg });
    }

    // 4) отдаем с диска (а не buf) — чтобы не держать память
    res.set("Content-Type", ct || "application/octet-stream");
    res.set("Cache-Control", "public, max-age=31536000, immutable");
    return res.sendFile(key, { root: POSTER_CACHE_DIR });
  } catch (e) {
    const status = Number(e?.status) || 500;
    if (status >= 500) logError(req, "api_poster_failed", e);
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
    const scope = await resolveUserScope(req);
    const itemsUserId = scope?.ryotUserId || null;
    const media = await pool.query(
      `select distinct media_type from wheel_items where media_type is not null order by 1`,
    );
    let cols = { rows: [] };
    if (!WHEEL_ITEMS_HAS_USER_ID || itemsUserId) {
      cols = await pool.query(
        WHEEL_ITEMS_HAS_USER_ID
          ? `select distinct category_name from wheel_items where user_id = $1 and category_name is not null order by 1`
          : `select distinct category_name from wheel_items where category_name is not null order by 1`,
        WHEEL_ITEMS_HAS_USER_ID ? [itemsUserId] : [],
      );
    }

    res.json({
      ok: true,
      media_types: media.rows.map((r) => r.media_type),
      collections: cols.rows.map((r) => r.category_name),
    });
  } catch (e) {
    logError(req, "api_meta_failed", e);
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
    const scope = await resolveUserScope(req);
    const dataUserIds = scope?.dataUserIds || [];
    if (PRESETS_HAS_USER_ID && !dataUserIds.length) {
      return res.json({ ok: true, presets: [] });
    }

    const { rows } = await pool.query(
      PRESETS_HAS_USER_ID
        ? `select * from ${T_PRESETS} where user_id = any($1::text[]) order by created_at asc nulls last, name asc`
        : `select * from ${T_PRESETS} order by created_at asc nulls last, name asc`,
      PRESETS_HAS_USER_ID ? [dataUserIds] : [],
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
    logError(req, "api_presets_get_failed", e);
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
app.post("/api/presets", requireAuthedUser, async (req, res) => {
  try {
    const dataUserId = req.dataUserId;
    const dataUserIds = req.dataUserIds || [];
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
  if (!collections.length && !virtual_collection_ids.length)
    return res.status(400).json({
      ok: false,
      error: "collections or virtual_collection_ids is required",
    });

    const colCollections = PRESET_COL_COLLECTIONS;

    // ✅ имя колонки в БД
    const colVC = "virtual_collection_ids";

    // upsert by id (если нет id — create)
    if (id) {
      const { rows } = await pool.query(
        PRESETS_HAS_USER_ID
          ? `
        update ${T_PRESETS}
           set name = $2,
               media_types = $3,
               ${colCollections} = $4,
               ${colVC} = $5,
               weights = $6,
               updated_at = now()
         where id = $1 and user_id = any($7::text[])
         returning *
        `
          : `
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
        PRESETS_HAS_USER_ID
          ? [
              id,
              name,
              media_types,
              collections,
              virtual_collection_ids,
              weights,
              dataUserIds,
            ]
          : [id, name, media_types, collections, virtual_collection_ids, weights],
      );

      if (rows[0]) {
        return res.json({ ok: true, preset: rows[0] });
      }

      if (PRESETS_HAS_USER_ID) {
        const exists = await pool.query(
          `select id from ${T_PRESETS} where id = $1 limit 1`,
          [id],
        );
        if (exists.rowCount) {
          return res.status(403).json({ ok: false, error: "forbidden" });
        }
      }

      // если id не найден - создаём с этим id
      const ins = await pool.query(
        PRESETS_HAS_USER_ID
          ? `
        insert into ${T_PRESETS} (id, user_id, name, media_types, ${colCollections}, ${colVC}, weights, created_at, updated_at)
        values ($1, $2, $3, $4, $5, $6, $7, now(), now())
        returning *
        `
          : `
        insert into ${T_PRESETS} (id, name, media_types, ${colCollections}, ${colVC}, weights, created_at, updated_at)
        values ($1, $2, $3, $4, $5, $6, now(), now())
        returning *
        `,
        PRESETS_HAS_USER_ID
          ? [
              id,
              dataUserId,
              name,
              media_types,
              collections,
              virtual_collection_ids,
              weights,
            ]
          : [id, name, media_types, collections, virtual_collection_ids, weights],
      );
      return res.json({ ok: true, preset: ins.rows[0] });
    }

    const { rows } = await pool.query(
      PRESETS_HAS_USER_ID
        ? `
      insert into ${T_PRESETS} (user_id, name, media_types, ${colCollections}, virtual_collection_ids, weights, created_at, updated_at)
      values ($1, $2, $3, $4, $5, $6, now(), now())
      returning *
      `
        : `
      insert into ${T_PRESETS} (name, media_types, ${colCollections}, virtual_collection_ids, weights, created_at, updated_at)
      values ($1, $2, $3, $4, $5, now(), now())
      returning *
      `,
      PRESETS_HAS_USER_ID
        ? [
            dataUserId,
            name,
            media_types,
            collections,
            virtual_collection_ids,
            weights,
          ]
        : [name, media_types, collections, virtual_collection_ids, weights],
    );

    res.json({ ok: true, preset: rows[0] });
  } catch (e) {
    logError(req, "api_presets_post_failed", e);
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
app.delete("/api/presets/:id", requireAuthedUser, async (req, res) => {
  try {
    const id = String(req.params.id || "").trim();
    if (!id) return res.status(400).json({ ok: false, error: "id required" });

    const dataUserIds = req.dataUserIds || [];
    const result = await pool.query(
      PRESETS_HAS_USER_ID
        ? `delete from ${T_PRESETS} where id = $1 and user_id = any($2::text[])`
        : `delete from ${T_PRESETS} where id = $1`,
      PRESETS_HAS_USER_ID ? [id, dataUserIds] : [id],
    );
    if (!result.rowCount && PRESETS_HAS_USER_ID) {
      const exists = await pool.query(
        `select id from ${T_PRESETS} where id = $1 limit 1`,
        [id],
      );
      if (exists.rowCount) {
        return res.status(403).json({ ok: false, error: "forbidden" });
      }
      return res.status(404).json({ ok: false, error: "not found" });
    }
    res.json({ ok: true });
  } catch (e) {
    logError(req, "api_presets_delete_failed", e);
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
    const scope = await resolveUserScope(req);
    const dataUserIds = scope?.dataUserIds || [];
    if (HISTORY_HAS_USER_ID && !dataUserIds.length) {
      return res.json({ ok: true, rows: [] });
    }
    const limit = clampInt(req.query.limit, 1, 200, 50);
    const historyFilters = [];
    if (historyCols.has("winner_id")) {
      historyFilters.push("winner_id is not null");
    }
    if (historyCols.has("winner")) {
      historyFilters.push("winner is not null and winner <> 'null'::jsonb");
    }
    const whereWinner =
      historyFilters.length > 0
        ? `where (${historyFilters.join(" or ")})`
        : "";
    const whereUser = HISTORY_HAS_USER_ID
      ? whereWinner
        ? " and user_id = any($2::text[])"
        : "where user_id = any($2::text[])"
      : "";
    const sql = `select * from ${T_HISTORY} ${whereWinner}${whereUser} order by created_at desc limit $1`;
    const params = HISTORY_HAS_USER_ID ? [limit, dataUserIds] : [limit];
    const { rows } = await pool.query(sql, params);

    // обогащаем VC (можно параллельно)
    const out = await Promise.all(
      rows.map((r) => enrichVcInHistoryRow(pool, r)),
    );

    res.json({ ok: true, rows: out });
  } catch (e) {
    logError(req, "api_history_failed", e);
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

    const scope = await resolveUserScope(req);
    const dataUserIds = scope?.dataUserIds || [];
    if (HISTORY_HAS_USER_ID && !dataUserIds.length) {
      return res.status(404).json({ ok: false, error: "not found" });
    }

    const { rows } = await pool.query(
      HISTORY_HAS_USER_ID
        ? `select * from ${T_HISTORY} where id = $1 and user_id = any($2::text[]) limit 1`
        : `select * from ${T_HISTORY} where id = $1 limit 1`,
      HISTORY_HAS_USER_ID ? [id, dataUserIds] : [id],
    );
    if (!rows[0])
      return res.status(404).json({ ok: false, error: "not found" });

    const row = await enrichVcInHistoryRow(pool, rows[0]);
    res.json({ ok: true, row });
  } catch (e) {
    logError(req, "api_history_id_failed", e);
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

/**
 * @openapi
 * /api/random/begin:
 *   post:
 *     tags: [Wheel]
 *     summary: Build wheel snapshot (no winner)
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
 *     responses:
 *       200: { description: OK }
 *       400: { description: Bad Request }
 *       404: { description: Not Found }
 */
app.post("/api/random/begin", async (req, res) => {
  try {
    const body = req.body || {};
    const presetId = String(body.preset_id || body.presetId || "").trim();
    const size = clampInt(body.size, 3, 128, 18);
    const scope = await resolveUserScope(req);
    const dataUserId = scope?.dataUserId || null;
    const dataUserIds = scope?.dataUserIds || [];
    const itemsUserId = scope?.ryotUserId || null;

    if (!presetId)
      return res.status(400).json({ ok: false, error: "preset_id required" });

    const { rows: pres } = await pool.query(
      PRESETS_HAS_USER_ID
        ? `select * from ${T_PRESETS} where id = $1 and user_id = any($2::text[]) limit 1`
        : `select * from ${T_PRESETS} where id = $1 limit 1`,
      PRESETS_HAS_USER_ID ? [presetId, dataUserIds] : [presetId],
    );
    const preset = pres[0];
    if (!preset)
      return res.status(404).json({ ok: false, error: "preset not found" });

    const { wheelItems, poolTotal } = await buildWheelSnapshotFromPreset(
      preset,
      size,
      { itemsUserId, dataUserIds },
    );
    if (!wheelItems.length) {
      return res.status(404).json({
        ok: false,
        error: "No items or virtual collections for this preset",
      });
    }

    let snapshotId = null;
    if (isAuthenticated(req) && dataUserId) {
      snapshotId = await insertHistorySnapshot({
        presetId,
        presetName: preset.name || "",
        wheelItems,
        dataUserId,
      });
      if (!snapshotId) {
        return res.status(500).json({
          ok: false,
          error: "snapshot create failed",
        });
      }
    } else {
      snapshotId = storeMemSnapshot(req, {
        presetId,
        presetName: preset.name || "",
        wheelItems,
      });
      if (!snapshotId) {
        return res.status(500).json({
          ok: false,
          error: "snapshot create failed",
        });
      }
    }

    const wheelItemsOut = wheelItems.map((it) => ({
      ...it,
      poster: it?.poster
        ? proxifyPoster(it.poster, { w: 512, fmt: "webp" })
        : it?.poster,
    }));

    res.json({
      ok: true,
      snapshot_id: snapshotId,
      preset_id: presetId,
      preset_name: preset.name || null,
      wheel_items: wheelItemsOut,
      wheel_size: wheelItemsOut.length,
      pool_total: poolTotal,
    });
  } catch (e) {
    logError(req, "api_random_begin_failed", e);
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

/**
 * @openapi
 * /api/random/winner:
 *   post:
 *     tags: [Wheel]
 *     summary: Pick winner for snapshot
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               snapshot_id: { type: string }
 *               base_history_id: { type: string }
 *     responses:
 *       200: { description: OK }
 *       400: { description: Bad Request }
 *       404: { description: Not Found }
 */
app.post("/api/random/winner", async (req, res) => {
  try {
    const body = req.body || {};
    const snapshotId = String(body.snapshot_id || body.snapshotId || "").trim();
    const baseHistoryId = String(
      body.base_history_id || body.baseHistoryId || "",
    ).trim();
    const lookupId = baseHistoryId || snapshotId;
    const scope = await resolveUserScope(req);
    const dataUserIds = scope?.dataUserIds || [];

    if (!lookupId)
      return res.status(400).json({
        ok: false,
        error: "snapshot_id or base_history_id required",
      });

    let wheelItems = [];
    if (isMemSnapshotId(lookupId)) {
      const snap = getMemSnapshot(req, lookupId);
      if (!snap) return res.status(404).json({ ok: false, error: "not found" });
      wheelItems = Array.isArray(snap.wheelItems) ? snap.wheelItems : [];
    } else {
      if (HISTORY_HAS_USER_ID && !dataUserIds.length) {
        return res.status(404).json({ ok: false, error: "not found" });
      }
      const { rows } = await pool.query(
        HISTORY_HAS_USER_ID
          ? `select * from ${T_HISTORY} where id = $1 and user_id = any($2::text[]) limit 1`
          : `select * from ${T_HISTORY} where id = $1 limit 1`,
        HISTORY_HAS_USER_ID ? [lookupId, dataUserIds] : [lookupId],
      );
      const row = rows[0];
      if (!row) return res.status(404).json({ ok: false, error: "not found" });
      wheelItems = parseWheelItems(row.wheel_items);
    }
    if (!wheelItems.length) {
      return res.status(404).json({
        ok: false,
        error: "snapshot has no wheel_items",
      });
    }

    const categories = buildSnapshotCategories(wheelItems);
    if (!categories.length) {
      return res.status(404).json({
        ok: false,
        error: "snapshot has no categories",
      });
    }

    const pickedIdx = weightedPickIndex(categories, (c) => c.weight);
    const picked = categories[pickedIdx];
    const entry =
      picked.entries[Math.floor(Math.random() * picked.entries.length)];

    const winnerItem = entry?.item || null;
    const winnerIndex = entry?.index ?? -1;
    const winnerId = winnerItem?.id ?? null;

    const winnerOut = winnerItem
      ? {
          ...winnerItem,
          poster: winnerItem.poster
            ? proxifyPoster(winnerItem.poster, { w: 512, fmt: "webp" })
            : winnerItem.poster,
        }
      : null;

    res.json({
      ok: true,
      snapshot_id: lookupId,
      base_history_id: baseHistoryId || null,
      winner_id: winnerId,
      winner_index: winnerIndex,
      winner: winnerOut,
    });
  } catch (e) {
    logError(req, "api_random_winner_failed", e);
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

/**
 * @openapi
 * /api/random/commit:
 *   post:
 *     tags: [Wheel]
 *     summary: Commit winner to history
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [winner_index]
 *             properties:
 *               snapshot_id: { type: string }
 *               base_history_id: { type: string }
 *               winner_index: { type: integer }
 *     responses:
 *       200: { description: OK }
 *       400: { description: Bad Request }
 *       404: { description: Not Found }
 */
app.post("/api/random/commit", async (req, res) => {
  try {
    const body = req.body || {};
    const snapshotId = String(body.snapshot_id || body.snapshotId || "").trim();
    const baseHistoryId = String(
      body.base_history_id || body.baseHistoryId || "",
    ).trim();
    const winnerIndex = Number(body.winner_index ?? body.winnerIndex ?? -1);
    const scope = await resolveUserScope(req);
    const dataUserId = scope?.dataUserId || null;
    const dataUserIds = scope?.dataUserIds || [];

    const lookupId = baseHistoryId || snapshotId;
    if (!lookupId)
      return res.status(400).json({
        ok: false,
        error: "snapshot_id or base_history_id required",
      });
    if (!Number.isInteger(winnerIndex) || winnerIndex < 0) {
      return res
        .status(400)
        .json({ ok: false, error: "winner_index required" });
    }

    if (isMemSnapshotId(lookupId)) {
      const snap = getMemSnapshot(req, lookupId);
      if (!snap) return res.status(404).json({ ok: false, error: "not found" });
      const wheelItems = Array.isArray(snap.wheelItems) ? snap.wheelItems : [];
      const winnerItem = wheelItems[winnerIndex] || null;
      if (!winnerItem) {
        return res
          .status(404)
          .json({ ok: false, error: "winner item not found" });
      }
      return res.json({ ok: true, history_id: null });
    }

    if (!isAuthenticated(req) || !dataUserId) {
      return res.json({ ok: true, history_id: null });
    }

    const { rows } = await pool.query(
      HISTORY_HAS_USER_ID
        ? `select * from ${T_HISTORY} where id = $1 and user_id = any($2::text[]) limit 1`
        : `select * from ${T_HISTORY} where id = $1 limit 1`,
      HISTORY_HAS_USER_ID ? [lookupId, dataUserIds] : [lookupId],
    );
    const row = rows[0];
    if (!row) return res.status(404).json({ ok: false, error: "not found" });

    const wheelItems = parseWheelItems(row.wheel_items);
    const winnerItem = wheelItems[winnerIndex] || null;
    if (!winnerItem) {
      return res
        .status(404)
        .json({ ok: false, error: "winner item not found" });
    }

    const winnerId = winnerItem?.id ?? null;
    let historyId = null;

    if (baseHistoryId) {
      historyId = await insertHistorySnapshot({
        presetId: row.preset_id ?? null,
        presetName: row.preset_name ?? null,
        wheelItems,
        winnerItem,
        winnerId,
        baseHistoryId,
        dataUserId,
      });
    } else {
      historyId = await updateHistoryWinner(
        snapshotId,
        winnerItem,
        winnerId,
        dataUserIds,
      );
    }

    res.json({ ok: true, history_id: historyId });
  } catch (e) {
    logError(req, "api_random_commit_failed", e);
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

/**
 * @openapi
 * /api/random/abort:
 *   post:
 *     tags: [Wheel]
 *     summary: Delete pending snapshot (no winner)
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [snapshot_id]
 *             properties:
 *               snapshot_id: { type: string }
 *     responses:
 *       200: { description: OK }
 *       400: { description: Bad Request }
 *       404: { description: Not Found }
 *       409: { description: Conflict }
 */
app.post("/api/random/abort", async (req, res) => {
  try {
    const body = req.body || {};
    const snapshotId = String(body.snapshot_id || body.snapshotId || "").trim();
    const scope = await resolveUserScope(req);
    const dataUserId = scope?.dataUserId || null;
    const dataUserIds = scope?.dataUserIds || [];
    if (!snapshotId)
      return res
        .status(400)
        .json({ ok: false, error: "snapshot_id required" });

    if (isMemSnapshotId(snapshotId)) {
      const deleted = deleteMemSnapshot(req, snapshotId);
      return res.json({ ok: true, deleted });
    }

    if (!isAuthenticated(req) || !dataUserId) {
      return res.status(401).json({ ok: false, error: "unauthorized" });
    }

    const { rows } = await pool.query(
      HISTORY_HAS_USER_ID
        ? `select * from ${T_HISTORY} where id = $1 and user_id = any($2::text[]) limit 1`
        : `select * from ${T_HISTORY} where id = $1 limit 1`,
      HISTORY_HAS_USER_ID ? [snapshotId, dataUserIds] : [snapshotId],
    );
    const row = rows[0];
    if (!row) return res.status(404).json({ ok: false, error: "not found" });

    let hasWinner = false;
    if (historyCols.has("winner_id") && row.winner_id != null) {
      hasWinner = true;
    }
    if (historyCols.has("winner")) {
      let w = row.winner;
      if (typeof w === "string") w = safeJsonParse(w);
      if (w) hasWinner = true;
    }

    if (hasWinner) {
      return res
        .status(409)
        .json({ ok: false, error: "snapshot has winner" });
    }

    await pool.query(
      HISTORY_HAS_USER_ID
        ? `delete from ${T_HISTORY} where id = $1 and user_id = any($2::text[])`
        : `delete from ${T_HISTORY} where id = $1`,
      HISTORY_HAS_USER_ID ? [snapshotId, dataUserIds] : [snapshotId],
    );
    res.json({ ok: true, deleted: true });
  } catch (e) {
    logError(req, "api_random_abort_failed", e);
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
    const scope = await resolveUserScope(req);
    const dataUserId = scope?.dataUserId || null;
    const dataUserIds = scope?.dataUserIds || [];
    const itemsUserId = scope?.ryotUserId || null;
    const shouldSave = save && isAuthenticated(req) && dataUserId;

    if (!presetId)
      return res.status(400).json({ ok: false, error: "preset_id required" });

    const { rows: pres } = await pool.query(
      PRESETS_HAS_USER_ID
        ? `select * from ${T_PRESETS} where id = $1 and user_id = any($2::text[]) limit 1`
        : `select * from ${T_PRESETS} where id = $1 limit 1`,
      PRESETS_HAS_USER_ID ? [presetId, dataUserIds] : [presetId],
    );
    const preset = pres[0];
    if (!preset)
      return res.status(404).json({ ok: false, error: "preset not found" });

    const media_types = asTextArray(preset.media_types);
    const collections = asTextArray(preset[PRESET_COL_COLLECTIONS]);
    const weights = normalizeWeightsObject(preset.weights || {});

    // Pool from view
    // берём ещё vcIds из пресета
    const vcIds = asTextArray(preset.virtual_collection_ids);

    if (!media_types.length && collections.length) {
      return res.status(400).json({
        ok: false,
        error: "preset has empty media_types",
      });
    }
    if (!collections.length && !vcIds.length) {
      return res.status(400).json({
        ok: false,
        error: "preset has empty collections and vc",
      });
    }

    // Pool from view (обычные Items)
    const { rows: poolRows } = await pool.query(
      WHEEL_ITEMS_HAS_USER_ID
        ? `
  select *
    from wheel_items
   where user_id = $3
     and media_type = any($1::text[])
     and category_name = any($2::text[])
  `
        : `
  select *
    from wheel_items
   where media_type = any($1::text[])
     and category_name = any($2::text[])
  `,
      WHEEL_ITEMS_HAS_USER_ID
        ? [media_types, collections, itemsUserId]
        : [media_types, collections],
    );

    // Virtual collections rows (VC)
    let vcRows = [];
    if (vcIds.length) {
      const r = await pool.query(
        VC_HAS_USER_ID
          ? `
select id, name, media, poster, source_label, source_url, created_at, updated_at
  from ${T_VC}
 where id = any($1::text[]) and user_id = any($2::text[])

    `
          : `
select id, name, media, poster, source_label, source_url, created_at, updated_at
  from ${T_VC}
 where id = any($1::text[])

    `,
        VC_HAS_USER_ID ? [vcIds, dataUserIds] : [vcIds],
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
    if (shouldSave) {
      const presetName = preset.name || "";
      const winnerJson = JSON.stringify(winnerWithW);
      const itemsJson = JSON.stringify(wheelItemsWithW);

      // поддержка разных схем history (winner_id может отсутствовать)
      if (historyCols.has("winner_id")) {
        const { rows } = await pool.query(
          `
          insert into ${T_HISTORY} (${HISTORY_HAS_USER_ID ? "user_id, " : ""}preset_id, preset_name, winner_id, winner, wheel_items, created_at)
          values (${HISTORY_HAS_USER_ID ? "$6, " : ""}$1, $2, $3, $4::jsonb, $5::jsonb, now())
          returning id
          `,
          HISTORY_HAS_USER_ID
            ? [
                presetId,
                presetName,
                winnerId,
                winnerJson,
                itemsJson,
                dataUserId,
              ]
            : [presetId, presetName, winnerId, winnerJson, itemsJson],
        );
        historyId = rows[0]?.id ?? null;
      } else {
        const { rows } = await pool.query(
          `
          insert into ${T_HISTORY} (${HISTORY_HAS_USER_ID ? "user_id, " : ""}preset_id, preset_name, winner, wheel_items, created_at)
          values (${HISTORY_HAS_USER_ID ? "$5, " : ""}$1, $2, $3::jsonb, $4::jsonb, now())
          returning id
          `,
          HISTORY_HAS_USER_ID
            ? [presetId, presetName, winnerJson, itemsJson, dataUserId]
            : [presetId, presetName, winnerJson, itemsJson],
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
    logError(req, "api_random_failed", e);
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

    const scope = await resolveUserScope(req);
    const dataUserIds = scope?.dataUserIds || [];
    const itemsUserId = scope?.ryotUserId || null;
    if (PRESETS_HAS_USER_ID && !dataUserIds.length) {
      return res.status(404).json({ ok: false, error: "preset not found" });
    }

    const { rows: pres } = await pool.query(
      PRESETS_HAS_USER_ID
        ? `select * from ${T_PRESETS} where id=$1 and user_id = any($2::text[]) limit 1`
        : `select * from ${T_PRESETS} where id=$1 limit 1`,
      PRESETS_HAS_USER_ID ? [presetId, dataUserIds] : [presetId],
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
      WHEEL_ITEMS_HAS_USER_ID
        ? `
      select *
        from wheel_items
       where user_id = $3
         and media_type = any($1::text[])
         and category_name = any($2::text[])
       order by title asc
      `
        : `
      select *
        from wheel_items
       where media_type = any($1::text[])
         and category_name = any($2::text[])
       order by title asc
      `,
      WHEEL_ITEMS_HAS_USER_ID
        ? [media_types, collections, itemsUserId]
        : [media_types, collections],
    );

    // --- VC rows ---
    let vcRows = [];
    if (vcIds.length) {
      const r = await pool.query(
        VC_HAS_USER_ID
          ? `
        select id, name, media, poster, source_label, source_url, created_at, updated_at
          from ${T_VC}
         where id = any($1::text[]) and user_id = any($2::text[])
         order by name asc
        `
          : `
        select id, name, media, poster, source_label, source_url, created_at, updated_at
          from ${T_VC}
         where id = any($1::text[])
         order by name asc
        `,
        VC_HAS_USER_ID ? [vcIds, dataUserIds] : [vcIds],
      );
      vcRows = r.rows || [];
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
    logError(req, "api_items_failed", e);
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
      logError(req, "spa_sendfile_failed", err);
      res.status(err.statusCode || 500).end();
    }
  });
});

// ---- start ----

await resolveSchema();

const PORT = process.env.PORT || 3000;
const HOST = "0.0.0.0";

app.listen(PORT, () => {
  logLine("info", "server_listening", { host: HOST, port: PORT });
});

