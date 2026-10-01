import { afterEach, describe, expect, it } from "vitest";
import { loadEnv, type Env } from "./config.js";
import { createRedis } from "./lib/redis.js";
import { buildServer } from "./server.js";
import { SAMPLE_GENERATION, streamingModel } from "./testing/mock-model.js";

// Never connected (lazyConnect): exercises the "Redis is down" paths without a real server.
const redis = createRedis("redis://127.0.0.1:1", () => {});

async function build(overrides: Partial<Record<keyof Env, string>> = {}) {
  const env = loadEnv({ OPENAI_API_KEY: "sk-test", NODE_ENV: "test", ...overrides });
  const model = streamingModel(JSON.stringify(SAMPLE_GENERATION));
  const app = await buildServer({ env, redis, model, logger: false });
  app.get("/ip", (req) => ({ ip: req.ip }));
  app.get("/limited", { config: { rateLimit: { max: 1, timeWindow: 60_000 } } }, () => "ok");
  return app;
}

describe("buildServer", () => {
  let app: Awaited<ReturnType<typeof build>> | undefined;
  afterEach(() => app?.close());

  it("allows each configured CORS origin and rejects others", async () => {
    app = await build({ CORS_ORIGIN: "https://a.example, https://b.example" });

    for (const origin of ["https://a.example", "https://b.example"]) {
      const res = await app.inject({ url: "/healthz", headers: { origin } });
      expect(res.headers["access-control-allow-origin"]).toBe(origin);
    }
    const res = await app.inject({ url: "/healthz", headers: { origin: "https://evil.example" } });
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("takes the client IP from an in-cluster proxy, ignoring spoofed entries", async () => {
    app = await build();
    const res = await app.inject({
      url: "/ip",
      remoteAddress: "10.0.0.5", // the Ingress controller
      headers: { "x-forwarded-for": "6.6.6.6, 203.0.113.7" }, // spoofed, then real client
    });
    expect(res.json()).toEqual({ ip: "203.0.113.7" });
  });

  it("ignores X-Forwarded-For from untrusted peers", async () => {
    app = await build();
    const res = await app.inject({
      url: "/ip",
      remoteAddress: "198.51.100.1", // a client hitting the pod directly
      headers: { "x-forwarded-for": "203.0.113.7" },
    });
    expect(res.json()).toEqual({ ip: "198.51.100.1" });
  });

  it("ignores X-Forwarded-For entirely when TRUST_PROXY is empty", async () => {
    app = await build({ TRUST_PROXY: "" });
    const res = await app.inject({
      url: "/ip",
      remoteAddress: "10.0.0.5",
      headers: { "x-forwarded-for": "203.0.113.7" },
    });
    expect(res.json()).toEqual({ ip: "10.0.0.5" });
  });

  it("keeps rate-limited routes serving when Redis is unavailable", async () => {
    app = await build();
    const res = await app.inject("/limited");
    expect(res.statusCode).toBe(200);
  });

  it("reports not-ready when Redis is unavailable", async () => {
    app = await build();
    const res = await app.inject("/readyz");
    expect(res.statusCode).toBe(503);
  });

  it("serves /api/generate, falling back to the model when the cache is unavailable", async () => {
    app = await build();
    const res = await app.inject({
      method: "POST",
      url: "/api/generate",
      payload: { duration: "few-dates", reason: "other", tone: "warm", medium: "text" },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual(SAMPLE_GENERATION);
  });
});

// Integration: run with a real Redis, e.g. REDIS_TEST_URL=redis://localhost:6379 npm test
const REDIS_TEST_URL = process.env.REDIS_TEST_URL;
describe.skipIf(!REDIS_TEST_URL)("rate limiting with real Redis", () => {
  it("shares the per-IP limit across replicas", async () => {
    const shared = createRedis(REDIS_TEST_URL!, () => {});
    await shared.connect();
    const env = loadEnv({ OPENAI_API_KEY: "sk-test", NODE_ENV: "test", RATE_LIMIT_MAX: "2" });
    const model = streamingModel(JSON.stringify(SAMPLE_GENERATION));
    const replicas = await Promise.all([1, 2].map(() => buildServer({ env, redis: shared, model, logger: false })));
    // A fresh client IP per run so counters from earlier runs don't interfere.
    const ip = `203.0.113.${Math.floor(Math.random() * 254) + 1}`;

    try {
      // Invalid bodies: the limiter runs before validation, so no model calls are needed.
      const codes = [];
      for (const app of [replicas[0]!, replicas[1]!, replicas[0]!]) {
        const res = await app.inject({ method: "POST", url: "/api/generate", payload: {}, remoteAddress: ip });
        codes.push(res.statusCode);
      }
      expect(codes).toEqual([400, 400, 429]);
    } finally {
      await Promise.all(replicas.map((r) => r.close()));
      await shared.quit();
    }
  });
});
