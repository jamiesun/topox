import { build } from "esbuild";
import { execSync } from "node:child_process";

/**
 * Two artifacts, both with React/React Flow/CSS baked in so hosts need no
 * framework of their own:
 *  - dist/index.js                    ESM, for bundler-based hosts (vite, webpack)
 *  - dist/topox-embed.standalone.js   IIFE `window.TopoX`, for <script src> pages
 */
const shared = {
  entryPoints: ["src/index.ts"],
  bundle: true,
  sourcemap: true,
  loader: { ".css": "text" },
  define: { "process.env.NODE_ENV": '"production"' },
  logLevel: "info",
};

await build({
  ...shared,
  format: "esm",
  outfile: "dist/index.js",
  minify: false,
});

await build({
  ...shared,
  format: "iife",
  globalName: "TopoX",
  outfile: "dist/topox-embed.standalone.js",
  minify: true,
});

execSync("tsc -p tsconfig.json", { stdio: "inherit" });
