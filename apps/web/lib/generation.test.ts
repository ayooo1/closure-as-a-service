// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { GenerationError, mailtoHref, smsHref, streamGeneration, type PartialVariation } from "./generation";

const INPUT = { duration: "1-3-years", reason: "different-goals", tone: "warm", medium: "text" } as const;
const FULL = JSON.stringify({
  variations: [
    { angle: "Brief", message: "It's over." },
    { angle: "Kind", message: "I care about you, but this is the end." },
  ],
});

function streamingResponse(chunks: string[], init?: ResponseInit) {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(new TextEncoder().encode(c));
      controller.close();
    },
  });
  return new Response(body, { status: 200, ...init });
}

async function collect(gen: AsyncGenerator<PartialVariation[]>) {
  const out: PartialVariation[][] = [];
  for await (const v of gen) out.push(v);
  return out;
}

describe("streamGeneration", () => {
  it("POSTs the questionnaire as JSON", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(streamingResponse([FULL]));
    await collect(streamGeneration(INPUT, { fetchImpl }));

    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/generate",
      expect.objectContaining({ method: "POST", body: JSON.stringify(INPUT) }),
    );
  });

  it("yields growing partial variations as chunks arrive, ending with the full result", async () => {
    const chunks = [FULL.slice(0, 30), FULL.slice(30, 60), FULL.slice(60)];
    const fetchImpl = vi.fn().mockResolvedValue(streamingResponse(chunks));
    const yields = await collect(streamGeneration(INPUT, { fetchImpl }));

    expect(yields).toHaveLength(3);
    expect(yields[0]).toEqual([{ angle: "Brief" }]); // '{"variations":[{"angle":"Brief' (no message yet)
    expect(yields[1]).toEqual([{ angle: "Brief", message: "It's over." }, {}]);
    expect(yields.at(-1)).toEqual((JSON.parse(FULL) as { variations: unknown[] }).variations);
  });

  it("handles multi-byte characters split across chunks", async () => {
    const text = JSON.stringify({ variations: [{ angle: "Warm", message: "I’m sorry — truly 💔" }] });
    const bytes = new TextEncoder().encode(text);
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        // Split inside the 4-byte emoji.
        const cut = bytes.length - 5;
        c.enqueue(bytes.slice(0, cut));
        c.enqueue(bytes.slice(cut));
        c.close();
      },
    });
    const yields = await collect(streamGeneration(INPUT, { fetchImpl: vi.fn().mockResolvedValue(new Response(body)) }));
    expect(yields.at(-1)![0]!.message).toBe("I’m sorry — truly 💔");
  });

  it.each([
    [429, "rate_limited", { "retry-after": "42" }, 42],
    [400, "invalid", {}, undefined],
    [413, "invalid", {}, undefined],
    [502, "failed", {}, undefined],
    [500, "failed", {}, undefined],
  ])("maps HTTP %i to a %s error", async (status, kind, headers, retryAfter) => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("{}", { status, headers }));
    const err = await collect(streamGeneration(INPUT, { fetchImpl })).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(GenerationError);
    expect(err).toMatchObject({ kind, retryAfter });
  });

  it("reports a network error when the request can't be sent", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    await expect(collect(streamGeneration(INPUT, { fetchImpl }))).rejects.toMatchObject({ kind: "network" });
  });

  it("reports a failure when the stream ends with incomplete JSON", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(streamingResponse([FULL.slice(0, 40)]));
    await expect(collect(streamGeneration(INPUT, { fetchImpl }))).rejects.toMatchObject({ kind: "failed" });
  });

  it("reports a network error when the connection drops mid-stream", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new TextEncoder().encode(FULL.slice(0, 20)));
        c.error(new TypeError("terminated"));
      },
    });
    const fetchImpl = vi.fn().mockResolvedValue(new Response(body));
    await expect(collect(streamGeneration(INPUT, { fetchImpl }))).rejects.toMatchObject({ kind: "network" });
  });

  it("rethrows the abort (not a GenerationError) when the caller cancels", async () => {
    const abort = new AbortController();
    abort.abort();
    const fetchImpl = vi.fn().mockRejectedValue(new DOMException("aborted", "AbortError"));
    const err = await collect(streamGeneration(INPUT, { fetchImpl, signal: abort.signal })).catch((e: unknown) => e);

    expect(err).not.toBeInstanceOf(GenerationError);
    expect(err).toMatchObject({ name: "AbortError" });
  });
});

describe("share links", () => {
  it("builds an sms: link with the message encoded", () => {
    expect(smsHref("It's over & I'm sorry")).toBe("sms:?&body=It's%20over%20%26%20I'm%20sorry");
  });

  it("builds a mailto: link with the message encoded, keeping line breaks", () => {
    expect(mailtoHref("Hi,\n\nBye")).toBe("mailto:?body=Hi%2C%0A%0ABye");
  });
});
