import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root,
  plugins: [react()],
  resolve: {
    alias: {
      "blob-editor/core": path.resolve(root, "../src/core/index.ts"),
      "blob-editor/react": path.resolve(root, "../src/react/index.ts"),
    },
  },
  server: { port: 5173 },
});
