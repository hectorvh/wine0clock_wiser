import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

// POST logging is in the backend: run "npm run log -w backend" and the frontend
// sends payloads to that server, which writes GeoJSON to backend/post-requests/.

// https://vitejs.dev/config/
export default defineConfig({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
