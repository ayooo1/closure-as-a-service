import { z } from "zod";

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  HOST: z.string().default("0.0.0.0"),
  OPENAI_API_KEY: z.string().min(1, "OPENAI_API_KEY is required"),
  OPENAI_MODEL: z.string().default("gpt-4o-mini"),
  REDIS_URL: z.string().url().default("redis://localhost:6379"),
  CORS_ORIGIN: z.string().default("http://localhost:3000"),
  // Proxy addresses allowed to set X-Forwarded-For (proxy-addr names or CIDRs; "" disables).
  // Defaults to private ranges (Ingress controller / Next.js rewrite inside the cluster). Trusting
  // every hop would let clients spoof their IP and bypass the per-IP rate limit.
  TRUST_PROXY: z.string().default("loopback,linklocal,uniquelocal"),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
  RATE_LIMIT_WINDOW: z.string().default("1 minute"),
  CACHE_TTL_SECONDS: z.coerce.number().int().nonnegative().default(3600),
});

export type Env = z.infer<typeof EnvSchema>;

// Fail fast on boot: a misconfigured pod should crash-loop, not serve 500s.
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = EnvSchema.safeParse(source);
  if (!result.success) {
    throw new Error(`Invalid environment:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
