import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@layer3/core": path.resolve(__dirname, "../../packages/core/src"),
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api":          { target: "http://localhost:3000", changeOrigin: true },
      "/dist":         { target: "http://localhost:3000", changeOrigin: true },
      "/css":          { target: "http://localhost:3000", changeOrigin: true },
      "/qp_icons.png": { target: "http://localhost:3000", changeOrigin: true },
    },
  },
  build: {
    outDir: "../../dist-v2",
    emptyOutDir: true,
    sourcemap: false,
  },
});
