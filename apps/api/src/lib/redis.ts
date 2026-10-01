import { Redis } from "ioredis";

export type RedisClient = Pick<Redis, "ping">;

export function createRedis(url: string, onError: (err: Error) => void): Redis {
  const redis = new Redis(url, {
    // Fail fast instead of queueing: /readyz and rate limiting must not hang on a dead Redis.
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    connectTimeout: 2_000,
    commandTimeout: 1_000,
    lazyConnect: true,
  });
  // Without a listener ioredis prints "Unhandled error event" on every reconnect attempt.
  redis.on("error", onError);
  return redis;
}
