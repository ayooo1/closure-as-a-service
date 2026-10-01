import { Readable } from "node:stream";
import type { FastifyPluginAsync } from "fastify";
import { streamObject, type LanguageModel } from "ai";
import { GenerationSchema, QuestionnaireSchema } from "@caas/shared";
import { cacheKey, type GenerationCache } from "../lib/cache.js";
import { buildPrompt, SYSTEM_PROMPT } from "../lib/prompt.js";

export interface GenerateDeps {
  model: LanguageModel;
  cache: GenerationCache;
}

export const generateRoutes: FastifyPluginAsync<GenerateDeps> = async (app, { model, cache }) => {
  const modelId = typeof model === "string" ? model : model.modelId;

  app.post(
    "/generate",
    // rateLimit: {} opts in with the plugin-level max/window (Redis-backed, shared across replicas).
    { bodyLimit: 4 * 1024, config: { rateLimit: {} } },
    async (req, reply) => {
      const parsed = QuestionnaireSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: "invalid_request",
          issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
        });
      }
      const questionnaire = parsed.data;
      const key = cacheKey(questionnaire, modelId);

      // Body is the GenerationSchema object as JSON text, either complete (cache hit) or
      // streamed token by token (miss); the client parses partial JSON as it arrives.
      reply.header("cache-control", "no-store");

      const cached = await cache.get(key);
      if (cached) {
        return reply.header("x-cache", "hit").type("text/plain; charset=utf-8").send(cached);
      }

      // Stop paying for tokens nobody will read if the client disconnects mid-stream.
      const abort = new AbortController();
      reply.raw.on("close", () => {
        if (!reply.raw.writableFinished) abort.abort();
      });

      let failure: unknown;
      const result = streamObject({
        model,
        schema: GenerationSchema,
        schemaName: "breakup_messages",
        system: SYSTEM_PROMPT,
        prompt: buildPrompt(questionnaire),
        temperature: 0.9,
        maxOutputTokens: 1500,
        abortSignal: abort.signal,
        onError: ({ error }) => {
          failure = error;
          if (!abort.signal.aborted) req.log.error({ err: error }, "generation failed");
        },
        onFinish: ({ object }) => {
          // Only complete, schema-valid generations are cached.
          if (object) void cache.set(key, JSON.stringify(object));
        },
      });

      // Wait for the first chunk before committing to a 200, so an upstream failure
      // (bad key, quota, outage) surfaces as a 502 instead of an empty success.
      const reader = result.textStream.getReader();
      const first = await reader.read();
      if (first.done) {
        req.log.warn({ err: failure }, "generation produced no output");
        return reply.code(502).send({ error: "generation_failed" });
      }

      async function* chunks() {
        yield first.value;
        for (let next = await reader.read(); !next.done; next = await reader.read()) {
          yield next.value;
        }
      }
      return reply.header("x-cache", "miss").type("text/plain; charset=utf-8").send(Readable.from(chunks()));
    },
  );
};
