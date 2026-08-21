import { defineConfig } from "vite";

export default defineConfig({
  build: {
    outDir: "dist/web",
    emptyOutDir: true,
    target: "es2022",
  },
  server: {
    proxy: {
      "/api": "http://localhost:8788",
    },
  },
});
