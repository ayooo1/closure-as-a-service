import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RedisClient } from "../lib/redis.js";
import { healthRoutes } from "./health.js";

async function build(redis: RedisClient) {
  const app = Fastify();
  await app.register(healthRoutes, { redis });
  return app;
}

describe("health routes", () => {
  let app: Awaited<ReturnType<typeof build>> | undefined;
  afterEach(() => app?.close());

  it("GET /healthz is ok without touching Redis", async () => {
    const ping = vi.fn();
    app = await build({ ping });
    const res = await app.inject("/healthz");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
    expect(ping).not.toHaveBeenCalled();
  });

  it("GET /readyz is 200 when Redis answers", async () => {
    app = await build({ ping: vi.fn().mockResolvedValue("PONG") });
    const res = await app.inject("/readyz");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ready", redis: "up" });
  });

  it("GET /readyz is 503 when Redis is down", async () => {
    app = await build({ ping: vi.fn().mockRejectedValue(new Error("Connection is closed.")) });
    const res = await app.inject("/readyz");
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ status: "not_ready", redis: "down" });
  });
});
