import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  // Relative base so the build can be embedded under any Go static route.
  base: "./",
  build: { outDir: "dist" },
});
