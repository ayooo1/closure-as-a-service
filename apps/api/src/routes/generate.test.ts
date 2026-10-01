import { request } from "node:http";
import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GenerationCache } from "../lib/cache.js";
import type { TextGenerator } from "../lib/generator.js";
import { GenerationSchema, LogisticsSchema, RefinedSchema, RepliesSchema, type Feedback } from "@caas/shared";
import { LOGISTICS_SYSTEM_PROMPT, REFINE_SYSTEM_PROMPT, REPLIES_SYSTEM_PROMPT, SYSTEM_PROMPT } from "../lib/prompt.js";
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

function memoryFeedback() {
  const recorded: { feedback: Feedback; modelId: string }[] = [];
  return { recorded, record: vi.fn(async (feedback: Feedback, modelId: string) => void recorded.push({ feedback, modelId })) };
}

async function build(deps: Partial<GenerateDeps> = {}) {
  const app = Fastify();
  await app.register(generateRoutes, {
    prefix: "/api",
    generate: deps.generate ?? streamingGenerator(SAMPLE_JSON),
    modelId: deps.modelId ?? "claude-haiku-4-5:default",
    cache: deps.cache ?? memoryCache(),
    feedback: deps.feedback ?? memoryFeedback(),
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
    expect(call.schema).toBe(GenerationSchema);
    expect(call.prompt).toContain("Address them as Sam");
    expect(call.prompt).toContain("We met at uni");
    expect(call.signal).toBeInstanceOf(AbortSignal);
  });

  it("aborts the model call when the client disconnects mid-stream", async () => {
    const cache = memoryCache();
    const generate = streamingGenerator(SAMPLE_JSON, { parts: 20, delayMs: 50 });
    app = await build({ cache, generate });
    const url = new URL(await app.listen({ port: 0, host: "127.0.0.1" }));

    // Drop the TCP connection after the first chunk, like a browser tab closing. (fetch's
    // AbortController isn't used: on Node 22 it leaves the socket open, hanging app.close().)
    await new Promise<void>((resolve, reject) => {
      const req = request(
        { host: url.hostname, port: url.port, path: "/api/generate", method: "POST", headers: { "content-type": "application/json" } },
        (res) => res.once("data", () => (req.destroy(), resolve())),
      );
      req.on("error", (err) => (req.destroyed ? undefined : reject(err)));
      req.end(JSON.stringify(VALID));
    });

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

  it("never caches answers that include a name or personal details", async () => {
    const cache = memoryCache();
    const generate = streamingGenerator(SAMPLE_JSON);
    app = await build({ cache, generate });

    for (const personal of [{ name: "Sam" }, { details: "We met at uni" }]) {
      const first = await post(app, { ...VALID, ...personal });
      const second = await post(app, { ...VALID, ...personal });
      expect(first.statusCode).toBe(200);
      expect([first.headers["x-cache"], second.headers["x-cache"]]).toEqual(["skip", "skip"]);
    }
    expect(generate.calls).toHaveLength(4);
    expect(cache.get).not.toHaveBeenCalled();
    expect(cache.set).not.toHaveBeenCalled();
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

const REFINED_JSON = JSON.stringify({ message: "Sam, I'm ending our relationship." });
const REPLIES_JSON = JSON.stringify({
  replies: [
    { theySay: "Can we talk about this?", youCanSay: "I've thought about it carefully, and my decision is final." },
    { theySay: "Why?", youCanSay: "We want different things. I'm sorry." },
  ],
});
const QUESTIONNAIRE = { ...VALID, name: "Sam" };
const MESSAGE = "Sam, I've realised we want different things, so I'm ending our relationship.";

describe("follow-ups", () => {
  let app: Awaited<ReturnType<typeof build>> | undefined;
  afterEach(() => app?.close());

  const send = (url: string, payload: unknown) =>
    app!.inject({ method: "POST", url, payload: payload as object });

  it("POST /api/refine streams a rewritten message, never cached", async () => {
    const cache = memoryCache();
    const generate = streamingGenerator(REFINED_JSON);
    app = await build({ cache, generate });

    const res = await send("/api/refine", { questionnaire: QUESTIONNAIRE, message: MESSAGE, refinement: "without-reason" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(JSON.parse(res.body)).toEqual(JSON.parse(REFINED_JSON));

    const call = generate.calls[0]!;
    expect(call.system).toBe(REFINE_SYSTEM_PROMPT);
    expect(call.schema).toBe(RefinedSchema);
    expect(call.prompt).toContain(MESSAGE);
    expect(call.prompt).toContain("Remove the reason");
    expect(cache.get).not.toHaveBeenCalled();
    expect(cache.set).not.toHaveBeenCalled();
  });

  it("POST /api/replies streams likely replies with suggested responses, never cached", async () => {
    const cache = memoryCache();
    const generate = streamingGenerator(REPLIES_JSON);
    app = await build({ cache, generate });

    const res = await send("/api/replies", { questionnaire: QUESTIONNAIRE, message: MESSAGE });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual(JSON.parse(REPLIES_JSON));

    const call = generate.calls[0]!;
    expect(call.system).toBe(REPLIES_SYSTEM_PROMPT);
    expect(call.schema).toBe(RepliesSchema);
    expect(call.prompt).toContain(MESSAGE);
    expect(cache.set).not.toHaveBeenCalled();
  });

  it.each([
    ["/api/refine", { questionnaire: QUESTIONNAIRE, message: MESSAGE, refinement: "meaner" }, "refinement"],
    ["/api/refine", { questionnaire: QUESTIONNAIRE, message: "   ", refinement: "shorter" }, "message"],
    ["/api/replies", { questionnaire: QUESTIONNAIRE, message: "x".repeat(2001) }, "message"],
    ["/api/replies", { questionnaire: { ...QUESTIONNAIRE, tone: "savage" }, message: MESSAGE }, "questionnaire.tone"],
    ["/api/replies", { message: MESSAGE }, "questionnaire"],
  ])("%s rejects invalid input with 400 naming %s", async (url, payload, field) => {
    const generate = streamingGenerator(REFINED_JSON);
    app = await build({ generate });

    const res = await send(url, payload);
    expect(res.statusCode).toBe(400);
    expect(res.json<{ issues: { path: string }[] }>().issues.map((i) => i.path)).toContain(field);
    expect(generate.calls).toHaveLength(0);
  });

  it.each(["/api/refine", "/api/replies"])("%s returns 502 when the API call fails", async (url) => {
    app = await build({ generate: failingGenerator() });
    const res = await send(url, { questionnaire: QUESTIONNAIRE, message: MESSAGE, refinement: "shorter" });
    expect(res.statusCode).toBe(502);
  });
});

describe("POST /api/feedback", () => {
  let app: Awaited<ReturnType<typeof build>> | undefined;
  afterEach(() => app?.close());

  const VOTE = {
    vote: "up",
    ending: "relationship",
    duration: "1-3-years",
    reason: "different-goals",
    tone: "warm",
    medium: "text",
    changed: false,
    safetyConcern: false,
  };

  it("records the vote with the model, and replies 204", async () => {
    const feedback = memoryFeedback();
    app = await build({ feedback, modelId: "claude-opus-5-5:default" });

    const res = await app.inject({ method: "POST", url: "/api/feedback", payload: VOTE });
    expect(res.statusCode).toBe(204);
    expect(feedback.recorded).toEqual([{ feedback: VOTE, modelId: "claude-opus-5-5:default" }]);
  });

  it("never records text, even if a client sends some", async () => {
    const feedback = memoryFeedback();
    app = await build({ feedback });

    await app.inject({
      method: "POST",
      url: "/api/feedback",
      payload: { ...VOTE, name: "Sam", details: "private", message: "Sam, it's over." },
    });
    expect(JSON.stringify(feedback.recorded)).not.toMatch(/Sam|private|over/);
  });

  it.each([
    ["an unknown vote", { ...VOTE, vote: "meh" }, "vote"],
    ["a missing category", { ...VOTE, tone: undefined }, "tone"],
  ])("rejects %s with 400", async (_label, payload, field) => {
    const feedback = memoryFeedback();
    app = await build({ feedback });

    const res = await app.inject({ method: "POST", url: "/api/feedback", payload });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ issues: { path: string }[] }>().issues.map((i) => i.path)).toContain(field);
    expect(feedback.record).not.toHaveBeenCalled();
  });

  it("replies 503 when the store is unavailable", async () => {
    app = await build({ feedback: { record: vi.fn().mockRejectedValue(new Error("Connection is closed.")) } });
    const res = await app.inject({ method: "POST", url: "/api/feedback", payload: VOTE });
    expect(res.statusCode).toBe(503);
  });
});

describe("POST /api/logistics", () => {
  let app: Awaited<ReturnType<typeof build>> | undefined;
  afterEach(() => app?.close());
  const LOGISTICS_JSON = JSON.stringify({ message: "Could you let me know when suits you to pick up your things?" });
  const QUESTIONNAIRE = { ...VALID, name: "Sam" };

  it("streams a practical follow-up for the chosen topics, never cached", async () => {
    const cache = memoryCache();
    const generate = streamingGenerator(LOGISTICS_JSON);
    app = await build({ cache, generate });

    const res = await app.inject({
      method: "POST",
      url: "/api/logistics",
      payload: { questionnaire: QUESTIONNAIRE, topics: ["belongings", "accounts"], notes: "Netflix is on my card" },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual(JSON.parse(LOGISTICS_JSON));

    const call = generate.calls[0]!;
    expect(call.system).toBe(LOGISTICS_SYSTEM_PROMPT);
    expect(call.schema).toBe(LogisticsSchema);
    expect(call.prompt).toContain("Returning belongings; Shared accounts and subscriptions");
    expect(call.prompt).toContain("Netflix is on my card");
    expect(call.prompt).not.toContain("Avoid meeting");
    expect(cache.get).not.toHaveBeenCalled();
  });

  it("passes the safety flag through so handovers avoid meeting", async () => {
    const generate = streamingGenerator(LOGISTICS_JSON);
    app = await build({ generate });
    await app.inject({
      method: "POST",
      url: "/api/logistics",
      payload: { questionnaire: QUESTIONNAIRE, topics: ["belongings"], safetyConcern: true },
    });
    expect(generate.calls[0]!.prompt).toContain("Avoid meeting");
  });

  it.each([
    ["no topics", { topics: [] }, "topics"],
    ["an unknown topic", { topics: ["car"] }, "topics.0"],
    ["a repeated topic", { topics: ["pets", "pets"] }, "topics"],
    ["overly long notes", { topics: ["pets"], notes: "x".repeat(301) }, "notes"],
  ])("rejects %s with 400", async (_label, extra, field) => {
    const generate = streamingGenerator(LOGISTICS_JSON);
    app = await build({ generate });

    const res = await app.inject({ method: "POST", url: "/api/logistics", payload: { questionnaire: QUESTIONNAIRE, ...extra } });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ issues: { path: string }[] }>().issues.map((i) => i.path)).toContain(field);
    expect(generate.calls).toHaveLength(0);
  });
});
