import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GenerationCache } from "../lib/cache.js";
import type { TextGenerator } from "../lib/generator.js";
import { SYSTEM_PROMPT } from "../lib/prompt.js";
import { failingGenerator, SAMPLE_GENERATION, streamingGenerator } from "../testing/fake-generator.js";
import { generateRoutes, type GenerateDeps } from "./generate.js";

const VALID = { duration: "1-3-years", reason: "different-goals", tone: "warm", medium: "text" };
const SAMPLE_JSON = JSON.stringify(SAMPLE_GENERATION);

function memoryCache(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  return {
    store,
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: string) => void store.set(key, value)),
  } satisfies GenerationCache & { store: Map<string, string> };
}

async function build(deps: Partial<GenerateDeps> = {}) {
  const app = Fastify();
  await app.register(generateRoutes, {
    prefix: "/api",
    generate: deps.generate ?? streamingGenerator(SAMPLE_JSON),
    modelId: deps.modelId ?? "claude-haiku-4-5:default",
    cache: deps.cache ?? memoryCache(),
  });
  return app;
}

const post = (app: Awaited<ReturnType<typeof build>>, payload: unknown) =>
  app.inject({ method: "POST", url: "/api/generate", payload: payload as object });

describe("POST /api/generate", () => {
  let app: Awaited<ReturnType<typeof build>> | undefined;
  afterEach(() => app?.close());

  it("streams the generation as JSON text and caches it", async () => {
    const cache = memoryCache();
    app = await build({ cache });

    const res = await post(app, VALID);
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("text/plain; charset=utf-8");
    expect(res.headers["x-cache"]).toBe("miss");
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(JSON.parse(res.body)).toEqual(SAMPLE_GENERATION);

    await vi.waitFor(() => expect(cache.set).toHaveBeenCalledOnce());
    expect(JSON.parse([...cache.store.values()][0]!)).toEqual(SAMPLE_GENERATION);
  });

  it("sends the system prompt and questionnaire to the generator", async () => {
    const generate = streamingGenerator(SAMPLE_JSON);
    app = await build({ generate });
    await post(app, { ...VALID, name: "Sam", details: "We met at uni" });

    const call = generate.calls[0]!;
    expect(call.system).toBe(SYSTEM_PROMPT);
    expect(call.prompt).toContain("Address them as Sam");
    expect(call.prompt).toContain("We met at uni");
    expect(call.signal).toBeInstanceOf(AbortSignal);
  });

  it("aborts the model call when the client disconnects mid-stream", async () => {
    const cache = memoryCache();
    const generate = streamingGenerator(SAMPLE_JSON, { parts: 20, delayMs: 50 });
    app = await build({ cache, generate });
    const url = await app.listen({ port: 0, host: "127.0.0.1" });

    const client = new AbortController();
    const res = await fetch(`${url}/api/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(VALID),
      signal: client.signal,
    });
    await res.body!.getReader().read(); // first chunk arrived: the stream is live
    client.abort();

    await vi.waitFor(() => expect(generate.calls[0]!.signal.aborted).toBe(true));
    expect(cache.set).not.toHaveBeenCalled();
  });

  it("serves identical requests from the cache without calling the model", async () => {
    const cache = memoryCache();
    const generate = streamingGenerator(SAMPLE_JSON);
    app = await build({ cache, generate });

    await post(app, VALID);
    await vi.waitFor(() => expect(cache.set).toHaveBeenCalledOnce());
    // Whitespace and empty optional fields normalise to the same key.
    const res = await post(app, { ...VALID, name: "  ", details: "" });

    expect(res.statusCode).toBe(200);
    expect(res.headers["x-cache"]).toBe("hit");
    expect(JSON.parse(res.body)).toEqual(SAMPLE_GENERATION);
    expect(generate.calls).toHaveLength(1);
  });

  it("keeps separate cache entries per model", async () => {
    const cache = memoryCache();
    app = await build({ cache, modelId: "claude-haiku-4-5:default" });
    await post(app, VALID);
    await app.close();
    const opus = streamingGenerator(SAMPLE_JSON);
    app = await build({ cache, generate: opus, modelId: "claude-opus-5-5:default" });

    const res = await post(app, VALID);
    expect(res.headers["x-cache"]).toBe("miss");
    expect(opus.calls).toHaveLength(1);
  });

  it.each([
    ["a refusal", SAMPLE_JSON, "refusal"],
    ["output cut off at max_tokens", SAMPLE_JSON.slice(0, 40), "max_tokens"],
    ["output that fails the schema", '{"variations":[{"angle":1}]}', "end_turn"],
    ["output that isn't JSON", "Sorry, I can't help with that.", "end_turn"],
  ])("streams but does not cache %s", async (_label, text, stopReason) => {
    const cache = memoryCache();
    app = await build({ cache, generate: streamingGenerator(text, { stopReason }) });

    const res = await post(app, VALID);
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe(text);
    expect(cache.set).not.toHaveBeenCalled();
  });

  it("returns 502 when the API call fails before any output", async () => {
    const cache = memoryCache();
    app = await build({ cache, generate: failingGenerator() });

    const res = await post(app, VALID);
    expect(res.statusCode).toBe(502);
    expect(res.json()).toEqual({ error: "generation_failed" });
    expect(cache.set).not.toHaveBeenCalled();
  });

  it("returns 502 when the model produces no output", async () => {
    // eslint-disable-next-line require-yield -- ends without output, like a pre-output refusal
    const empty: TextGenerator = async function* () {
      return "refusal";
    };
    app = await build({ generate: empty });

    const res = await post(app, VALID);
    expect(res.statusCode).toBe(502);
  });

  it("aborts the response and skips the cache when the stream fails midway", async () => {
    const cache = memoryCache();
    const flaky: TextGenerator = async function* () {
      yield '{"variations":[';
      throw new Error("overloaded");
    };
    app = await build({ cache, generate: flaky });

    await expect(post(app, VALID)).rejects.toThrow();
    expect(cache.set).not.toHaveBeenCalled();
  });

  it.each([
    ["an empty body", {}, "duration"],
    ["an unknown tone", { ...VALID, tone: "savage" }, "tone"],
    ["overly long details", { ...VALID, details: "x".repeat(501) }, "details"],
    ["a non-string name", { ...VALID, name: 42 }, "name"],
  ])("rejects %s with 400 naming the field", async (_label, payload, field) => {
    const generate = streamingGenerator(SAMPLE_JSON);
    app = await build({ generate });

    const res = await post(app, payload);
    expect(res.statusCode).toBe(400);
    const body = res.json<{ error: string; issues: { path: string; message: string }[] }>();
    expect(body.error).toBe("invalid_request");
    expect(body.issues.map((i) => i.path)).toContain(field);
    expect(generate.calls).toHaveLength(0);
  });

  it("rejects bodies over 4 KB with 413", async () => {
    app = await build();
    const res = await post(app, { ...VALID, padding: "x".repeat(5000) });
    expect(res.statusCode).toBe(413);
  });
});
