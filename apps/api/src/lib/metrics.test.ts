import { describe, expect, it } from "vitest";
import { createMetrics, type Metrics } from "./metrics.js";

/** The value of the series of `name` whose labels include `labels` (0 if none). */
async function sample(metrics: Metrics, name: string, labels: Record<string, string | number> = {}) {
  const metric = await metrics.registry.getSingleMetric(name)?.get();
  const match = metric?.values.find((v) => Object.entries(labels).every(([k, val]) => v.labels[k] === val));
  return match?.value ?? 0;
}

describe("createMetrics", () => {
  it("counts generations, tokens and latency per route", async () => {
    const metrics = createMetrics({ model: "claude-haiku-4-5", version: "1.2.0" });
    metrics.observeGeneration({
      route: "/api/generate",
      result: "ok",
      firstTokenMs: 1200,
      totalMs: 3500,
      usage: { inputTokens: 900, outputTokens: 250 },
    });
    metrics.observeGeneration({ route: "/api/generate", result: "failed", totalMs: 40 });

    const route = "/api/generate";
    expect(await sample(metrics, "caas_generations_total", { route, result: "ok" })).toBe(1);
    expect(await sample(metrics, "caas_generations_total", { route, result: "failed" })).toBe(1);
    expect(await sample(metrics, "caas_tokens_total", { route, type: "input" })).toBe(900);
    expect(await sample(metrics, "caas_tokens_total", { route, type: "output" })).toBe(250);

    // 1.2 s lands in the 1.5 s bucket; the failure, with no first token, isn't observed at all.
    const text = await metrics.registry.metrics();
    const line = (prefix: string) => text.split("\n").find((l) => l.startsWith(prefix))!;
    expect(line('caas_generation_first_token_seconds_bucket{le="1",')).toMatch(/ 0$/);
    expect(line('caas_generation_first_token_seconds_bucket{le="1.5",')).toMatch(/ 1$/);
    expect(line("caas_generation_first_token_seconds_count{")).toMatch(/ 1$/);
  });

  it("labels every series with the model and version", async () => {
    const metrics = createMetrics({ model: "claude-haiku-4-5", version: "1.2.0" });
    metrics.observeVote("up", "friendship");
    expect(await metrics.registry.metrics()).toMatch(
      /caas_feedback_votes_total\{(?=[^}]*vote="up")(?=[^}]*model="claude-haiku-4-5")(?=[^}]*version="1.2.0")[^}]*\} 1/,
    );
  });

  it("starts every known series at 0, so the first requests show up in rates", async () => {
    const metrics = createMetrics({ model: "m", version: "v" });
    const text = await metrics.registry.metrics();
    expect(text).toMatch(/caas_generations_total\{(?=[^}]*route="\/api\/practice")(?=[^}]*result="failed")[^}]*\} 0/);
    expect(text).toMatch(/caas_cache_requests_total\{(?=[^}]*route="\/api\/logistics")(?=[^}]*result="hit")[^}]*\} 0/);
    expect(text).toMatch(/caas_feedback_votes_total\{(?=[^}]*vote="down")(?=[^}]*ending="ghosting-apology")[^}]*\} 0/);
  });

  it("keeps each registry separate and includes process metrics", async () => {
    const a = createMetrics({ model: "m", version: "v" });
    const b = createMetrics({ model: "m", version: "v" });
    a.observeCache("/api/generate", "hit");

    expect(await sample(a, "caas_cache_requests_total", { result: "hit" })).toBe(1);
    expect(await sample(b, "caas_cache_requests_total", { result: "hit" })).toBe(0);
    expect(await b.registry.metrics()).toContain("nodejs_eventloop_lag_seconds");
  });
});
