import type { FastifyPluginAsync } from "fastify";
import {
  FeedbackSchema,
  GenerationSchema,
  LogisticsRequestSchema,
  LogisticsSchema,
  PracticeReplySchema,
  PracticeRequestSchema,
  QuestionnaireSchema,
  type Questionnaire,
  RefinedSchema,
  RefineRequestSchema,
  RepliesRequestSchema,
  RepliesSchema,
} from "@caas/shared";
import type { z } from "zod";
import { cacheKey, type CacheKind, type GenerationCache } from "../lib/cache.js";
import type { FeedbackStore } from "../lib/feedback.js";
import type { TextGenerator } from "../lib/generator.js";
import type { Metrics } from "../lib/metrics.js";
import {
  buildLogisticsPrompt,
  buildPracticePrompt,
  buildPrompt,
  buildRefinePrompt,
  buildRepliesPrompt,
  LOGISTICS_SYSTEM_PROMPT,
  PRACTICE_SYSTEM_PROMPT,
  REFINE_SYSTEM_PROMPT,
  REPLIES_SYSTEM_PROMPT,
  SYSTEM_PROMPT,
} from "../lib/prompt.js";
import { streamStructured } from "../lib/stream-reply.js";

export interface GenerateDeps {
  generate: TextGenerator;
  /** Identifies the model + settings, so changing them doesn't serve stale cached output. */
  modelId: string;
  cache: GenerationCache;
  feedback: FeedbackStore;
  metrics: Metrics;
}

// rateLimit: {} opts in with the plugin-level max/window (Redis-backed, shared across replicas).
const ROUTE_OPTIONS = { bodyLimit: 8 * 1024, config: { rateLimit: {} } };

function invalid(error: z.ZodError) {
  return {
    error: "invalid_request",
    issues: error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
  };
}

// Answers with a name or personal details are private and practically never repeat, so nothing
// derived from them is cached: no benefit, and no reason to keep someone's story in Redis.
const isPrivate = (q: Questionnaire) => Boolean(q.name || q.details);

export const generateRoutes: FastifyPluginAsync<GenerateDeps> = async (app, { generate, modelId, cache, feedback, metrics }) => {
  // Every response body is the route's schema as JSON text: complete on a cache hit, otherwise
  // streamed token by token. The client parses partial JSON as it arrives.
  app.addHook("onSend", async (_req, reply) => {
    reply.header("cache-control", "no-store");
  });

  /**
   * Serves a cached result for `cache` (a key) when there is one; otherwise streams a fresh one
   * and caches it if it completes. A null key means the request is never cached.
   */
  async function respond(
    req: Parameters<typeof streamStructured>[0],
    reply: Parameters<typeof streamStructured>[1],
    key: string | null,
    opts: { system: string; prompt: string; schema: z.ZodType },
  ) {
    const route = req.routeOptions.url ?? req.url;
    const cached = key ? await cache.get(key) : null;
    if (cached) {
      metrics.observeCache(route, "hit");
      return reply.header("x-cache", "hit").type("text/plain; charset=utf-8").send(cached);
    }

    const result = key ? "miss" : "skip";
    metrics.observeCache(route, result);
    reply.header("x-cache", result);
    return streamStructured(req, reply, {
      generate,
      ...opts,
      onComplete: key ? (text) => void cache.set(key, text) : undefined,
      onFinish: (observation) => metrics.observeGeneration({ route, ...observation }),
    });
  }

  const keyFor = (kind: CacheKind, input: unknown) => cacheKey(kind, input, modelId);

  /**
   * Follow-ups carry a message the user may have edited (often adding a name), so they're cached
   * only when the message is word for word one we wrote for these anonymous answers: then the
   * request holds nothing personal, and everyone who picks that message gets an instant result.
   */
  async function followUpKey(kind: CacheKind, q: Questionnaire, message: string, input: unknown) {
    if (isPrivate(q)) return null;
    const generation = await cache.get(keyFor("gen", q));
    if (!generation) return null;
    try {
      const { variations } = GenerationSchema.parse(JSON.parse(generation));
      return variations.some((v) => v.message === message) ? keyFor(kind, input) : null;
    } catch {
      return null;
    }
  }

  app.post("/generate", { ...ROUTE_OPTIONS, bodyLimit: 4 * 1024 }, async (req, reply) => {
    const parsed = QuestionnaireSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send(invalid(parsed.error));
    const q = parsed.data;

    return respond(req, reply, isPrivate(q) ? null : keyFor("gen", q), {
      system: SYSTEM_PROMPT,
      prompt: buildPrompt(q),
      schema: GenerationSchema,
    });
  });

  app.post("/refine", ROUTE_OPTIONS, async (req, reply) => {
    const parsed = RefineRequestSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send(invalid(parsed.error));
    const { questionnaire, message, refinement } = parsed.data;

    return respond(req, reply, await followUpKey("refine", questionnaire, message, parsed.data), {
      system: REFINE_SYSTEM_PROMPT,
      prompt: buildRefinePrompt(questionnaire, message, refinement),
      schema: RefinedSchema,
    });
  });

  app.post("/replies", ROUTE_OPTIONS, async (req, reply) => {
    const parsed = RepliesRequestSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send(invalid(parsed.error));
    const { questionnaire, message } = parsed.data;

    return respond(req, reply, await followUpKey("replies", questionnaire, message, parsed.data), {
      system: REPLIES_SYSTEM_PROMPT,
      prompt: buildRepliesPrompt(questionnaire, message),
      schema: RepliesSchema,
    });
  });

  // Notes are free text, so only note-free requests from anonymous answers are cached.
  app.post("/logistics", ROUTE_OPTIONS, async (req, reply) => {
    const parsed = LogisticsRequestSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send(invalid(parsed.error));
    const { questionnaire, topics, notes, safetyConcern } = parsed.data;

    return respond(req, reply, isPrivate(questionnaire) || notes ? null : keyFor("logistics", parsed.data), {
      system: LOGISTICS_SYSTEM_PROMPT,
      prompt: buildLogisticsPrompt(questionnaire, topics, notes, safetyConcern),
      schema: LogisticsSchema,
    });
  });

  // Up to 16 turns of 1000 characters plus the opening message; 40 KB leaves room for multi-byte text.
  // Only the opening reaction can be cached: after that, the transcript holds the user's own words.
  app.post("/practice", { ...ROUTE_OPTIONS, bodyLimit: 40 * 1024 }, async (req, reply) => {
    const parsed = PracticeRequestSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send(invalid(parsed.error));
    const { questionnaire, message, turns } = parsed.data;

    const key = turns.length === 0 ? await followUpKey("practice", questionnaire, message, parsed.data) : null;
    return respond(req, reply, key, {
      system: PRACTICE_SYSTEM_PROMPT,
      prompt: buildPracticePrompt(questionnaire, message, turns),
      schema: PracticeReplySchema,
    });
  });

  app.post("/feedback", { ...ROUTE_OPTIONS, bodyLimit: 1024 }, async (req, reply) => {
    const parsed = FeedbackSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send(invalid(parsed.error));
    try {
      await feedback.record(parsed.data, modelId);
      metrics.observeVote(parsed.data.vote, parsed.data.ending);
    } catch (err) {
      req.log.warn({ err }, "feedback not recorded");
      return reply.code(503).send({ error: "unavailable" });
    }
    return reply.code(204).send();
  });
};
