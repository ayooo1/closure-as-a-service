"use client";

import { useState } from "react";
import type { Questionnaire, Tone } from "@caas/shared";
import { Results } from "@/components/results";
import { Wizard } from "@/components/wizard";
import { useGeneration } from "@/hooks/use-generation";

export function ClosureApp() {
  const generation = useGeneration();
  const [answers, setAnswers] = useState<Questionnaire | null>(null);

  function run(next: Questionnaire) {
    setAnswers(next);
    void generation.generate(next);
  }

  if (!answers || generation.status === "idle") {
    // Starting over keeps previous answers pre-selected, so a tweak is a couple of clicks.
    return <Wizard initial={answers ?? undefined} onSubmit={run} />;
  }

  return (
    <Results
      state={generation}
      medium={answers.medium}
      tone={answers.tone}
      onRetone={(tone: Tone) => run({ ...answers, tone })}
      onRetry={() => run(answers)}
      onCancel={generation.cancel}
      onStartOver={generation.reset}
    />
  );
}
