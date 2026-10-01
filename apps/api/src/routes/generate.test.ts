import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GenerationCache } from "../lib/cache.js";
import { failingModel, SAMPLE_GENERATION, streamingModel } from "../testing/mock-model.js";
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
    model: deps.model ?? streamingModel(SAMPLE_JSON),
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
    const model = streamingModel(SAMPLE_JSON);
    app = await build({ cache, model });

    const res = await post(app, VALID);
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("text/plain; charset=utf-8");
    expect(res.headers["x-cache"]).toBe("miss");
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(JSON.parse(res.body)).toEqual(SAMPLE_GENERATION);

    await vi.waitFor(() => expect(cache.set).toHaveBeenCalledOnce());
    expect(JSON.parse([...cache.store.values()][0]!)).toEqual(SAMPLE_GENERATION);
  });

  it("sends the system prompt and questionnaire to the model", async () => {
    const model = streamingModel(SAMPLE_JSON);
    app = await build({ model });
    await post(app, { ...VALID, name: "Sam", details: "We met at uni" });

    const call = model.doStreamCalls[0]!;
    const system = call.prompt.find((m) => m.role === "system");
    const user = JSON.stringify(call.prompt.find((m) => m.role === "user"));
    expect(system?.content).toContain("Never invent specifics");
    expect(user).toContain("Address them as Sam");
    expect(user).toContain("We met at uni");
    expect(call.responseFormat).toMatchObject({ type: "json", name: "breakup_messages" });
  });

  it("serves identical requests from the cache without calling the model", async () => {
    const cache = memoryCache();
    const model = streamingModel(SAMPLE_JSON);
    app = await build({ cache, model });

    await post(app, VALID);
    await vi.waitFor(() => expect(cache.set).toHaveBeenCalledOnce());
    // Whitespace and empty optional fields normalise to the same key.
    const res = await post(app, { ...VALID, name: "  ", details: "" });

    expect(res.statusCode).toBe(200);
    expect(res.headers["x-cache"]).toBe("hit");
    expect(JSON.parse(res.body)).toEqual(SAMPLE_GENERATION);
    expect(model.doStreamCalls).toHaveLength(1);
  });

  it("does not cache output that fails schema validation", async () => {
    const cache = memoryCache();
    app = await build({ cache, model: streamingModel('{"variations":[{"angle":1}]}') });

    const res = await post(app, VALID);
    expect(res.statusCode).toBe(200);
    expect(cache.set).not.toHaveBeenCalled();
  });

  it("returns 502 when the provider fails before any output", async () => {
    const cache = memoryCache();
    app = await build({ cache, model: failingModel() });

    const res = await post(app, VALID);
    expect(res.statusCode).toBe(502);
    expect(res.json()).toEqual({ error: "generation_failed" });
    expect(cache.set).not.toHaveBeenCalled();
  });

  it.each([
    ["an empty body", {}, "duration"],
    ["an unknown tone", { ...VALID, tone: "savage" }, "tone"],
    ["overly long details", { ...VALID, details: "x".repeat(501) }, "details"],
    ["a non-string name", { ...VALID, name: 42 }, "name"],
  ])("rejects %s with 400 naming the field", async (_label, payload, field) => {
    const model = streamingModel(SAMPLE_JSON);
    app = await build({ model });

    const res = await post(app, payload);
    expect(res.statusCode).toBe(400);
    const body = res.json<{ error: string; issues: { path: string; message: string }[] }>();
    expect(body.error).toBe("invalid_request");
    expect(body.issues.map((i) => i.path)).toContain(field);
    expect(model.doStreamCalls).toHaveLength(0);
  });

  it("rejects bodies over 4 KB with 413", async () => {
    app = await build();
    const res = await post(app, { ...VALID, padding: "x".repeat(5000) });
    expect(res.statusCode).toBe(413);
  });
});
