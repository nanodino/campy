import { defineConfig } from "vite";

// Relative asset paths so the build works under GitHub Pages' /<repo>/ subpath.
export default defineConfig({
  base: "./",
});
