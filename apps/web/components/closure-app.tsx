"use client";

import { useState } from "react";
import type { Questionnaire, Tone } from "@caas/shared";
import { Results } from "@/components/results";
import { Wizard } from "@/components/wizard";
import { useJsonStream } from "@/hooks/use-json-stream";
import { streamGeneration, type PartialGeneration } from "@/lib/generation";

const EMPTY: PartialGeneration = { variations: [] };

export function ClosureApp() {
  const generation = useJsonStream(streamGeneration, EMPTY);
  const [answers, setAnswers] = useState<Questionnaire | null>(null);
  // Bumped per generation so result cards (and their edits, rewrites, replies) start fresh.
  const [run, setRun] = useState(0);

  function generate(next: Questionnaire) {
    setAnswers(next);
    setRun((r) => r + 1);
    void generation.start(next);
  }

  if (!answers || generation.status === "idle") {
    // Starting over keeps previous answers pre-selected, so a tweak is a couple of clicks.
    return <Wizard initial={answers ?? undefined} onSubmit={generate} />;
  }

  return (
    <Results
      key={run}
      state={generation}
      questionnaire={answers}
      onRetone={(tone: Tone) => generate({ ...answers, tone })}
      onRetry={() => generate(answers)}
      onCancel={generation.cancel}
      onStartOver={generation.reset}
    />
  );
}
