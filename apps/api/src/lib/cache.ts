import { createHash } from "node:crypto";
import type { Redis } from "ioredis";
import type { Questionnaire } from "@caas/shared";
import { PROMPT_VERSION } from "./prompt.js";

export interface GenerationCache {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
}

// Validated questionnaires have a fixed key order (Zod output follows the schema), so
// JSON.stringify is a stable fingerprint. Hashing keeps keys short regardless of free-text length.
export function cacheKey(q: Questionnaire, modelId: string): string {
  const hash = createHash("sha256").update(JSON.stringify([PROMPT_VERSION, modelId, q])).digest("base64url");
  return `caas:gen:${hash}`;
}

// The cache is an optimisation: Redis failures degrade to a miss rather than failing the request.
export function createCache(
  redis: Pick<Redis, "get" | "set">,
  ttlSeconds: number,
  onError: (err: unknown) => void,
): GenerationCache {
  if (ttlSeconds === 0) {
    return { get: async () => null, set: async () => {} };
  }
  return {
    async get(key) {
      try {
        return await redis.get(key);
      } catch (err) {
        onError(err);
        return null;
      }
    },
    async set(key, value) {
      try {
        await redis.set(key, value, "EX", ttlSeconds);
      } catch (err) {
        onError(err);
      }
    },
  };
}
