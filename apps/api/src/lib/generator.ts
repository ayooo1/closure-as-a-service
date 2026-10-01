import type Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";
import type { AiEffort, AiModel } from "../config.js";

export interface GenerateRequest {
  system: string;
  prompt: string;
  /** The JSON shape the model must produce. */
  schema: z.ZodType;
  signal: AbortSignal;
}

/** Yields text deltas of the schema's JSON as the model writes them; returns the stop reason. */
export type TextGenerator = (req: GenerateRequest) => AsyncGenerator<string, string | null>;

// Opus 5.5 takes an effort level and server-side refusal fallbacks; Haiku 4.5 rejects both.
const SUPPORTS_EFFORT_AND_FALLBACKS: ReadonlySet<AiModel> = new Set(["claude-opus-5-5"]);

type StreamClient = { beta: { messages: Pick<Anthropic["beta"]["messages"], "stream"> } };

export function createClaudeGenerator(client: StreamClient, model: AiModel, effort?: AiEffort): TextGenerator {
  const advanced = SUPPORTS_EFFORT_AND_FALLBACKS.has(model);
  // The app uses a handful of fixed schemas; convert each to an output format once.
  const formats = new Map<z.ZodType, ReturnType<typeof betaZodOutputFormat>>();
  const formatFor = (schema: z.ZodType) => {
    let format = formats.get(schema);
    if (!format) formats.set(schema, (format = betaZodOutputFormat(schema)));
    return format;
  };

  return async function* ({ system, prompt, schema, signal }) {
    const stream = client.beta.messages.stream(
      {
        model,
        // Outputs are a few hundred tokens; the headroom covers Opus's adaptive thinking, which counts toward the cap.
        max_tokens: 16_000,
        system,
        messages: [{ role: "user", content: prompt }],
        output_config: { format: formatFor(schema), ...(advanced && effort ? { effort } : {}) },
        // On a policy decline, the API re-runs the request on a fallback model within the same stream.
        ...(advanced ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
      },
      { signal },
    );
    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        yield event.delta.text;
      }
    }
    return (await stream.finalMessage()).stop_reason;
  };
}
