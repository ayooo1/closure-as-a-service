import { describe, expect, it } from "vitest";
import { loadEnv } from "./config.js";

describe("loadEnv", () => {
  it("applies defaults when only the required key is set", () => {
    const env = loadEnv({ ANTHROPIC_API_KEY: "sk-ant-test" });
    expect(env).toMatchObject({
      NODE_ENV: "development",
      PORT: 4000,
      HOST: "0.0.0.0",
      AI_MODEL: "claude-haiku-4-5",
      REDIS_URL: "redis://localhost:6379",
      TRUST_PROXY: "loopback,linklocal,uniquelocal",
      RATE_LIMIT_MAX: 10,
      RATE_LIMIT_WINDOW: "1 minute",
      CACHE_TTL_SECONDS: 3600,
    });
  });

  it("coerces numeric strings from ConfigMaps", () => {
    const env = loadEnv({
      ANTHROPIC_API_KEY: "sk-ant-test",
      PORT: "8080",
      RATE_LIMIT_MAX: "25",
      CACHE_TTL_SECONDS: "0",
    });
    expect(env.PORT).toBe(8080);
    expect(env.RATE_LIMIT_MAX).toBe(25);
    expect(env.CACHE_TTL_SECONDS).toBe(0);
  });

  it("fails fast without ANTHROPIC_API_KEY", () => {
    expect(() => loadEnv({})).toThrow(/ANTHROPIC_API_KEY/);
    expect(() => loadEnv({ ANTHROPIC_API_KEY: "" })).toThrow(/ANTHROPIC_API_KEY is required/);
  });

  it("accepts Opus 5.5 with an effort level, and leaves effort unset by default", () => {
    expect(loadEnv({ ANTHROPIC_API_KEY: "k" }).AI_EFFORT).toBeUndefined();
    expect(loadEnv({ ANTHROPIC_API_KEY: "k", AI_MODEL: "claude-opus-5-5", AI_EFFORT: "low" })).toMatchObject({
      AI_MODEL: "claude-opus-5-5",
      AI_EFFORT: "low",
    });
  });

  it.each([
    ["PORT", "-1"],
    ["PORT", "abc"],
    ["RATE_LIMIT_MAX", "0"],
    ["CACHE_TTL_SECONDS", "-5"],
    ["REDIS_URL", "not a url"],
    ["NODE_ENV", "staging"],
    ["AI_MODEL", "gpt-4o-mini"],
    ["AI_EFFORT", "extreme"],
  ])("rejects invalid %s=%s", (key, value) => {
    expect(() => loadEnv({ ANTHROPIC_API_KEY: "sk-ant-test", [key]: value })).toThrow(key);
  });
});
