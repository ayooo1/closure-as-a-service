"use client";

import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ArrowLeft, ArrowRight, Sparkles } from "lucide-react";
import {
  DETAILS_MAX_LENGTH,
  durationLabel,
  DurationSchema,
  ENDING_LABELS,
  MEDIUM_LABELS,
  NAME_MAX_LENGTH,
  QuestionnaireSchema,
  REASON_LABELS,
  REASONS_BY_ENDING,
  TONE_LABELS,
  type Ending,
  type Questionnaire,
  type QuestionnaireInput,
} from "@caas/shared";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type ChoiceField = "ending" | "duration" | "reason" | "tone" | "medium";
type ChoiceStep = { field: ChoiceField; title: string; options: Record<string, string> };

const DURATION_TITLES: Record<Ending, string> = {
  relationship: "How long were you together?",
  situationship: "How long has it been going on?",
  friendship: "How long have you been friends?",
  "ghosting-apology": "How long did you know each other?",
  "reply-to-breakup": "How long were you together?",
};
const REASON_TITLES: Record<Ending, string> = {
  relationship: "What's the main reason?",
  situationship: "What's the main reason?",
  friendship: "What's the main reason?",
  "ghosting-apology": "Why did you go quiet?",
  "reply-to-breakup": "What do you want to say?",
};
const MEDIUM_TITLES: Partial<Record<Ending, string>> = { "reply-to-breakup": "How will you reply?" };

/** The questions adapt to what's being ended (until it's chosen, they read as a relationship). */
function choiceSteps(ending: Ending = "relationship"): ChoiceStep[] {
  return [
    { field: "ending", title: "What are you ending?", options: ENDING_LABELS },
    {
      field: "duration",
      title: DURATION_TITLES[ending],
      options: Object.fromEntries(DurationSchema.options.map((d) => [d, durationLabel(ending, d)])),
    },
    {
      field: "reason",
      title: REASON_TITLES[ending],
      options: Object.fromEntries(REASONS_BY_ENDING[ending].map((r) => [r, REASON_LABELS[r]])),
    },
    { field: "tone", title: "How do you want it to sound?", options: TONE_LABELS },
    { field: "medium", title: MEDIUM_TITLES[ending] ?? "How will you tell them?", options: MEDIUM_LABELS },
  ];
}
const STEP_COUNT = choiceSteps().length + 1; // + the optional details step

export function Wizard({
  initial,
  onSubmit,
}: {
  initial?: Partial<QuestionnaireInput>;
  onSubmit: (answers: Questionnaire) => void;
}) {
  const [step, setStep] = useState(0);
  const reduceMotion = useReducedMotion();
  const { register, handleSubmit, setValue, control } = useForm<QuestionnaireInput, unknown, Questionnaire>({
    resolver: zodResolver(QuestionnaireSchema),
    defaultValues: { name: "", details: "", ...initial },
  });
  const values = useWatch({ control });
  const details = values.details ?? "";

  const choice = choiceSteps(values.ending)[step];
  const selected = choice ? values[choice.field] : undefined;

  function choose(field: ChoiceField, value: string) {
    if (field === "ending" && values.reason && !REASONS_BY_ENDING[value as Ending].includes(values.reason)) {
      setValue("reason", undefined as never); // that reason doesn't exist for the new kind of ending
    }
    setValue(field, value as never, { shouldValidate: field !== "ending" });
    setStep((s) => s + 1);
  }

  return (
    <form onSubmit={(e) => void handleSubmit(onSubmit)(e)} className="w-full" noValidate>
      <div className="mb-6 flex items-center gap-3">
        <div
          className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-label="Progress"
          aria-valuemin={1}
          aria-valuemax={STEP_COUNT}
          aria-valuenow={step + 1}
        >
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-300"
            style={{ width: `${((step + 1) / STEP_COUNT) * 100}%` }}
          />
        </div>
        <span className="text-xs tabular-nums text-muted-foreground">
          {step + 1} / {STEP_COUNT}
        </span>
      </div>

      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={step}
          initial={reduceMotion ? false : { opacity: 0, x: 16 }}
          animate={{ opacity: 1, x: 0 }}
          exit={reduceMotion ? undefined : { opacity: 0, x: -16 }}
          transition={{ duration: 0.18 }}
        >
          {choice ? (
            <fieldset>
              <legend className="mb-4 text-xl font-semibold tracking-tight">{choice.title}</legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {Object.entries(choice.options).map(([value, label]) => (
                  <label
                    key={value}
                    className={cn(
                      "flex cursor-pointer items-center rounded-lg border bg-card px-4 py-3 text-sm transition-colors hover:border-primary/60 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring",
                      selected === value && "border-primary bg-primary/5 font-medium",
                    )}
                  >
                    <input
                      type="radio"
                      name={choice.field}
                      value={value}
                      checked={selected === value}
                      onChange={() => choose(choice.field, value)}
                      className="sr-only"
                    />
                    {label}
                  </label>
                ))}
              </div>
            </fieldset>
          ) : (
            <div className="space-y-4">
              <h2 className="text-xl font-semibold tracking-tight">Anything else?</h2>
              <div className="space-y-1.5">
                <label htmlFor="name" className="text-sm font-medium">
                  Their name <span className="font-normal text-muted-foreground">(optional)</span>
                </label>
                <input
                  id="name"
                  maxLength={NAME_MAX_LENGTH}
                  autoComplete="off"
                  className="h-10 w-full rounded-md border bg-card px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  {...register("name")}
                />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="details" className="text-sm font-medium">
                  Context that matters <span className="font-normal text-muted-foreground">(optional)</span>
                </label>
                <textarea
                  id="details"
                  rows={4}
                  maxLength={DETAILS_MAX_LENGTH}
                  placeholder="e.g. We met at uni and she's moving abroad for work."
                  aria-describedby="details-count"
                  className="w-full resize-none rounded-md border bg-card px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  {...register("details")}
                />
                <p id="details-count" className="text-right text-xs tabular-nums text-muted-foreground">
                  {details.length} / {DETAILS_MAX_LENGTH}
                </p>
              </div>
              <p className="text-xs text-muted-foreground">
                We don&apos;t save your name or details. They&apos;re only sent to Claude to write your messages.
              </p>
              <Button type="submit" className="w-full">
                <Sparkles /> Write my messages
              </Button>
            </div>
          )}
        </motion.div>
      </AnimatePresence>

      <div className="mt-6 flex justify-between">
        <Button type="button" variant="ghost" onClick={() => setStep((s) => s - 1)} disabled={step === 0}>
          <ArrowLeft /> Back
        </Button>
        {choice && selected && (
          <Button type="button" variant="ghost" onClick={() => setStep((s) => s + 1)}>
            Next <ArrowRight />
          </Button>
        )}
      </div>
    </form>
  );
}
