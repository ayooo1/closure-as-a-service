import { Readable } from "node:stream";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { z } from "zod";
import type { GenerationOutcome, TextGenerator } from "./generator.js";
import type { GenerationObservation } from "./metrics.js";

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
 * - Logs one line per finished generation with its latency and token usage, for cost and speed tracking,
 *   and reports how every generation ended to onFinish (for metrics), including failures.
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
    onFinish?: (observation: Omit<GenerationObservation, "route">) => void;
  },
) {
  const abort = new AbortController();
  reply.raw.on("close", () => {
    if (!reply.raw.writableFinished) abort.abort();
  });

  const started = performance.now();
  const elapsed = () => Math.round(performance.now() - started);
  const tokens = opts.generate({ system: opts.system, prompt: opts.prompt, schema: opts.schema, signal: abort.signal });

  let first: IteratorResult<string, GenerationOutcome>;
  try {
    first = await tokens.next();
  } catch (err) {
    req.log.error({ err }, "generation failed");
    opts.onFinish?.({ result: abort.signal.aborted ? "aborted" : "failed", totalMs: elapsed() });
    return reply.code(502).send({ error: "generation_failed" });
  }
  if (first.done) {
    req.log.warn({ stopReason: first.value.stopReason }, "generation produced no output");
    opts.onFinish?.({ result: "failed", totalMs: elapsed(), usage: first.value.usage });
    return reply.code(502).send({ error: "generation_failed" });
  }

  const firstTokenMs = elapsed();

  async function* relay(firstChunk: string) {
    let text = firstChunk;
    yield firstChunk;
    let next: IteratorResult<string, GenerationOutcome> | undefined;
    let failed = false;
    try {
      for (next = await tokens.next(); !next.done; next = await tokens.next()) {
        text += next.value;
        yield next.value;
      }
    } catch (err) {
      failed = !abort.signal.aborted;
      throw err;
    } finally {
      // Not done: the model failed midway, or the client left. Leaving either aborts the model
      // call mid-read or stops this generator at a yield (return() skips the catch above).
      if (!next?.done) opts.onFinish?.({ result: failed ? "failed" : "aborted", firstTokenMs, totalMs: elapsed() });
    }
    const { stopReason, usage } = next.value;
    const ok = stopReason === "end_turn" && isValid(opts.schema, text);
    const totalMs = elapsed();
    req.log[ok ? "info" : "warn"](
      { url: req.url, stopReason, firstTokenMs, totalMs, ...usage },
      ok ? "generation finished" : "generation incomplete or invalid",
    );
    opts.onFinish?.({ result: ok ? "ok" : "incomplete", firstTokenMs, totalMs, usage });
    if (ok) opts.onComplete?.(text);
  }
  return reply.type("text/plain; charset=utf-8").send(Readable.from(relay(first.value)));
}
