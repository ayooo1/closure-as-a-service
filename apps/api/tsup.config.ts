import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node22",
  platform: "node",
  clean: true,
  sourcemap: true,
  // Inline the workspace package (it ships raw TS); keep real npm deps external.
  noExternal: ["@caas/shared"],
});
