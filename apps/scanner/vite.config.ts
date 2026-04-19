import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const proxyTarget = process.env.VITE_PROXY_TARGET ?? "http://127.0.0.1:4000";

/**
 * Dev: proxy API routes to Liquor Kings Express (same-origin cookies when deployed).
 * Override: VITE_PROXY_TARGET=http://127.0.0.1:4000 npm run dev
 */
export default defineConfig({
  base: "/scanner/",
  plugins: [react()],
  server: {
    port: 5174,
    proxy: {
      "/operator-review": {
        target: proxyTarget,
        changeOrigin: true,
      },
      "/price-book": {
        target: proxyTarget,
        changeOrigin: true,
      },
      "/cart": {
        target: proxyTarget,
        changeOrigin: true,
      },
      "/inventory": {
        target: proxyTarget,
        changeOrigin: true,
      },
    },
  },
});
