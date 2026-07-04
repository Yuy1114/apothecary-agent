import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(fileURLToPath(import.meta.url));
const uiRoot = path.join(root, "src", "desktop", "ui");

// The React renderer is built separately from the tsc (main/preload) build.
// `base: "./"` makes asset URLs relative so Electron can load the built
// index.html over file://.
export default defineConfig({
  root: uiRoot,
  base: "./",
  plugins: [react()],
  resolve: { alias: { "@": uiRoot } },
  build: {
    outDir: path.join(root, "dist", "desktop", "ui"),
    emptyOutDir: true,
  },
});
