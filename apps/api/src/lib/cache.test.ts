import { QuestionnaireSchema } from "@caas/shared";
import { describe, expect, it, vi } from "vitest";
import { cacheKey, createCache } from "./cache.js";

const q = QuestionnaireSchema.parse({ duration: "few-dates", reason: "other", tone: "warm", medium: "text" });

describe("cacheKey", () => {
  it("is stable, namespaced and short", () => {
    const key = cacheKey(q, "gpt-4o-mini");
    expect(key).toBe(cacheKey({ ...q }, "gpt-4o-mini"));
    expect(key).toMatch(/^caas:gen:[\w-]{43}$/);
  });

  it("differs by model and by any answer", () => {
    const key = cacheKey(q, "gpt-4o-mini");
    expect(cacheKey(q, "gpt-4o")).not.toBe(key);
    expect(cacheKey({ ...q, tone: "direct" }, "gpt-4o-mini")).not.toBe(key);
    expect(cacheKey({ ...q, details: "x" }, "gpt-4o-mini")).not.toBe(key);
  });
});

describe("createCache", () => {
  it("reads and writes with the configured TTL", async () => {
    const redis = { get: vi.fn().mockResolvedValue("cached"), set: vi.fn().mockResolvedValue("OK") };
    const cache = createCache(redis, 3600, vi.fn());

    expect(await cache.get("k")).toBe("cached");
    await cache.set("k", "v");
    expect(redis.set).toHaveBeenCalledWith("k", "v", "EX", 3600);
  });

  it("degrades to a miss when Redis fails", async () => {
    const err = new Error("Connection is closed.");
    const redis = { get: vi.fn().mockRejectedValue(err), set: vi.fn().mockRejectedValue(err) };
    const onError = vi.fn();
    const cache = createCache(redis, 3600, onError);

    expect(await cache.get("k")).toBeNull();
    await expect(cache.set("k", "v")).resolves.toBeUndefined();
    expect(onError).toHaveBeenCalledTimes(2);
  });

  it("is disabled when the TTL is 0", async () => {
    const redis = { get: vi.fn(), set: vi.fn() };
    const cache = createCache(redis, 0, vi.fn());

    expect(await cache.get("k")).toBeNull();
    await cache.set("k", "v");
    expect(redis.get).not.toHaveBeenCalled();
    expect(redis.set).not.toHaveBeenCalled();
  });
});
