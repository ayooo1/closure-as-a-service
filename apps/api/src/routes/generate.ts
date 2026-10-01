import { Readable } from "node:stream";
import type { FastifyPluginAsync } from "fastify";
import { GenerationSchema, QuestionnaireSchema } from "@caas/shared";
import { cacheKey, type GenerationCache } from "../lib/cache.js";
import type { TextGenerator } from "../lib/generator.js";
import { buildPrompt, SYSTEM_PROMPT } from "../lib/prompt.js";

export interface GenerateDeps {
  generate: TextGenerator;
  /** Identifies the model + settings, so changing them doesn't serve stale cached output. */
  modelId: string;
  cache: GenerationCache;
}

function isValidGeneration(text: string): boolean {
  try {
    return GenerationSchema.safeParse(JSON.parse(text)).success;
  } catch {
    return false;
  }
}

export const generateRoutes: FastifyPluginAsync<GenerateDeps> = async (app, { generate, modelId, cache }) => {
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

      const tokens = generate({ system: SYSTEM_PROMPT, prompt: buildPrompt(questionnaire), signal: abort.signal });

      // Wait for the first token before committing to a 200, so an upstream failure
      // (bad key, quota, outage) surfaces as a 502 instead of an empty success.
      let first: IteratorResult<string, string | null>;
      try {
        first = await tokens.next();
      } catch (err) {
        req.log.error({ err }, "generation failed");
        return reply.code(502).send({ error: "generation_failed" });
      }
      if (first.done) {
        req.log.warn({ stopReason: first.value }, "generation produced no output");
        return reply.code(502).send({ error: "generation_failed" });
      }

      // Mid-stream errors propagate and abort the response, so the client sees a failed
      // request rather than a silently truncated success.
      async function* relay(firstChunk: string) {
        let text = firstChunk;
        yield firstChunk;
        let next = await tokens.next();
        for (; !next.done; next = await tokens.next()) {
          text += next.value;
          yield next.value;
        }
        // Only complete, schema-valid generations are cached (not refusals or truncations).
        if (next.value === "end_turn" && isValidGeneration(text)) {
          void cache.set(key, text);
        } else {
          req.log.warn({ stopReason: next.value }, "generation incomplete or invalid; not cached");
        }
      }
      return reply.header("x-cache", "miss").type("text/plain; charset=utf-8").send(Readable.from(relay(first.value)));
    },
  );
};
