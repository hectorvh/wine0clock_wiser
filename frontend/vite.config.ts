import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

// POST logging is in the backend: run "npm run log -w backend" and the frontend
// sends payloads to that server, which writes GeoJSON to backend/post-requests/.

// https://vitejs.dev/config/
export default defineConfig({
  envDir: path.resolve(__dirname, ".."),
  server: {
    host: "::",
    port: 8000,
    hmr: {
      overlay: false,
    },
    proxy: {
      "/geoserver": {
        target: "http://localhost:8080",
        changeOrigin: true,
      },
    },
  },
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
