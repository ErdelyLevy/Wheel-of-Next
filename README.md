# Wheel of Next

Wheel of Next is a web app with a decision wheel that uses real Ryot data. It lets you build presets and virtual collections to pick the next movie, series, or game.

## Features

- Interactive canvas wheel
- Weighted random selection
- Presets with media, collections, and weights
- Virtual collections (VC)
- Spin history (for authenticated users)
- Guest mode: rolls work without login, but no history save

## Quick start

1) Install dependencies:

```bash
npm install
```

2) Create `.env`:

```env
# Public origin/prefix
APP_PUBLIC_ORIGIN=http://localhost:3000
APP_PUBLIC_PREFIX=

# Google OIDC
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
SESSION_SECRET=change_me

# OIDC sub for the guest data owner (your Google sub)
GUEST_OWNER_OIDC_ID=...

# Postgres (Ryot DB)
PGHOST=localhost
PGPORT=5432
PGUSER=postgres
PGPASSWORD=postgres
PGDATABASE=postgres
PGSSL=false
PGSSL_REJECT_UNAUTHORIZED=true
```

3) Run:

```bash
npm start
```

Open `http://localhost:3000`.

## Auth

Google OpenID Connect (Authorization Code). Internal routes:
- `GET /auth/login`
- `GET /auth/callback`
- `GET|POST /auth/logout`
- `GET /api/me`

Sessions are stored in HttpOnly cookies. The external callback URL is built as:

```
${APP_PUBLIC_ORIGIN}${APP_PUBLIC_PREFIX}/auth/callback
```

## Reverse proxy (/wheel)

If the app is served under `/wheel`, set:

```
APP_PUBLIC_PREFIX=/wheel
```

External URLs are `/wheel/auth/*`, while Express routes remain `/auth/*`.

## Database

The app uses the Ryot database:
- `user` table contains `oidc_issuer_id` to map OIDC sub -> ryot user id
- media items come from `wheel_items` view (must include `user_id` for filtering)
- presets/history use `won_presets` / `won_history` if they exist, otherwise `wheel_presets` / `wheel_history`
- virtual collections are stored in `won_virtual_collections`

Example `wheel_items` view (note `c.user_id AS user_id`):

```sql
CREATE OR REPLACE VIEW public.wheel_items AS
SELECT
  m.id,
  m.id AS meta_id,
  m.title,
  lower(m.lot) AS media_type,
  c.name AS category_name,
  m.description,
  m.publish_year,
  m.provider_rating,
  m.production_status,
  m.source,
  m.source_url,
  (m.assets -> 'remote_images') ->> 0 AS poster,
  NULLIF((m.show_specifics ->> 'total_seasons')::integer, 0) AS total_seasons,
  NULLIF((m.show_specifics ->> 'total_episodes')::integer, 0) AS total_episodes,
  NULLIF((m.anime_specifics ->> 'episodes')::integer, 0) AS anime_episodes,
  NULLIF((m.book_specifics ->> 'pages')::integer, 0) AS pages,
  (
    SELECT COALESCE(array_agg(DISTINCT pr.value ->> 'name'), ARRAY[]::text[])
    FROM jsonb_array_elements(COALESCE(m.video_game_specifics -> 'platform_releases', '[]'::jsonb)) pr(value)
    WHERE pr.value ? 'name'
  ) AS platforms,
  c.user_id AS user_id
FROM metadata m
JOIN collection_to_entity cte ON cte.metadata_id = m.id
JOIN collection c ON c.id = cte.collection_id;
```

If PG* variables are not set, the server uses `data/items.json` as a read-only source for `wheel_items`.

## API docs

Swagger UI is available at `/docs`.

## Development

- Node.js (ESM, no TypeScript)
- Scripts:
  - `npm start`
  - `npm run lint`
