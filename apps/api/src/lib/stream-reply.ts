import { Readable } from "node:stream";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { z } from "zod";
import type { TextGenerator } from "./generator.js";

function isValid(schema: z.ZodType, text: string): boolean {
  try {
    return schema.safeParse(JSON.parse(text)).success;
  } catch {
    return false;
  }
}

/**
 * Streams a structured generation to the client as JSON text.
 *
 * - Waits for the first token before committing to a 200, so an upstream failure (bad key,
 *   quota, outage) becomes a 502 instead of an empty success.
 * - Aborts the model call if the client disconnects, so nobody pays for unread tokens.
 * - Mid-stream errors propagate and abort the response: the client sees a failed request,
 *   not a silently truncated success.
 * - Calls onComplete only for output that finished normally and matches the schema
 *   (never for refusals, truncation or malformed JSON).
 */
export async function streamStructured(
  req: FastifyRequest,
  reply: FastifyReply,
  opts: {
    generate: TextGenerator;
    system: string;
    prompt: string;
    schema: z.ZodType;
    onComplete?: (text: string) => void;
  },
) {
  const abort = new AbortController();
  reply.raw.on("close", () => {
    if (!reply.raw.writableFinished) abort.abort();
  });

  const tokens = opts.generate({ system: opts.system, prompt: opts.prompt, schema: opts.schema, signal: abort.signal });

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

  async function* relay(firstChunk: string) {
    let text = firstChunk;
    yield firstChunk;
    let next = await tokens.next();
    for (; !next.done; next = await tokens.next()) {
      text += next.value;
      yield next.value;
    }
    if (next.value === "end_turn" && isValid(opts.schema, text)) {
      opts.onComplete?.(text);
    } else {
      req.log.warn({ stopReason: next.value }, "generation incomplete or invalid");
    }
  }
  return reply.type("text/plain; charset=utf-8").send(Readable.from(relay(first.value)));
}
