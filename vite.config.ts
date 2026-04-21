import { defineConfig } from "vite";

export default defineConfig({
  build: {
    lib: {
      entry: "src/index.ts",
      name: "at-astro-loader",
      fileName: "index",
      formats: ["es", "cjs"],
    },
    rolldownOptions: {
      external: ["astro", "zod/mini"],
    },
  },
});
