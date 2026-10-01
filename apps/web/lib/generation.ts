import { Allow, parse } from "partial-json";
import type { Generation, QuestionnaireInput } from "@caas/shared";

export type Variation = Generation["variations"][number];
/** A variation as it streams in: fields appear (and grow) as the model writes them. */
export type PartialVariation = Partial<Variation>;

export type GenerationErrorKind = "rate_limited" | "invalid" | "failed" | "network";

export class GenerationError extends Error {
  constructor(
    readonly kind: GenerationErrorKind,
    message: string,
    /** Seconds until the rate limit resets (rate_limited only). */
    readonly retryAfter?: number,
  ) {
    super(message);
    this.name = "GenerationError";
  }
}

function toVariations(text: string): PartialVariation[] {
  let value: unknown;
  try {
    value = parse(text, Allow.ALL);
  } catch {
    return []; // not enough text yet to say anything
  }
  const variations = (value as { variations?: unknown } | null)?.variations;
  if (!Array.isArray(variations)) return [];
  return variations.filter((v): v is PartialVariation => typeof v === "object" && v !== null);
}

async function errorFor(res: Response): Promise<GenerationError> {
  if (res.status === 429) {
    const retryAfter = Number(res.headers.get("retry-after")) || undefined;
    return new GenerationError("rate_limited", "Too many requests. Take a breath and try again shortly.", retryAfter);
  }
  if (res.status === 400 || res.status === 413) {
    return new GenerationError("invalid", "Some answers weren't valid. Please check them and try again.");
  }
  return new GenerationError("failed", "We couldn't write your messages right now. Please try again.");
}

/**
 * POSTs the questionnaire and yields the variations parsed so far after every chunk.
 * The last yield is the complete result. Throws GenerationError on failure; an abort
 * via `signal` ends quietly with an AbortError like any fetch.
 */
export async function* streamGeneration(
  input: QuestionnaireInput,
  { signal, fetchImpl = fetch }: { signal?: AbortSignal; fetchImpl?: typeof fetch } = {},
): AsyncGenerator<PartialVariation[]> {
  let res: Response;
  try {
    res = await fetchImpl("/api/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
      signal,
    });
  } catch (err) {
    if (signal?.aborted) throw err;
    throw new GenerationError("network", "Couldn't reach the server. Check your connection and try again.");
  }
  if (!res.ok || !res.body) throw await errorFor(res);

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let text = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      text += value;
      yield toVariations(text);
    }
  } catch (err) {
    if (signal?.aborted) throw err;
    throw new GenerationError("network", "The connection dropped while writing. Please try again.");
  }

  // The server ends the stream on success; anything unparseable at the end is a failure.
  try {
    JSON.parse(text);
  } catch {
    throw new GenerationError("failed", "The messages came back incomplete. Please try again.");
  }
}

/** iOS and Android both accept `sms:?&body=`; there's no recipient, the user picks one. */
export function smsHref(message: string): string {
  return `sms:?&body=${encodeURIComponent(message)}`;
}

export function mailtoHref(message: string): string {
  return `mailto:?body=${encodeURIComponent(message)}`;
}
