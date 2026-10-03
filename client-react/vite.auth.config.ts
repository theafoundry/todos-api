import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Auth page build: base "/" outputs to dist-auth/
// Served at GET /auth by Express
export default defineConfig({
  plugins: [
    react(),
    {
      name: "fix-auth-favicon",
      transformIndexHtml(html) {
        // Shared public brand assets belong at root, including versioned URLs.
        return html.replace(
          /href="\/auth\/((?:favicon\.svg|favicon\.ico|favicon-16x16\.png|favicon-32x32\.png|apple-touch-icon\.png)(?:\?[^\"]*)?)"/g,
          'href="/$1"',
        );
      },
    },
  ],
  base: "/auth/",
  root: ".",
  build: {
    outDir: "dist-auth",
    emptyOutDir: true,
    rollupOptions: {
      input: "auth.html",
    },
  },
  server: {
    proxy: {
      "/auth": "http://localhost:3000",
      "/todos": "http://localhost:3000",
      "/projects": "http://localhost:3000",
      "/users": "http://localhost:3000",
      "/ai": "http://localhost:3000",
      "/admin": "http://localhost:3000",
      "/api": "http://localhost:3000",
      "/agent": "http://localhost:3000",
    },
  },
});
