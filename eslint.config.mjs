// One flat config for the whole monorepo: `npm run lint` from the root.
import js from "@eslint/js";
import nextVitals from "eslint-config-next/core-web-vitals";
import { defineConfig, globalIgnores } from "eslint/config";
import tseslint from "typescript-eslint";

export default defineConfig([
  globalIgnores(["**/node_modules/", "**/dist/", "**/.next/", "**/coverage/", "**/next-env.d.ts"]),

  js.configs.recommended,

  // Type-aware rules (floating promises, misused async, …) for all TypeScript.
  {
    files: ["**/*.{ts,tsx}"],
    extends: [tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: { allowDefaultProject: ["apps/api/tsup.config.ts"] },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Fastify plugins/handlers and Next.js config hooks are async by contract, with or without an await.
      "@typescript-eslint/require-await": "off",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },

  // Next.js, React and React Hooks rules for the web app only.
  {
    basePath: "apps/web",
    extends: [nextVitals],
    settings: { next: { rootDir: "apps/web" } },
  },
]);
