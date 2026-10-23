import { defineConfig } from "vite";

// GitHub Pages serves the site under /<repo>/; set BASE (e.g. BASE=/2.5d-survival-engine/) for that build.
export default defineConfig({
  base: process.env["BASE"] ?? "/",
  build: { target: "es2022" },
});
