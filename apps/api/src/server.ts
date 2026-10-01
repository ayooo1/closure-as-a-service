import Fastify, { type FastifyServerOptions } from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import type { Redis } from "ioredis";
import type { Env } from "./config.js";
import { healthRoutes } from "./routes/health.js";

export interface ServerDeps {
  env: Env;
  redis: Redis;
  logger?: FastifyServerOptions["logger"];
}

export async function buildServer({ env, redis, logger }: ServerDeps) {
  const app = Fastify({
    // Behind the Ingress controller, the real client IP is in X-Forwarded-For.
    trustProxy: env.TRUST_PROXY || false,
    logger:
      logger ??
      (env.NODE_ENV === "development" ? { transport: { target: "pino-pretty" } } : true),
  });

  await app.register(cors, { origin: env.CORS_ORIGIN.split(",").map((o) => o.trim()) });

  // Redis-backed store so the limit is shared across all API replicas (HPA).
  await app.register(rateLimit, {
    global: false, // opted into per-route (see /api/generate in step 3)
    max: env.RATE_LIMIT_MAX,
    timeWindow: env.RATE_LIMIT_WINDOW,
    redis,
    nameSpace: "caas:rl:",
    // A Redis blip shouldn't turn every request into a 500; readiness already pulls the pod.
    skipOnError: true,
  });

  await app.register(healthRoutes, { redis });
  // Step 3: await app.register(generateRoutes, { prefix: "/api" });

  return app;
}
