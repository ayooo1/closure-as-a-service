import path from "node:path";
import type { NextConfig } from "next";

const monorepoRoot = path.resolve(process.cwd(), "../..");

const nextConfig: NextConfig = {
  // Self-contained server bundle for a small Docker image.
  output: "standalone",
  // Trace files from the monorepo root so workspace packages land in the bundle.
  outputFileTracingRoot: monorepoRoot,
  turbopack: { root: monorepoRoot },
  transpilePackages: ["@caas/shared"],

  // Local dev & docker-compose: proxy /api/* to the Fastify service.
  // In Kubernetes the Ingress sends /api straight to the API, so this never fires there.
  // NB: rewrites are resolved at build time, so API_INTERNAL_URL is a build arg.
  async rewrites() {
    const apiUrl = process.env.API_INTERNAL_URL ?? "http://localhost:4000";
    return [{ source: "/api/:path*", destination: `${apiUrl}/api/:path*` }];
  },
};

export default nextConfig;
