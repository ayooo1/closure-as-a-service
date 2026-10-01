import Fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { env } from "./config.js";
import { redis } from "./lib/redis.js";
import { healthRoutes } from "./routes/health.js";

export async function buildServer() {
  const app = Fastify({
    // Behind the Ingress controller, the real client IP is in X-Forwarded-For.
    trustProxy: true,
    logger:
      env.NODE_ENV === "development"
        ? { transport: { target: "pino-pretty" } }
        : true,
  });

  await app.register(cors, { origin: env.CORS_ORIGIN.split(",") });

  // Redis-backed store so the limit is shared across all API replicas (HPA).
  await app.register(rateLimit, {
    global: false, // opted into per-route (see /api/generate in step 3)
    max: env.RATE_LIMIT_MAX,
    timeWindow: env.RATE_LIMIT_WINDOW,
    redis,
    nameSpace: "caas:rl:",
  });

  await app.register(healthRoutes);
  // Step 3: await app.register(generateRoutes, { prefix: "/api" });

  return app;
}
