import type { Feedback } from "@caas/shared";
import { describe, expect, it, vi } from "vitest";
import { createFeedbackStore, feedbackField } from "./feedback.js";

const VOTE: Feedback = {
  vote: "down",
  ending: "friendship",
  duration: "6-12-months",
  reason: "one-sided",
  tone: "gentle",
  medium: "email",
  changed: true,
  safetyConcern: false,
};

describe("feedback store", () => {
  it("counts each vote in a per-day hash, keyed by model and answer categories", async () => {
    const redis = { hincrby: vi.fn().mockResolvedValue(1) };
    const store = createFeedbackStore(redis, () => new Date("2026-10-01T23:59:00Z"));

    await store.record(VOTE, "claude-haiku-4-5:default");
    expect(redis.hincrby).toHaveBeenCalledWith(
      "caas:feedback:2026-10-01",
      "claude-haiku-4-5:default|friendship|6-12-months|one-sided|gentle|email|changed|-|down",
      1,
    );
  });

  it("marks safety-flagged and unchanged messages in the field", () => {
    expect(feedbackField({ ...VOTE, changed: false, safetyConcern: true, vote: "up" }, "m")).toBe(
      "m|friendship|6-12-months|one-sided|gentle|email|original|safety|up",
    );
  });

  it("propagates Redis errors so the route can report them", async () => {
    const store = createFeedbackStore({ hincrby: vi.fn().mockRejectedValue(new Error("down")) });
    await expect(store.record(VOTE, "m")).rejects.toThrow("down");
  });
});
