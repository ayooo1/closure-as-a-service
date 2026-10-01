import type { FastifyPluginAsync } from "fastify";
import { redis } from "../lib/redis.js";

export const healthRoutes: FastifyPluginAsync = async (app) => {
  // Liveness: the process is up and the event loop is responsive.
  app.get("/healthz", { config: { rateLimit: false } }, async () => ({ status: "ok" }));

  // Readiness: dependencies are reachable, so it's safe to receive traffic.
  app.get("/readyz", { config: { rateLimit: false } }, async (_req, reply) => {
    try {
      await redis.ping();
      return { status: "ready", redis: "up" };
    } catch {
      return reply.code(503).send({ status: "not_ready", redis: "down" });
    }
  });
};
