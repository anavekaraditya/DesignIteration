import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";

export default defineConfig({
  root: "src/ui",
  plugins: [react(), viteSingleFile()],
  build: {
    target: "es2017",
    outDir: "../../dist",
    emptyOutDir: true
  }
});
