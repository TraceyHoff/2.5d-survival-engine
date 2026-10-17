import { defineConfig } from "vite";
// Demo app: index.html at the package root, sources in demo/ and src/.
export default defineConfig({ base: "./", build: { outDir: "dist", target: "es2022" }, server: { port: 5173 } });
