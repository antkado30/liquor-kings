import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * Dev: proxy /operator-review to the Liquor Kings API so session cookies stay same-origin.
 * Override target: VITE_PROXY_TARGET=http://127.0.0.1:4000 npm run dev
 */
export default defineConfig({
  base: "/operator-review/app/",
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/operator-review": {
        target: process.env.VITE_PROXY_TARGET ?? "http://127.0.0.1:4000",
        changeOrigin: true,
      },
      // Admin endpoints (NRS import + ambiguous review queue). Local dev
      // doesn't set LK_ADMIN_TOKEN so the API allows unauthenticated calls;
      // in prod the admin SPA is same-origin with the API so no proxy needed.
      "/admin": {
        target: process.env.VITE_PROXY_TARGET ?? "http://127.0.0.1:4000",
        changeOrigin: true,
      },
    },
  },
});
