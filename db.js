import pg from "pg";
import fs from "fs/promises";
import path from "path";

function must(name) {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

function hasPgConfig() {
  return !!(process.env.PGHOST && process.env.PGUSER && process.env.PGPASSWORD && process.env.PGDATABASE);
}

let pool;

if (hasPgConfig()) {
  pool = new pg.Pool({
    host: must("PGHOST"),
    port: Number(process.env.PGPORT || 5432),
    user: must("PGUSER"),
    password: must("PGPASSWORD"),
    database: must("PGDATABASE"),

    // если на удалённой БД требуется SSL — включай PGSSL=true
    ssl: process.env.PGSSL === "true"
      ? { rejectUnauthorized: process.env.PGSSL_REJECT_UNAUTHORIZED !== "false" }
      : false,
  });
} else {
  // Fallback: если PG не настроен (локальная разработка), предоставим простую
  // заглушку pool.query, которая умеет возвращать данные из data/items.json.
  console.warn('[DB] PG env vars not set — using file-based fallback (data/items.json)');

  pool = {
    query: async (sql) => {
      const itemsPath = path.join(process.cwd(), 'data', 'items.json');
      try {
        const raw = await fs.readFile(itemsPath, 'utf8');
        const rows = JSON.parse(raw || '[]');
        if (/select\s+\*\s+from\s+wheel_items/i.test(sql)) {
          return { rows };
        }
        // Для других SQL-запросов пока возвращаем пустой набор
        return { rows: [] };
      } catch (e) {
        // Если файл не найден или JSON битый — вернём пустой массив
        return { rows: [] };
      }
    }
  };
}

export { pool };
