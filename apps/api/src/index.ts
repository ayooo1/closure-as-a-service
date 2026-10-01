import { loadEnv } from "./config.js";
import { createRedis } from "./lib/redis.js";
import { buildServer } from "./server.js";

const env = loadEnv();

// The error handler only fires after connect(), by which point `app` is initialised.
const redis = createRedis(env.REDIS_URL, (err) => app.log.warn({ err: err.message }, "Redis error"));
const app = await buildServer({ env, redis });

await redis.connect().catch((err) => {
  // Don't crash: /readyz reports not-ready and K8s withholds traffic until Redis is back.
  app.log.warn({ err }, "Redis unavailable at startup");
});

// Graceful shutdown on SIGTERM so rolling updates don't drop in-flight streams.
let shuttingDown = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info(`${signal} received, shutting down`);
    // Stay under terminationGracePeriodSeconds (30s) minus the preStop delay.
    const force = setTimeout(() => process.exit(1), 20_000).unref();
    try {
      await app.close();
      await redis.quit().catch(() => redis.disconnect());
    } finally {
      clearTimeout(force);
      process.exit(0);
    }
  });
}

await app.listen({ port: env.PORT, host: env.HOST });
