import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const localAllowedHosts = ["dev.todos.karthikg.in"];

const apiTarget = process.env.API_PROXY_TARGET ?? "http://localhost:3000";

export default defineConfig({
  plugins: [react()],
  base: "/app/",
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  preview: {
    host: "127.0.0.1",
    allowedHosts: localAllowedHosts,
    port: 4173,
    strictPort: true,
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    allowedHosts: localAllowedHosts,
    proxy: {
      "/auth": apiTarget,
      "/todos": apiTarget,
      "/projects": apiTarget,
      "/capture": apiTarget,
      "/users": apiTarget,
      "/ai": apiTarget,
      "/admin": apiTarget,
      "/api": apiTarget,
      "/agent": apiTarget,
    },
  },
});
