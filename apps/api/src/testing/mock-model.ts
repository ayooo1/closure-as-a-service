import { simulateReadableStream } from "ai";
import { MockLanguageModelV2 } from "ai/test";

/** A model that streams `text` in `parts` chunks, like a provider emitting JSON tokens. */
export function streamingModel(text: string, parts = 4, chunkDelayInMs?: number) {
  const size = Math.ceil(text.length / parts);
  const deltas = Array.from({ length: parts }, (_, i) => text.slice(i * size, (i + 1) * size)).filter(Boolean);
  return new MockLanguageModelV2({
    modelId: "mock-model",
    doStream: async () => ({
      stream: simulateReadableStream({
        chunkDelayInMs,
        chunks: [
          { type: "stream-start", warnings: [] },
          { type: "text-start", id: "t" },
          ...deltas.map((delta) => ({ type: "text-delta" as const, id: "t", delta })),
          { type: "text-end", id: "t" },
          {
            type: "finish",
            finishReason: "stop",
            usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
          },
        ],
      }),
    }),
  });
}

/** A model whose provider call fails outright (bad key, quota, outage). */
export function failingModel(message = "401 Unauthorized") {
  return new MockLanguageModelV2({
    modelId: "mock-model",
    doStream: async () => {
      throw new Error(message);
    },
  });
}

export const SAMPLE_GENERATION = {
  variations: [
    { angle: "Short and kind", message: "I've realised I don't see a future for us, and I'm ending things." },
    { angle: "With a reason", message: "I need to focus on myself right now, so I'm ending our relationship." },
    { angle: "Grateful", message: "I've valued our time together, but I've decided this is the end for us." },
  ],
};
