"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { GenerationError, type StreamOptions } from "@/lib/generation";

export type StreamState<T> =
  | { status: "idle" | "streaming" | "done"; data: T }
  | { status: "error"; data: T; error: GenerationError };

/**
 * Runs one of the lib/generation streams and tracks its progress in React state.
 * A new `start` aborts any in-flight request; unmounting aborts too. `cancel` stops
 * the stream but keeps what arrived. `empty` must be a stable (module-level) value.
 */
export function useJsonStream<I, T>(
  stream: (input: I, opts: StreamOptions) => AsyncGenerator<T>,
  empty: T,
) {
  const [state, setState] = useState<StreamState<T>>({ status: "idle", data: empty });
  const controller = useRef<AbortController | null>(null);

  const cancel = useCallback(() => {
    controller.current?.abort();
    controller.current = null;
  }, []);

  const start = useCallback(
    async (input: I): Promise<T | undefined> => {
      cancel(); // a new request replaces any in-flight one
      const abort = new AbortController();
      controller.current = abort;
      setState({ status: "streaming", data: empty });

      let data = empty;
      try {
        for await (const partial of stream(input, { signal: abort.signal })) {
          data = partial;
          setState({ status: "streaming", data });
        }
        setState({ status: "done", data });
        return data;
      } catch (err) {
        if (abort.signal.aborted) {
          // Cancelled by the user (keep what arrived) or superseded by a newer request (ignore).
          if (controller.current === null) setState({ status: "done", data });
          return undefined;
        }
        const error =
          err instanceof GenerationError ? err : new GenerationError("failed", "Something went wrong. Please try again.");
        setState({ status: "error", data, error });
        return undefined;
      } finally {
        if (controller.current === abort) controller.current = null;
      }
    },
    [cancel, stream, empty],
  );

  const reset = useCallback(() => {
    cancel();
    setState({ status: "idle", data: empty });
  }, [cancel, empty]);

  useEffect(() => cancel, [cancel]);

  return { ...state, start, cancel, reset };
}
