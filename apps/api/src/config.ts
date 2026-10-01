import { z } from "zod";

export const AI_MODELS = ["claude-haiku-4-5", "claude-opus-5-5"] as const;
export type AiModel = (typeof AI_MODELS)[number];
export const AI_EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
export type AiEffort = (typeof AI_EFFORTS)[number];

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  HOST: z.string().default("0.0.0.0"),
  ANTHROPIC_API_KEY: z.string().min(1, "ANTHROPIC_API_KEY is required"),
  // Haiku 4.5: fast and cheap. Opus 5.5: most thoughtful, slower, ~4x the price.
  AI_MODEL: z.enum(AI_MODELS).default("claude-haiku-4-5"),
  // Opus only (Haiku ignores it); unset uses the model's default.
  AI_EFFORT: z.enum(AI_EFFORTS).optional(),
  REDIS_URL: z.string().url().default("redis://localhost:6379"),
  CORS_ORIGIN: z.string().default("http://localhost:3000"),
  // Proxy addresses allowed to set X-Forwarded-For (proxy-addr names or CIDRs; "" disables).
  // Defaults to private ranges (Ingress controller / Next.js rewrite inside the cluster). Trusting
  // every hop would let clients spoof their IP and bypass the per-IP rate limit.
  TRUST_PROXY: z.string().default("loopback,linklocal,uniquelocal"),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
  RATE_LIMIT_WINDOW: z.string().default("1 minute"),
  CACHE_TTL_SECONDS: z.coerce.number().int().nonnegative().default(3600),
  // Baked into release images by CI (e.g. "1.2.0"); reported by /healthz.
  APP_VERSION: z.string().min(1).default("dev"),
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
