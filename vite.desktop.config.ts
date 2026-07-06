import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(fileURLToPath(import.meta.url));
const uiRoot = path.join(root, "src", "desktop", "ui");

// The packaged build serves linked CSS/JS from disk, so it keeps a strict CSP.
// Vite's dev server injects styles (and the React refresh preamble) inline and
// talks to an HMR websocket, so dev needs 'unsafe-inline' and ws:. Injecting the
// meta per-mode keeps production locked down while making dev actually render.
function contentSecurityPolicy(): Plugin {
  const prod = "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:;";
  const dev =
    "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; " +
    "connect-src 'self' ws:; img-src 'self' data:;";
  return {
    name: "apothecary-csp",
    transformIndexHtml(html, ctx) {
      return {
        html,
        tags: [
          {
            tag: "meta",
            attrs: { "http-equiv": "Content-Security-Policy", content: ctx.server ? dev : prod },
            injectTo: "head-prepend",
          },
        ],
      };
    },
  };
}

// The React renderer is built separately from the tsc (main/preload) build.
// `base: "./"` makes asset URLs relative so Electron can load the built
// index.html over file://.
export default defineConfig({
  root: uiRoot,
  base: "./",
  plugins: [contentSecurityPolicy(), react()],
  resolve: { alias: { "@": uiRoot } },
  build: {
    outDir: path.join(root, "dist", "desktop", "ui"),
    emptyOutDir: true,
  },
});
