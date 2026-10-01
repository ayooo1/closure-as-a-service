import { collectDefaultMetrics, Counter, Histogram, Registry } from "prom-client";
import { EndingSchema } from "@caas/shared";

/** Routes that call the model. */
export const MODEL_ROUTES = ["/api/generate", "/api/refine", "/api/replies", "/api/practice", "/api/logistics"] as const;
const GENERATION_RESULTS = ["ok", "incomplete", "failed", "aborted"] as const;
const CACHE_RESULTS = ["hit", "miss", "skip"] as const;

/**
 * How a generation ended: valid output; output that was cut off, refused or failed the schema;
 * an error from the model; or the client leaving mid-stream (the call is aborted).
 */
export type GenerationResult = (typeof GENERATION_RESULTS)[number];
export type CacheResult = (typeof CACHE_RESULTS)[number];

export interface GenerationObservation {
  route: string;
  result: GenerationResult;
  /** Undefined when the model failed before its first token. */
  firstTokenMs?: number;
  totalMs: number;
  usage?: { inputTokens: number; outputTokens: number };
}

// Model calls take ~0.5-10 s; HTTP requests also include ~5 ms cache hits.
const MODEL_BUCKETS = [0.25, 0.5, 1, 1.5, 2, 3, 5, 8, 13, 20, 30];
const HTTP_BUCKETS = [0.005, 0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 3, 5, 8, 13, 20, 30];

/**
 * Prometheus metrics for the API. Each server gets its own registry, so tests (and anything else
 * building several servers in one process) never collide on metric names.
 */
export function createMetrics({ model, version }: { model: string; version: string }) {
  const registry = new Registry();
  registry.setDefaultLabels({ model, version });
  // Process CPU, memory, GC and event loop lag.
  collectDefaultMetrics({ register: registry });

  const httpDuration = new Histogram({
    name: "caas_http_request_duration_seconds",
    help: "Time to serve an API request, including streaming the whole response",
    labelNames: ["method", "route", "status"] as const,
    buckets: HTTP_BUCKETS,
    registers: [registry],
  });
  const generations = new Counter({
    name: "caas_generations_total",
    help: "Model calls by route and how they ended",
    labelNames: ["route", "result"] as const,
    registers: [registry],
  });
  const firstToken = new Histogram({
    name: "caas_generation_first_token_seconds",
    help: "Time from calling the model to its first output token",
    labelNames: ["route"] as const,
    buckets: MODEL_BUCKETS,
    registers: [registry],
  });
  const generationDuration = new Histogram({
    name: "caas_generation_duration_seconds",
    help: "Time from calling the model to the end of its output",
    labelNames: ["route", "result"] as const,
    buckets: MODEL_BUCKETS,
    registers: [registry],
  });
  const tokens = new Counter({
    name: "caas_tokens_total",
    help: "Billed model tokens, by route and direction (input or output)",
    labelNames: ["route", "type"] as const,
    registers: [registry],
  });
  const cache = new Counter({
    name: "caas_cache_requests_total",
    help: "Cacheable-route requests by cache result (skip: holds personal text, never cached)",
    labelNames: ["route", "result"] as const,
    registers: [registry],
  });
  const votes = new Counter({
    name: "caas_feedback_votes_total",
    help: "Helpful / not helpful votes, by kind of ending",
    labelNames: ["vote", "ending"] as const,
    registers: [registry],
  });

  // Start every known series at 0. Prometheus can't see a counter's first increments if the series
  // only appears once it's already 1, so rates, increases and ratios would undercount new series.
  for (const route of MODEL_ROUTES) {
    for (const result of GENERATION_RESULTS) generations.inc({ route, result }, 0);
    for (const result of CACHE_RESULTS) cache.inc({ route, result }, 0);
    for (const type of ["input", "output"]) tokens.inc({ route, type }, 0);
  }
  for (const ending of EndingSchema.options) {
    for (const vote of ["up", "down"]) votes.inc({ vote, ending }, 0);
  }

  return {
    registry,
    observeRequest(method: string, route: string, status: number, seconds: number) {
      httpDuration.observe({ method, route, status: String(status) }, seconds);
    },
    observeGeneration({ route, result, firstTokenMs, totalMs, usage }: GenerationObservation) {
      generations.inc({ route, result });
      if (firstTokenMs !== undefined) firstToken.observe({ route }, firstTokenMs / 1000);
      generationDuration.observe({ route, result }, totalMs / 1000);
      if (usage) {
        tokens.inc({ route, type: "input" }, usage.inputTokens);
        tokens.inc({ route, type: "output" }, usage.outputTokens);
      }
    },
    observeCache(route: string, result: CacheResult) {
      cache.inc({ route, result });
    },
    observeVote(vote: string, ending: string) {
      votes.inc({ vote, ending });
    },
  };
}

export type Metrics = ReturnType<typeof createMetrics>;
