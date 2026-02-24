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

- **`npm run dev`** – runs the default frontend dev server (port 8080).
- **`npm run build`** – builds the default frontend.
- **`npm run serve`** – serves Supabase functions locally (requires [Supabase CLI](https://supabase.com/docs/guides/cli)).

Backend commands use **`backend/supabase/`**; run Supabase CLI from **`backend/`**:

```sh
cd backend
supabase functions serve
# or: supabase functions deploy
```

## Tech stack (current frontend)

- Vite, TypeScript, React, shadcn-ui, Tailwind CSS
