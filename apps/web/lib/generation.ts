import { Allow, parse } from "partial-json";
import type {
  Generation,
  QuestionnaireInput,
  RefineRequest,
  Refined,
  Replies,
  RepliesRequest,
} from "@caas/shared";

export type Variation = Generation["variations"][number];
/** A variation as it streams in: fields appear (and grow) as the model writes them. */
export type PartialVariation = Partial<Variation>;
export interface PartialGeneration {
  /** Arrives first; undefined until the model has written it. */
  safetyConcern?: boolean;
  variations: PartialVariation[];
}
export type PartialReply = Partial<Replies["replies"][number]>;

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

export interface StreamOptions {
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}

async function errorFor(res: Response): Promise<GenerationError> {
  if (res.status === 429) {
    const retryAfter = Number(res.headers.get("retry-after")) || undefined;
    return new GenerationError("rate_limited", "Too many requests. Take a breath and try again shortly.", retryAfter);
  }
  if (res.status === 400 || res.status === 413) {
    return new GenerationError("invalid", "Some answers weren't valid. Please check them and try again.");
  }
  return new GenerationError("failed", "We couldn't write that right now. Please try again.");
}

function parsePartial(text: string): Record<string, unknown> | null {
  try {
    const value: unknown = parse(text, Allow.ALL);
    return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
  } catch {
    return null; // not enough text yet to say anything
  }
}

const objectsIn = (value: unknown) =>
  Array.isArray(value) ? value.filter((v): v is Record<string, unknown> => typeof v === "object" && v !== null) : [];

/**
 * POSTs `body` as JSON and yields the response parsed so far (as partial JSON) after every
 * chunk; the last yield is the complete result. Throws GenerationError on failure; an abort
 * via `signal` rethrows the AbortError like any fetch.
 */
async function* streamJson<T>(
  url: string,
  body: unknown,
  shape: (partial: Record<string, unknown> | null) => T,
  { signal, fetchImpl = fetch }: StreamOptions = {},
): AsyncGenerator<T> {
  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
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
      yield shape(parsePartial(text));
    }
  } catch (err) {
    if (signal?.aborted) throw err;
    throw new GenerationError("network", "The connection dropped while writing. Please try again.");
  }

  // The server ends the stream on success; anything unparseable at the end is a failure.
  try {
    JSON.parse(text);
  } catch {
    throw new GenerationError("failed", "The response came back incomplete. Please try again.");
  }
}

export function streamGeneration(input: QuestionnaireInput, opts?: StreamOptions): AsyncGenerator<PartialGeneration> {
  return streamJson(
    "/api/generate",
    input,
    (p) => ({
      safetyConcern: typeof p?.safetyConcern === "boolean" ? p.safetyConcern : undefined,
      variations: objectsIn(p?.variations),
    }),
    opts,
  );
}

export function streamRefine(input: RefineRequest, opts?: StreamOptions): AsyncGenerator<Partial<Refined>> {
  return streamJson("/api/refine", input, (p) => (typeof p?.message === "string" ? { message: p.message } : {}), opts);
}

export function streamReplies(input: RepliesRequest, opts?: StreamOptions): AsyncGenerator<PartialReply[]> {
  return streamJson("/api/replies", input, (p) => objectsIn(p?.replies) as PartialReply[], opts);
}

/** iOS and Android both accept `sms:?&body=`; there's no recipient, the user picks one. */
export function smsHref(message: string): string {
  return `sms:?&body=${encodeURIComponent(message)}`;
}

export function mailtoHref(message: string): string {
  return `mailto:?body=${encodeURIComponent(message)}`;
}
