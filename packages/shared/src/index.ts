// Single source of truth shared by apps/web and apps/api.
// Consumed as raw TypeScript: Next.js transpiles it (transpilePackages),
// the API bundles it with tsup.
//
// Step 2 adds ./validations (Zod schema + inferred types) and re-exports it here.
export {};
