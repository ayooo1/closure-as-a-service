import type Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { GenerationSchema } from "@caas/shared";
import type { AiEffort, AiModel } from "../config.js";

export interface GenerateRequest {
  system: string;
  prompt: string;
  signal: AbortSignal;
}

/** Yields text deltas of the GenerationSchema JSON as the model writes them; returns the stop reason. */
export type TextGenerator = (req: GenerateRequest) => AsyncGenerator<string, string | null>;

// Opus 5.5 takes an effort level and server-side refusal fallbacks; Haiku 4.5 rejects both.
const SUPPORTS_EFFORT_AND_FALLBACKS: ReadonlySet<AiModel> = new Set(["claude-opus-5-5"]);

type StreamClient = { beta: { messages: Pick<Anthropic["beta"]["messages"], "stream"> } };

export function createClaudeGenerator(client: StreamClient, model: AiModel, effort?: AiEffort): TextGenerator {
  const format = betaZodOutputFormat(GenerationSchema);
  const advanced = SUPPORTS_EFFORT_AND_FALLBACKS.has(model);

  return async function* ({ system, prompt, signal }) {
    const stream = client.beta.messages.stream(
      {
        model,
        // Output is ~400 tokens; the headroom covers Opus's adaptive thinking, which counts toward the cap.
        max_tokens: 16_000,
        system,
        messages: [{ role: "user", content: prompt }],
        output_config: { format, ...(advanced && effort ? { effort } : {}) },
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
