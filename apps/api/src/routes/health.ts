import type { FastifyPluginAsync } from "fastify";
import type { RedisClient } from "../lib/redis.js";

export const healthRoutes: FastifyPluginAsync<{ redis: RedisClient }> = async (app, { redis }) => {
  // Kubelet probes every few seconds per pod; don't log each one.
  const opts = { logLevel: "warn" } as const;

  // Liveness: the process is up and the event loop is responsive.
  app.get("/healthz", opts, async () => ({ status: "ok" }));

  // Readiness: dependencies are reachable, so it's safe to receive traffic.
  app.get("/readyz", opts, async (_req, reply) => {
    try {
      await redis.ping();
      return { status: "ready", redis: "up" };
    } catch {
      return reply.code(503).send({ status: "not_ready", redis: "down" });
    }
  });
};
