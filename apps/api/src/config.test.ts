import { describe, expect, it } from "vitest";
import { loadEnv } from "./config.js";

describe("loadEnv", () => {
  it("applies defaults when only the required key is set", () => {
    const env = loadEnv({ OPENAI_API_KEY: "sk-test" });
    expect(env).toMatchObject({
      NODE_ENV: "development",
      PORT: 4000,
      HOST: "0.0.0.0",
      OPENAI_MODEL: "gpt-4o-mini",
      REDIS_URL: "redis://localhost:6379",
      TRUST_PROXY: "loopback,linklocal,uniquelocal",
      RATE_LIMIT_MAX: 10,
      RATE_LIMIT_WINDOW: "1 minute",
      CACHE_TTL_SECONDS: 3600,
    });
  });

  it("coerces numeric strings from ConfigMaps", () => {
    const env = loadEnv({
      OPENAI_API_KEY: "sk-test",
      PORT: "8080",
      RATE_LIMIT_MAX: "25",
      CACHE_TTL_SECONDS: "0",
    });
    expect(env.PORT).toBe(8080);
    expect(env.RATE_LIMIT_MAX).toBe(25);
    expect(env.CACHE_TTL_SECONDS).toBe(0);
  });

  it("fails fast without OPENAI_API_KEY", () => {
    expect(() => loadEnv({})).toThrow(/OPENAI_API_KEY/);
    expect(() => loadEnv({ OPENAI_API_KEY: "" })).toThrow(/OPENAI_API_KEY is required/);
  });

  it.each([
    ["PORT", "-1"],
    ["PORT", "abc"],
    ["RATE_LIMIT_MAX", "0"],
    ["CACHE_TTL_SECONDS", "-5"],
    ["REDIS_URL", "not a url"],
    ["NODE_ENV", "staging"],
  ])("rejects invalid %s=%s", (key, value) => {
    expect(() => loadEnv({ OPENAI_API_KEY: "sk-test", [key]: value })).toThrow(key);
  });
});
