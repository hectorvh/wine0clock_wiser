# WineO'Clock

Monorepo: **backend** (Supabase Edge Functions) and one or more **frontends**. The backend is frontend-agnostic; the current app can be unplugged and a new one can be plugged in.

## Purpose

Wines that have been tasted are tracked: a photo of a bottle or label is captured, recognition results are returned (region, producer, type, vintage, etc.), and the result can optionally be saved as a **wine log** with geometry. Logs are stored in **Supabase** (Postgres/PostGIS) and can be published via **GeoServer** for the map. The map shows **consumption** (where wine was drunk) and **production** (where wines come from, with counts and top wine types per region).

## Workflow

1. **Capture & recognize**  
   A photo is taken or uploaded in the app. The **recognize-wine** Edge Function (Supabase) is called by the frontend; an external wine API (e.g. RapidAPI) is used to return wine metadata.

2. **Save log**  
   When save is triggered, the payload (metadata + optional image) is sent by the frontend to the **backend log server** (Node, port 3001). The record is enriched by the log server with region geometry (e.g. from a WFS wine-regions service), then **one row per log is persisted** into the Supabase **`wine_logs`** table (PostGIS). Optionally a local GeoJSON copy is written under `backend/post-requests/` for debugging. Label images can be uploaded to Supabase Storage and linked from `wine_logs`.

3. **Map data**  
   The **Production** tab of the map does **not** read `wine_logs` directly from Supabase. GeoJSON is requested from **GeoServer WFS** (layer `wine_logs`), which is backed by the same PostGIS data. The WFS response is used by the frontend to draw region polygons, aggregate frequency and top wine types per region, and show proportional symbols and outlines. If GeoServer is unavailable, a fallback to a local/regions GeoJSON source is used. **Consumption** tab data is derived from stored logs (e.g. via the log server or local sync).

4. **Optional GeoServer**  
   For the Production map to show data from GeoServer, GeoServer is run (e.g. on port 8080), a layer from the `wine_logs` table is published, and either the Vite proxy (`/geoserver` → GeoServer) is used in dev or `VITE_GEOSERVER_BASE_URL` is set for a remote GeoServer.

End-to-end: **photo → recognize-wine (Supabase) → log server → PostGIS + Storage → (optional) GeoServer WFS → map**.

## Structure

- **`backend/`** – Supabase config and Edge Functions (wine analysis, explorer, recognize). Same for all frontends.
- **`frontend/`** – Default web app (Vite, TypeScript, React, shadcn-ui, Tailwind). Can be replaced.

**→ Unplugging or adding a frontend:** see **[FRONTEND.md](./FRONTEND.md)** for step-by-step instructions and the backend API contract.

## Setup

Node.js and npm are required. From repo root:

```sh
npm install
npm run dev
```

- **`npm run dev`** – **Both** the frontend (port **8000**) and the backend log server (port 3001) are started. Every time **recognize-wine** is triggered in the app, the response is automatically sent to the log server and persisted to Supabase (and optionally a local GeoJSON copy is written in **`backend/post-requests/`** if `LOG_POST_DEBUG_EXPORT_GEOJSON` is set). If the log server is down, a console warning is shown and persistence may not occur.
- **`npm run dev:frontend`** – Only the frontend is run (no log server; no GeoJSON files).
- **`npm run build`** – The default frontend is built.
- **`npm run serve`** – Supabase functions are served locally (requires [Supabase CLI](https://supabase.com/docs/guides/cli)).
- **`npm run log`** – Only the backend log server (port 3001) is run. Used when the frontend is run separately and persistence and optional local GeoJSON are desired.

## How to set up `.env`

Environment variables are read by the app from a **`.env` file at the repo root**. The file is not committed (it’s in `.gitignore`). It should be set up before the app is run.

### 1. Create the file

A file named `.env` is created in the **repo root** (same folder as `package.json`).

### 2. Add the required variables

Copy the contents of **`.env.example`** and replace the placeholders with your project’s values:

```env
VITE_SUPABASE_PROJECT_ID="your-project-ref"
VITE_SUPABASE_URL="https://your-project-ref.supabase.co"
VITE_SUPABASE_PUBLISHABLE_KEY="your-anon-public-key"
```

### 3. Where to get the values

1. The project is opened in the [Supabase Dashboard](https://supabase.com/dashboard).
2. **Project Settings** (gear icon) → **API** is opened.
3. The following are copied:
   - **Project URL** → used as `VITE_SUPABASE_URL`
   - **anon public** key → used as `VITE_SUPABASE_PUBLISHABLE_KEY`
   - **Project ref** (in the dashboard URL or under “Reference ID”) → used as `VITE_SUPABASE_PROJECT_ID`

Example (replace with your real values):

```env
VITE_SUPABASE_PROJECT_ID="abcdefghijklmnop"
VITE_SUPABASE_URL="https://abcdefghijklmnop.supabase.co"
VITE_SUPABASE_PUBLISHABLE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6..."
```

### 4. For new collaborators

- **Option A:** The three values are sent securely by someone with access (e.g. password manager or secure channel). `.env` is created at the repo root by the collaborator and the values are pasted in.
- **Option B:** A separate Supabase project is created by the collaborator; the URL, anon key, and project ref are obtained from Dashboard → Settings → API, and are put in `.env`. (Wine analysis will work only after `RAPIDAPI_KEY` is set in that project’s Edge Function secrets.)

`.env` must not be committed or shared in chat or email.

## CI (GitHub Actions)

A workflow in **`.github/workflows/build.yml`** runs on every push to `main`: dependencies are installed and `npm run build` (frontend) is run. To use it, these **repository secrets** are added in GitHub (Settings → Secrets and variables → Actions):

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `VITE_SUPABASE_PROJECT_ID`

They are injected as env vars during the build so `import.meta.env.VITE_*` can be read by Vite.

Backend commands use **`backend/supabase/`**; Supabase CLI is run from **`backend/`**:

```sh
cd backend
supabase functions serve
# or: supabase functions deploy
```

## Environment variables

- **Frontend:** **`.env` at the repo root** is read by the app (see [How to set up `.env`](#how-to-set-up-env)). The **`VITE_`** prefix is used for variables read by the Vite app (e.g. `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_SUPABASE_PROJECT_ID`). Only `VITE_` vars are exposed to the client; this prefix must not be used for backend-only secrets.
- **Backend / Node:** No prefix is used (e.g. `LOG_POST_PORT`). `process.env.*` is read by the log server and other Node scripts; `VITE_` is not used.
- **Supabase Edge Functions (recognize-wine, etc.):** They run in Supabase’s cloud and read **Supabase secrets**, not the repo’s `.env`. Secrets are set in the [Supabase Dashboard](https://supabase.com/dashboard) under **Project → Edge Functions → Secrets**, or via CLI:
  ```sh
  cd backend
  supabase secrets set RAPIDAPI_KEY=your_key_here
  ```
  The recognize-wine function requires `RAPIDAPI_KEY` for the wine recognition API.

**Summary:** Frontend config is put in `.env` with `VITE_`; Edge Function secrets are put in Supabase (Dashboard or `supabase secrets set`). `.env` and real secrets must not be committed to the repo.

## PostGIS wine log persistence (no local GeoJSON by default)

Wine analysis logs are now persisted to Supabase Postgres/PostGIS via UPSERT instead of writing `.geojson` files locally.

### Required backend env vars

These are set for the backend log server process:

```env
SUPABASE_URL="https://<project-ref>.supabase.co"
SUPABASE_SERVICE_ROLE_KEY="<service-role-key>"
```

Optional debug export (OFF by default):

```env
LOG_POST_DEBUG_EXPORT_GEOJSON="1"
```

When enabled, a local debug GeoJSON copy is also written by the backend to `backend/post-requests/`.

### Apply DB migration

Supabase migration is run with:

```sh
cd backend
supabase db push
```

Migration file:

`backend/supabase/migrations/20260228160000_create_wine_logs.sql`

### Verify inserts

After a scan is run, inserts are verified in SQL:

```sql
select id, user_id, observed_at, source_file_name
from public.wine_logs
order by created_at desc
limit 20;
```

Map-ready flattened view:

```sql
select id, region, wine_type, year, score
from public.wine_logs_map
order by observed_at desc nulls last
limit 20;
```

## Map data: GeoServer WFS (Production tab)

Wine log geometries and attributes are loaded by the **Production** tab of the map from **GeoServer WFS** (not directly from the Supabase table). An interoperable OGC workflow and optional bbox-based loading are allowed.

### Frontend env (optional)

In **root `.env`** (or in CI):

```env
VITE_GEOSERVER_BASE_URL="https://your-geoserver-host/geoserver"
VITE_GEOSERVER_WORKSPACE="wine0clock"
```

- **Omitted:** In development the same origin path `/geoserver` is used by the app, and the Vite dev server proxies it to `http://localhost:8080/geoserver` (see `frontend/vite.config.ts`). GeoServer can be run on port 8080 and the frontend on port 8000 without CORS issues.
- **Set:** A full URL is used when GeoServer is on another host or in production (e.g. `https://geo.example.com/geoserver`).

### Expected GeoServer setup

- **Workspace:** `wine0clock` (or the value of `VITE_GEOSERVER_WORKSPACE`).
- **Layer:** A WFS-capable layer named `wine_logs` (e.g. type name `wine0clock:wine_logs`) whose data source is the PostGIS `wine_logs` table (or a view). GeoJSON is requested by the frontend via WFS 2.0 GetFeature with `outputFormat=application/json`.

### Validating that the map uses GeoServer

1. DevTools → **Network** is opened and filtered by XHR/fetch.
2. The map is loaded and the **Production** tab is switched to (or the map is panned/zoomed to trigger a refetch).
3. A request to `.../geoserver/.../wfs?service=WFS&request=GetFeature&typeNames=wine0clock:wine_logs...` is confirmed to return **200** with a GeoJSON FeatureCollection.
4. If that request is missing or fails, a fallback to `storage.fetchRegionsGeoJSON()` is used by the app and the message may be seen in the console. “Failed to fetch logs from GeoServer WFS” in the console.

## Creating a new Supabase Edge Function

1. **Add the function folder and handler**  
   `backend/supabase/functions/<name>/index.ts` is created and `Deno.serve(async (req) => { ... })` is used as the entry point. The file is started with:
   ```ts
   import "jsr:@supabase/functions-js/edge-runtime.d.ts";
   ```
   Edge Functions run on Deno (`jsr:` or `npm:` imports are used).

2. **Configure in `config.toml`**  
   In `backend/supabase/config.toml`, the following is added:
   ```toml
   [functions.<name>]
   verify_jwt = false
   ```
   `verify_jwt = false` is used for public/anonymous access (e.g. from the frontend with anon key).

3. **Link the project (if needed)**  
   From `backend/`:
   ```sh
   supabase link --project-ref <your-project-ref>
   ```

4. **Run locally**  
   ```sh
   cd backend
   supabase functions serve
   # or: supabase functions serve <name>
   ```

5. **Deploy**  
   ```sh
   cd backend
   supabase functions deploy <name>
   # or: supabase functions deploy
   ```

6. **Secrets**  
   If the function needs API keys, they are set in Supabase (Dashboard or `supabase secrets set KEY=value`), then read in the function with `Deno.env.get("KEY")`.

7. **Call from the frontend**  
   The Supabase client is used: `supabase.functions.invoke("<name>", { body: ... })`. The URL is derived from `VITE_SUPABASE_URL` in `.env`.

## Switching to a new Supabase project

To point the app and CLI at a different Supabase project:

1. The new project is created or opened in the [Supabase Dashboard](https://supabase.com/dashboard).
2. In the new project: **Project Settings** → **API** — **Project URL**, **anon public** key, and **Project ref** (from the dashboard URL) are copied.
3. **Root `.env`:** set `VITE_SUPABASE_PROJECT_ID`, `VITE_SUPABASE_URL`, and `VITE_SUPABASE_PUBLISHABLE_KEY` to the new project’s values.
4. **`backend/supabase/config.toml`:** `project_id = "<new-project-ref>"` is set.
5. **Re-link and redeploy:** from `backend/` run `supabase link --project-ref <new-project-ref>`, then set any secrets (e.g. `supabase secrets set RAPIDAPI_KEY=...`) and run `supabase functions deploy`.

Data (database, storage, auth) is per project; the new project starts empty unless migration is performed. Secrets must be set again for the new project.

## Access and security

- **403 when listing or deploying functions:** Access to that project may not be granted to the Supabase account (e.g. it was created by another account or org). The account that owns the project is used, the right org role is obtained, or a project that is owned is used and the existing function code is deployed there.
- **Sharing `.env`:** `.env` files must not be shared via chat or email. Instructions are preferred (e.g. “create a project and copy URL and anon key from Dashboard”) or a secure channel is used. `.env` is treated as private so a file that later contains real secrets is never accidentally shared.

## Tech stack (current frontend)

- Vite, TypeScript, React, shadcn-ui, Tailwind CSS
- Leaflet / React-Leaflet for the map; Production tab data from GeoServer WFS (with fallback to local/regions GeoJSON)
