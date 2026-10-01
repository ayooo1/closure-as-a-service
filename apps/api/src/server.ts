import Fastify, { type FastifyServerOptions } from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import type { Redis } from "ioredis";
import type { Env } from "./config.js";
import { createCache } from "./lib/cache.js";
import { createFeedbackStore } from "./lib/feedback.js";
import type { TextGenerator } from "./lib/generator.js";
import { generateRoutes } from "./routes/generate.js";
import { healthRoutes } from "./routes/health.js";

export interface ServerDeps {
  env: Env;
  redis: Redis;
  generate: TextGenerator;
  logger?: FastifyServerOptions["logger"];
}

export async function buildServer({ env, redis, generate, logger }: ServerDeps) {
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
    global: false, // opted into per-route (see routes/generate.ts)
    max: env.RATE_LIMIT_MAX,
    timeWindow: env.RATE_LIMIT_WINDOW,
    redis,
    nameSpace: "caas:rl:",
    // A Redis blip shouldn't turn every request into a 500; readiness already pulls the pod.
    skipOnError: true,
  });

  await app.register(healthRoutes, { redis });

  const cache = createCache(redis, env.CACHE_TTL_SECONDS, (err) =>
    app.log.warn({ err }, "Generation cache unavailable"),
  );
  const modelId = `${env.AI_MODEL}:${env.AI_EFFORT ?? "default"}`;
  await app.register(generateRoutes, {
    prefix: "/api",
    generate,
    modelId,
    cache,
    feedback: createFeedbackStore(redis),
  });

  return app;
}
