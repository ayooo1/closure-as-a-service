import { env } from "./config.js";
import { redis } from "./lib/redis.js";
import { buildServer } from "./server.js";

const app = await buildServer();

await redis.connect().catch((err) => {
  // Don't crash: /readyz reports not-ready and K8s withholds traffic until Redis is back.
  app.log.warn({ err }, "Redis unavailable at startup");
});

// Graceful shutdown on SIGTERM so rolling updates don't drop in-flight streams.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, async () => {
    app.log.info(`${signal} received, shutting down`);
    await app.close();
    redis.disconnect();
    process.exit(0);
  });
}

await app.listen({ port: env.PORT, host: env.HOST });
