import type { FastifyPluginAsync } from "fastify";
import {
  GenerationSchema,
  QuestionnaireSchema,
  RefinedSchema,
  RefineRequestSchema,
  RepliesRequestSchema,
  RepliesSchema,
} from "@caas/shared";
import type { z } from "zod";
import { cacheKey, type GenerationCache } from "../lib/cache.js";
import type { TextGenerator } from "../lib/generator.js";
import {
  buildPrompt,
  buildRefinePrompt,
  buildRepliesPrompt,
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
}

// rateLimit: {} opts in with the plugin-level max/window (Redis-backed, shared across replicas).
const ROUTE_OPTIONS = { bodyLimit: 8 * 1024, config: { rateLimit: {} } };

function invalid(error: z.ZodError) {
  return {
    error: "invalid_request",
    issues: error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
  };
}

export const generateRoutes: FastifyPluginAsync<GenerateDeps> = async (app, { generate, modelId, cache }) => {
  // Every response body is the route's schema as JSON text: complete on a cache hit, otherwise
  // streamed token by token. The client parses partial JSON as it arrives.
  app.addHook("onSend", async (_req, reply) => {
    reply.header("cache-control", "no-store");
  });

  app.post("/generate", { ...ROUTE_OPTIONS, bodyLimit: 4 * 1024 }, async (req, reply) => {
    const parsed = QuestionnaireSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send(invalid(parsed.error));
    const questionnaire = parsed.data;

    // Answers with a name or personal details are private and practically never repeat, so
    // they are never cached: no benefit, and no reason to keep someone's story in Redis.
    const cacheable = !questionnaire.name && !questionnaire.details;
    const key = cacheKey(questionnaire, modelId);

    const cached = cacheable ? await cache.get(key) : null;
    if (cached) {
      return reply.header("x-cache", "hit").type("text/plain; charset=utf-8").send(cached);
    }

    reply.header("x-cache", cacheable ? "miss" : "skip");
    return streamStructured(req, reply, {
      generate,
      system: SYSTEM_PROMPT,
      prompt: buildPrompt(questionnaire),
      schema: GenerationSchema,
      onComplete: cacheable ? (text) => void cache.set(key, text) : undefined,
    });
  });

  // Follow-ups carry the chosen message (often with a name in it), so they're never cached.
  app.post("/refine", ROUTE_OPTIONS, async (req, reply) => {
    const parsed = RefineRequestSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send(invalid(parsed.error));
    const { questionnaire, message, refinement } = parsed.data;

    return streamStructured(req, reply, {
      generate,
      system: REFINE_SYSTEM_PROMPT,
      prompt: buildRefinePrompt(questionnaire, message, refinement),
      schema: RefinedSchema,
    });
  });

  app.post("/replies", ROUTE_OPTIONS, async (req, reply) => {
    const parsed = RepliesRequestSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send(invalid(parsed.error));
    const { questionnaire, message } = parsed.data;

    return streamStructured(req, reply, {
      generate,
      system: REPLIES_SYSTEM_PROMPT,
      prompt: buildRepliesPrompt(questionnaire, message),
      schema: RepliesSchema,
    });
  });
};
