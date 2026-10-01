import { Readable } from "node:stream";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { z } from "zod";
import type { GenerationOutcome, TextGenerator } from "./generator.js";

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
 * - Logs one line per finished generation with its latency and token usage, for cost and speed tracking.
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

  const started = performance.now();
  const tokens = opts.generate({ system: opts.system, prompt: opts.prompt, schema: opts.schema, signal: abort.signal });

  let first: IteratorResult<string, GenerationOutcome>;
  try {
    first = await tokens.next();
  } catch (err) {
    req.log.error({ err }, "generation failed");
    return reply.code(502).send({ error: "generation_failed" });
  }
  if (first.done) {
    req.log.warn({ stopReason: first.value.stopReason }, "generation produced no output");
    return reply.code(502).send({ error: "generation_failed" });
  }

  const firstTokenMs = Math.round(performance.now() - started);

  async function* relay(firstChunk: string) {
    let text = firstChunk;
    yield firstChunk;
    let next = await tokens.next();
    for (; !next.done; next = await tokens.next()) {
      text += next.value;
      yield next.value;
    }
    const { stopReason, usage } = next.value;
    const ok = stopReason === "end_turn" && isValid(opts.schema, text);
    req.log[ok ? "info" : "warn"](
      { url: req.url, stopReason, firstTokenMs, totalMs: Math.round(performance.now() - started), ...usage },
      ok ? "generation finished" : "generation incomplete or invalid",
    );
    if (ok) opts.onComplete?.(text);
  }
  return reply.type("text/plain; charset=utf-8").send(Readable.from(relay(first.value)));
}
