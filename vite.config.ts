import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  root: "web",
  plugins: [react()],
  build: {
    outDir: "../dist/web",
    emptyOutDir: true,
    chunkSizeWarningLimit: 4000,
    rollupOptions: {
      input: { main: resolve(__dirname, "web/index.html"), redirect: resolve(__dirname, "web/redirect.html") },
    },
  },
  server: { port: 5173, proxy: { "/api": "http://localhost:8080" } },
});
