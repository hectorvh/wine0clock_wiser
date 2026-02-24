# Frontend swap guide

This doc explains how to **unplug** the current frontend and **plug in** a new one. The backend stays the same; only the app that calls it changes.

---

## 1. Unplugging the current frontend

To remove or replace the default frontend:

### Option A: Remove it from the repo (e.g. you’re replacing it)

1. **Stop using it in root scripts**  
   Edit root `package.json` and remove the `frontend` workspace and any scripts that point to it (`dev`, `build`, `lint`, `preview`, `test`). Leave only `serve` (backend) if you still need it.

2. **Optional: remove the folder**  
   Delete or rename the `frontend/` directory (e.g. `frontend-old/` or remove it).

3. **Update workspaces**  
   In root `package.json`, set `"workspaces": ["backend"]` (or add your new app name when you add it).

### Option B: Keep it but stop using it as default

1. In root `package.json`, change scripts so they don’t run the current frontend. For example, point `dev` and `build` to another workspace (your new frontend), or remove those scripts until the new app is ready.

2. Leave `frontend` in `workspaces` if you still want to run it sometimes:  
   `npm run dev -w frontend` from root, or `cd frontend && npm run dev`.

---

## 2. Backend API contract (what any frontend must use)

Any new frontend must talk to the same backend in this way.

### Environment variables

The app needs these (e.g. in `.env` or your host’s config). Vite uses `VITE_` prefix:

| Variable | Description |
|----------|-------------|
| `VITE_SUPABASE_URL` | Supabase project URL, e.g. `https://<project-ref>.supabase.co` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Supabase anon/public key (for Edge Functions) |

Optional:

- `VITE_SUPABASE_PROJECT_ID` – project ref, if your app uses it.
- `VITE_LOG_POST_URL` – URL of the backend log server for saving request/response as GeoJSON (default `http://localhost:3001/log-post`). Run **`npm run log -w backend`** (or `npm run log` from root) so the backend writes to `backend/post-requests/`. Any frontend can use this.

### Supabase client

- Install `@supabase/supabase-js`.
- Create a client with the URL and publishable key above. No database or auth config is required if you only call Edge Functions.

### Wine analysis (main flow)

- **Function name:** `recognize-wine`
- **Invoke:** `supabase.functions.invoke(functionUrl, options)`
- **URL:** `recognize-wine?mode=<mode>&lang=<lang>`
  - `mode`: `analyzer` or `recognition_explorer`
  - `lang`: e.g. `en`
- **Body:** `FormData` with one field:
  - `file`: the image file (JPEG, PNG, or WebP; max 10MB)
- **Response:** JSON matching the normalized wine result shape below (or `{ error: string }` on failure).

### Normalized wine result shape (TypeScript-friendly)

```ts
interface NormalizedWineResult {
  mode: "analyzer" | "recognition_explorer";
  wine: {
    full_name: string | null;
    producer: string | null;
    winery: string | null;
    winery_description: string | null;
    region_name: string | null;
    country: string | null;
    wine_type: string | null;
    vintage: string | null;
    grape_variety: string | null;
    average_price_usd: number | null;
  };
  sensory: {
    aroma: string | null;
    tasting_notes: string | null;
    food_pairing: string | null;
  };
  serving: {
    temp_min_c: number | null;
    temp_max_c: number | null;
    decanting_minutes: number | null;
  };
  ratings: {
    avg_rating: number | null;
    reviews: number | null;
    source: string | null;
  };
  debug: {
    confidence: number | null;
    selected_id: string | null;
    errors: string[];
    raw?: unknown;
  };
  /** GeoJSON FeatureCollection for wine region geometry (WFS), when region_name matched. */
  region_geojson?: { type: "FeatureCollection"; features: unknown[] } | null;
}
```

### Minimal example (any frontend)

```ts
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
);

// Analyze wine from image
const formData = new FormData();
formData.append("file", imageFile);
const params = new URLSearchParams({ mode: "analyzer", lang: "en" });
const { data, error } = await supabase.functions.invoke(
  `recognize-wine?${params}`,
  { body: formData }
);
if (error) throw new Error(error.message);
if (data?.error) throw new Error(data.error);
// data is NormalizedWineResult
```

Other backend functions (e.g. `wine-analyzer`, `wine-explorer`) live under `backend/supabase/functions/`. Their URLs and request/response shapes are defined there; use the same Supabase URL and key to invoke them.

---

## 3. Plugging in a new frontend

When your new app is ready to become the default:

1. **Put the app in the repo**  
   e.g. `frontend-web/`, `mobile/`, `admin/` — any folder name.

2. **Add env**  
   In that folder, add a `.env` (or equivalent) with `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` (same values as the current frontend, or from your Supabase project settings).

3. **Implement the contract**  
   Use the Supabase client and the `recognize-wine` invoke (and any other functions you need) as in the “Backend API contract” section above.

4. **Register the workspace**  
   In root `package.json`, add your app folder to `workspaces`, e.g.  
   `"workspaces": ["frontend", "backend", "frontend-web"]`  
   (you can keep or drop `frontend` depending on whether you unplugged it).

5. **Wire root scripts to the new app**  
   Point root scripts at the new workspace, e.g.  
   `"dev": "npm run dev -w frontend-web"`,  
   `"build": "npm run build -w frontend-web"`,  
   and same for `lint`, `preview`, `test` if you use them.

6. **Install and run**  
   From repo root: `npm install` then `npm run dev` (or `npm run build`). Backend is unchanged: still `npm run serve -w backend` (or `cd backend && supabase functions serve`).

---

## 4. Quick reference

| Goal | Action |
|------|--------|
| Stop using current frontend | Remove or repoint root scripts; optionally remove `frontend` from workspaces and delete `frontend/`. |
| Add a new frontend | Add folder, env, invoke logic per contract above, add to workspaces, point root scripts to it. |
| Run backend only | `npm run serve` from root, or `cd backend && supabase functions serve`. |
| Run a specific frontend | `npm run dev -w <workspace-name>` (e.g. `frontend` or your new app folder name). |
| Log POST requests as GeoJSON | Run `npm run log` (backend log server on port 3001). Any frontend can POST to `VITE_LOG_POST_URL` (default `http://localhost:3001/log-post`) with `{ endpoint, payload }`; backend writes to `backend/post-requests/*.geojson`. |

The backend lives in `backend/` and does not depend on which frontend folder exists. Only root `package.json` workspaces and scripts need to be updated when you unplug or plug a frontend.
