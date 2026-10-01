"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { QuestionnaireInput } from "@caas/shared";
import { GenerationError, streamGeneration, type PartialVariation } from "@/lib/generation";

export type GenerationState =
  | { status: "idle"; variations: [] }
  | { status: "streaming" | "done"; variations: PartialVariation[] }
  | { status: "error"; variations: PartialVariation[]; error: GenerationError };

const IDLE: GenerationState = { status: "idle", variations: [] };

export function useGeneration() {
  const [state, setState] = useState<GenerationState>(IDLE);
  const controller = useRef<AbortController | null>(null);

  const cancel = useCallback(() => {
    controller.current?.abort();
    controller.current = null;
  }, []);

  const generate = useCallback(
    async (input: QuestionnaireInput) => {
      cancel(); // a new request replaces any in-flight one
      const abort = new AbortController();
      controller.current = abort;
      setState({ status: "streaming", variations: [] });

      let variations: PartialVariation[] = [];
      try {
        for await (const partial of streamGeneration(input, { signal: abort.signal })) {
          variations = partial;
          setState({ status: "streaming", variations });
        }
        setState({ status: "done", variations });
      } catch (err) {
        if (abort.signal.aborted) {
          // Cancelled by the user (keep what arrived) or superseded by a newer request (ignore).
          if (controller.current === null) setState({ status: "done", variations });
          return;
        }
        const error =
          err instanceof GenerationError ? err : new GenerationError("failed", "Something went wrong. Please try again.");
        setState({ status: "error", variations, error });
      } finally {
        if (controller.current === abort) controller.current = null;
      }
    },
    [cancel],
  );

  const reset = useCallback(() => {
    cancel();
    setState(IDLE);
  }, [cancel]);

  useEffect(() => cancel, [cancel]);

  return { ...state, generate, cancel, reset };
}
