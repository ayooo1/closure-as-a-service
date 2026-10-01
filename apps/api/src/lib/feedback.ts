import type { Redis } from "ioredis";
import type { Feedback } from "@caas/shared";

export interface FeedbackStore {
  record(feedback: Feedback, modelId: string): Promise<void>;
}

/**
 * One Redis hash per UTC day; each field is a combination of answer categories and the vote, and
 * its value a count. Small and bounded (combinations x days), with no TTL: Redis evicts only keys
 * that have one (volatile-lru), so votes outlive the cache under memory pressure.
 */
export const FEEDBACK_KEY_PREFIX = "caas:feedback:";

export function feedbackField(f: Feedback, modelId: string): string {
  return [modelId, f.ending, f.duration, f.reason, f.tone, f.medium, f.changed ? "changed" : "original", f.safetyConcern ? "safety" : "-", f.vote].join("|");
}

export function createFeedbackStore(redis: Pick<Redis, "hincrby">, now = () => new Date()): FeedbackStore {
  return {
    async record(feedback, modelId) {
      const day = now().toISOString().slice(0, 10);
      await redis.hincrby(`${FEEDBACK_KEY_PREFIX}${day}`, feedbackField(feedback, modelId), 1);
    },
  };
}
