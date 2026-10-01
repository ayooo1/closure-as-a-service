import { describe, expect, it, vi } from "vitest";
import { GenerationSchema, RepliesSchema } from "@caas/shared";
import { createClaudeGenerator } from "./generator.js";

// A stand-in for client.beta.messages.stream: replays SSE events, then resolves the final message.
function fakeClient(events: object[], stopReason = "end_turn") {
  const stream = vi.fn(() => ({
    async *[Symbol.asyncIterator]() {
      for (const e of events) yield e;
    },
    finalMessage: async () => ({ stop_reason: stopReason }),
  }));
  return { client: { beta: { messages: { stream } } } as never, stream };
}

const textDelta = (text: string) => ({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text } });
const req = { system: "sys", prompt: "prompt", schema: GenerationSchema, signal: new AbortController().signal };

async function drain(gen: AsyncGenerator<string, string | null>) {
  const chunks: string[] = [];
  let next = await gen.next();
  for (; !next.done; next = await gen.next()) chunks.push(next.value);
  return { chunks, stopReason: next.value };
}

describe("createClaudeGenerator", () => {
  it("yields only text deltas and returns the stop reason", async () => {
    const { client } = fakeClient([
      { type: "message_start", message: {} },
      { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "" } },
      { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "hmm" } },
      textDelta('{"variations":'),
      textDelta("[]}"),
      { type: "message_stop" },
    ]);
    const result = await drain(createClaudeGenerator(client, "claude-haiku-4-5")(req));
    expect(result).toEqual({ chunks: ['{"variations":', "[]}"], stopReason: "end_turn" });
  });

  it("passes the refusal stop reason through", async () => {
    const { client } = fakeClient([textDelta("{")], "refusal");
    const { stopReason } = await drain(createClaudeGenerator(client, "claude-opus-5-5")(req));
    expect(stopReason).toBe("refusal");
  });

  it("sends Haiku a plain structured-output request (no effort, no fallbacks)", async () => {
    const { client, stream } = fakeClient([]);
    await drain(createClaudeGenerator(client, "claude-haiku-4-5", "high")(req));

    const [params, options] = stream.mock.calls[0] as unknown as [Record<string, unknown>, { signal: AbortSignal }];
    expect(params).toMatchObject({
      model: "claude-haiku-4-5",
      system: "sys",
      messages: [{ role: "user", content: "prompt" }],
      output_config: { format: { type: "json_schema" } },
    });
    expect(params.output_config).not.toHaveProperty("effort");
    expect(params).not.toHaveProperty("fallbacks");
    expect(params).not.toHaveProperty("betas");
    expect(options.signal).toBe(req.signal);
  });

  it("enables refusal fallbacks for Opus, and effort only when configured", async () => {
    const { client, stream } = fakeClient([]);
    await drain(createClaudeGenerator(client, "claude-opus-5-5")(req));
    await drain(createClaudeGenerator(client, "claude-opus-5-5", "low")(req));

    const [withoutEffort, withEffort] = stream.mock.calls.map((c) => (c as unknown as [Record<string, unknown>])[0]);
    expect(withoutEffort).toMatchObject({ betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" });
    expect(withoutEffort!.output_config).not.toHaveProperty("effort");
    expect(withEffort!.output_config).toMatchObject({ effort: "low" });
  });

  it("constrains output to each request's schema, converting each schema once", async () => {
    const { client, stream } = fakeClient([]);
    const generate = createClaudeGenerator(client, "claude-haiku-4-5");
    await drain(generate(req));
    await drain(generate({ ...req, schema: RepliesSchema }));
    await drain(generate(req));

    const formats = stream.mock.calls.map(
      (c) => (c as unknown as [{ output_config: { format: { schema: unknown } } }])[0].output_config.format,
    );
    expect(JSON.stringify(formats[0]!.schema)).toContain('"safetyConcern"');
    expect(JSON.stringify(formats[1]!.schema)).toContain('"youCanSay"');
    expect(formats[2]).toBe(formats[0]); // reused, not rebuilt
  });
});
