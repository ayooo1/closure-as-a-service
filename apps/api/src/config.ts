import { z } from "zod";

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  HOST: z.string().default("0.0.0.0"),
  OPENAI_API_KEY: z.string().min(1, "OPENAI_API_KEY is required"),
  OPENAI_MODEL: z.string().default("gpt-4o-mini"),
  REDIS_URL: z.string().url().default("redis://localhost:6379"),
  CORS_ORIGIN: z.string().default("http://localhost:3000"),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
  RATE_LIMIT_WINDOW: z.string().default("1 minute"),
  CACHE_TTL_SECONDS: z.coerce.number().int().nonnegative().default(3600),
});

export type Env = z.infer<typeof EnvSchema>;

// Fail fast on boot: a misconfigured pod should crash-loop, not serve 500s.
export const env: Env = EnvSchema.parse(process.env);
