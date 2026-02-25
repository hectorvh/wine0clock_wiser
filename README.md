# Wine O'Clock Wiser

Monorepo: **backend** (Supabase Edge Functions) and one or more **frontends**. The backend is frontend-agnostic; you can unplug the current app and plug in a new one.

## Structure

- **`backend/`** – Supabase config and Edge Functions (wine analysis, explorer, recognize). Same for all frontends.
- **`frontend/`** – Default web app (Vite, TypeScript, React, shadcn-ui, Tailwind). Can be replaced.

**→ Unplugging or adding a frontend:** see **[FRONTEND.md](./FRONTEND.md)** for step-by-step instructions and the backend API contract.

## Setup

Requires Node.js and npm. From repo root:

```sh
npm install
npm run dev
```

- **`npm run dev`** – starts **both** the frontend (port 8080) and the backend log server (port 3001). Every time **recognize-wine** is triggered in the app, the response is automatically sent to the log server and stored as a GeoJSON file in **`backend/post-requests/`**. If the log server is down, the app shows a console warning and the file is not stored.
- **`npm run dev:frontend`** – runs only the frontend (no log server; no GeoJSON files).
- **`npm run build`** – builds the default frontend.
- **`npm run serve`** – serves Supabase functions locally (requires [Supabase CLI](https://supabase.com/docs/guides/cli)).
- **`npm run log`** – runs only the backend log server (port 3001). Use if you run the frontend separately and want GeoJSON stored.

## CI (GitHub Actions)

A workflow in **`.github/workflows/build.yml`** runs on every push to `main`: it installs dependencies and runs `npm run build` (frontend). To use it, add these **repository secrets** in GitHub (Settings → Secrets and variables → Actions):

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `VITE_SUPABASE_PROJECT_ID`

They are injected as env vars during the build so Vite can read `import.meta.env.VITE_*`.

Backend commands use **`backend/supabase/`**; run Supabase CLI from **`backend/`**:

```sh
cd backend
supabase functions serve
# or: supabase functions deploy
```

## Environment variables

- **Frontend (`.env` at repo root or `frontend/.env`):** Use the **`VITE_`** prefix for any variable read by the Vite app (e.g. `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_SUPABASE_PROJECT_ID`). Only `VITE_` vars are exposed to the client; do not use this prefix for backend-only secrets.
- **Backend / Node:** Use **no prefix** (e.g. `LOG_POST_PORT`). The log server and other Node scripts read `process.env.*`; they do not use `VITE_`.
- **Supabase Edge Functions (recognize-wine, etc.):** They run in Supabase’s cloud and read **Supabase secrets**, not the repo’s `.env`. Set secrets in the [Supabase Dashboard](https://supabase.com/dashboard) under **Project → Edge Functions → Secrets**, or via CLI:
  ```sh
  cd backend
  supabase secrets set RAPIDAPI_KEY=your_key_here
  ```
  The recognize-wine function needs `RAPIDAPI_KEY` for the wine recognition API.

**Summary:** Put frontend config in `.env` with `VITE_`; put Edge Function secrets in Supabase (Dashboard or `supabase secrets set`). Do not commit `.env` or real secrets to the repo.

## Creating a new Supabase Edge Function

1. **Add the function folder and handler**  
   Create `backend/supabase/functions/<name>/index.ts` and use `Deno.serve(async (req) => { ... })` as the entry point. Start the file with:
   ```ts
   import "jsr:@supabase/functions-js/edge-runtime.d.ts";
   ```
   Edge Functions run on Deno (use `jsr:` or `npm:` imports).

2. **Configure in `config.toml`**  
   In `backend/supabase/config.toml`, add:
   ```toml
   [functions.<name>]
   verify_jwt = false
   ```
   Use `verify_jwt = false` for public/anonymous access (e.g. from the frontend with anon key).

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
   If the function needs API keys, set them in Supabase (Dashboard or `supabase secrets set KEY=value`), then read them in the function with `Deno.env.get("KEY")`.

7. **Call from the frontend**  
   Use the Supabase client: `supabase.functions.invoke("<name>", { body: ... })`. The URL is derived from `VITE_SUPABASE_URL` in your `.env`.

## Switching to a new Supabase project

To point the app and CLI at a different Supabase project:

1. Create or open the new project in the [Supabase Dashboard](https://supabase.com/dashboard).
2. In the new project: **Project Settings → API** — copy **Project URL**, **anon public** key, and **Project ref** (from the dashboard URL).
3. **Root `.env`** (and `frontend/.env` if you use it): set `VITE_SUPABASE_PROJECT_ID`, `VITE_SUPABASE_URL`, and `VITE_SUPABASE_PUBLISHABLE_KEY` to the new project’s values.
4. **`backend/supabase/config.toml`:** set `project_id = "<new-project-ref>"`.
5. **Re-link and redeploy:** from `backend/` run `supabase link --project-ref <new-project-ref>`, then set any secrets (e.g. `supabase secrets set RAPIDAPI_KEY=...`) and run `supabase functions deploy`.

Data (database, storage, auth) is per project; the new project starts empty unless you migrate. Secrets must be set again for the new project.

## Access and security

- **403 when listing or deploying functions:** Your Supabase account may not have access to that project (e.g. it was created by another account or org). Use the account that owns the project, get the right org role, or use a project you own and deploy your existing function code there.
- **Sharing `.env`:** Do not share `.env` files via chat or email. Prefer giving instructions (e.g. “create a project and copy URL and anon key from Dashboard”) or use a secure channel. Treat `.env` as private so you never accidentally share a file that later contains real secrets.

## Tech stack (current frontend)

- Vite, TypeScript, React, shadcn-ui, Tailwind CSS
