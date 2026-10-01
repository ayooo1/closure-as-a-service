import type { GenerateRequest, TextGenerator } from "../lib/generator.js";

/** A generator that streams `text` in `parts` chunks, like the model emitting JSON tokens. */
export function streamingGenerator(text: string, { parts = 4, delayMs = 0, stopReason = "end_turn" } = {}) {
  const size = Math.ceil(text.length / parts);
  const chunks = Array.from({ length: parts }, (_, i) => text.slice(i * size, (i + 1) * size)).filter(Boolean);
  const calls: GenerateRequest[] = [];
  const generate: TextGenerator = async function* (req) {
    calls.push(req);
    for (const chunk of chunks) {
      if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
      yield chunk;
    }
    return stopReason;
  };
  return Object.assign(generate, { calls });
}

/** A generator whose API call fails before any output (bad key, quota, outage). */
export function failingGenerator(message = "401 invalid x-api-key") {
  const calls: GenerateRequest[] = [];
  // eslint-disable-next-line require-yield -- fails before yielding, like a rejected API call
  const generate: TextGenerator = async function* (req) {
    calls.push(req);
    throw new Error(message);
  };
  return Object.assign(generate, { calls });
}

export const SAMPLE_GENERATION = {
  safetyConcern: false,
  variations: [
    { angle: "Short and kind", message: "I've realised I don't see a future for us, and I'm ending things." },
    { angle: "With a reason", message: "I need to focus on myself right now, so I'm ending our relationship." },
    { angle: "Grateful", message: "I've valued our time together, but I've decided this is the end for us." },
  ],
};
