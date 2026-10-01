"use client";

import { RotateCcw, Square } from "lucide-react";
import { LOGISTICS_ENDINGS, TONE_LABELS, VARIATION_COUNT, type Questionnaire, type Tone } from "@caas/shared";
import { useState } from "react";
import { AfterSending } from "@/components/after-sending";
import { LogisticsPanel } from "@/components/logistics-panel";
import { ResultCard } from "@/components/result-card";
import { SafetyNotice } from "@/components/safety-notice";
import { Button } from "@/components/ui/button";
import type { StreamState } from "@/hooks/use-json-stream";
import type { PartialGeneration } from "@/lib/generation";

export function Results({
  state,
  questionnaire,
  onRetone,
  onRetry,
  onCancel,
  onStartOver,
}: {
  state: StreamState<PartialGeneration>;
  questionnaire: Questionnaire;
  onRetone: (tone: Tone) => void;
  onRetry: () => void;
  onCancel: () => void;
  onStartOver: () => void;
}) {
  // "shared" once anything is copied or opened to send; "dismissed" stays closed for this result.
  const [aftercare, setAftercare] = useState<"hidden" | "shown" | "dismissed">("hidden");
  const onShare = () => setAftercare((a) => (a === "hidden" ? "shown" : a));
  const streaming = state.status === "streaming";
  const done = state.status === "done";
  const shown = state.data.variations.slice(0, VARIATION_COUNT);
  const safetyConcern = state.data.safetyConcern === true;
  // While streaming, keep placeholders for the variations that haven't started yet.
  const slots = streaming ? VARIATION_COUNT : shown.length;
  // With a safety concern, in-person talking points become messages to send from a safe place.
  const medium = safetyConcern && questionnaire.medium === "in-person" ? "text" : questionnaire.medium;

  return (
    <section className="w-full space-y-4" aria-live="polite">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold tracking-tight">
          {streaming ? "Writing your messages…" : "Your messages"}
        </h2>
        {streaming ? (
          <Button variant="ghost" size="sm" onClick={onCancel}>
            <Square /> Stop
          </Button>
        ) : (
          <Button variant="ghost" size="sm" onClick={onStartOver}>
            <RotateCcw /> Start over
          </Button>
        )}
      </div>

      {safetyConcern && <SafetyNotice />}

      {state.status === "error" && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-primary/40 bg-primary/5 p-4 text-sm">
          <span>
            {state.error.message}
            {state.error.retryAfter ? ` You can try again in ${state.error.retryAfter}s.` : ""}
          </span>
          {state.error.kind !== "rate_limited" && (
            <Button size="sm" onClick={onRetry}>
              Try again
            </Button>
          )}
        </div>
      )}

      <div className="space-y-3">
        {Array.from({ length: slots }, (_, i) => (
          <ResultCard
            key={i}
            index={i}
            variation={shown[i]}
            writing={streaming && i === shown.length - 1}
            done={done}
            medium={medium}
            questionnaire={questionnaire}
            safetyConcern={safetyConcern}
            onShare={onShare}
          />
        ))}
      </div>

      {aftercare === "shown" && (
        <AfterSending
          ending={questionnaire.ending}
          safetyConcern={safetyConcern}
          onDismiss={() => setAftercare("dismissed")}
        />
      )}

      {done && shown.length > 0 && LOGISTICS_ENDINGS.includes(questionnaire.ending) && (
        <LogisticsPanel questionnaire={questionnaire} safetyConcern={safetyConcern} onShare={onShare} />
      )}

      {done && shown.length > 0 && (
        <div className="space-y-2 pt-2">
          <p className="text-sm text-muted-foreground">Not quite right? Try another tone:</p>
          <div className="flex flex-wrap gap-2">
            {(Object.entries(TONE_LABELS) as [Tone, string][])
              .filter(([value]) => value !== questionnaire.tone)
              .map(([value, label]) => (
                <Button key={value} variant="outline" size="sm" onClick={() => onRetone(value)} className="rounded-full">
                  {label}
                </Button>
              ))}
          </div>
        </div>
      )}
    </section>
  );
}
