import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import fs from "fs";

// Dev-only: store POST request bodies as JSON files under backend/post-requests/
function postRequestLoggerPlugin() {
  const backendPostRequests = path.resolve(__dirname, "..", "backend", "post-requests");
  return {
    name: "post-request-logger",
    configureServer(server: { middlewares: { use: (fn: (req: any, res: any, next: () => void) => void) => void } }) {
      server.middlewares.use((req: any, res: any, next: () => void) => {
        if (req.method !== "POST" || req.url !== "/__log-post") return next();
        const chunks: Buffer[] = [];
        req.on("data", (chunk: Buffer) => chunks.push(chunk));
        req.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf8");
          let data: { endpoint?: string; payload?: unknown };
          try {
            data = JSON.parse(body);
          } catch {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Invalid JSON" }));
            return;
          }
          const dir = backendPostRequests;
          fs.mkdirSync(dir, { recursive: true });
          const safeName = (data.endpoint || "post").replace(/[^a-z0-9-_]/gi, "_");
          const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
          const filename = `${safeName}_${timestamp}.json`;
          const filepath = path.join(dir, filename);
          const content = data.payload !== undefined ? data.payload : data;
          fs.writeFileSync(filepath, JSON.stringify(content, null, 2));
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, file: filename }));
        });
      });
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [react(), postRequestLoggerPlugin()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
