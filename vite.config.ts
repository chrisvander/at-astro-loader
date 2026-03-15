import { defineConfig } from "vite";
import dts from "vite-plugin-dts";

export default defineConfig({
  plugins: [dts()],
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
