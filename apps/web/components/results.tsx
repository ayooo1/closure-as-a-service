"use client";

import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { Check, Copy, Mail, MessageSquare, RotateCcw, Square } from "lucide-react";
import { TONE_LABELS, VARIATION_COUNT, type Medium, type Tone } from "@caas/shared";
import { Button, buttonVariants } from "@/components/ui/button";
import type { GenerationState } from "@/hooks/use-generation";
import { mailtoHref, smsHref, type PartialVariation } from "@/lib/generation";

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(t);
  }, [copied]);

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => setCopied(true));
      }}
    >
      {copied ? <Check /> : <Copy />}
      {copied ? "Copied" : "Copy"}
    </Button>
  );
}

function SendLink({ medium, message }: { medium: Medium; message: string }) {
  if (medium === "in-person") return null;
  const isText = medium === "text";
  return (
    <a href={isText ? smsHref(message) : mailtoHref(message)} className={buttonVariants({ variant: "outline", size: "sm" })}>
      {isText ? <MessageSquare /> : <Mail />}
      {isText ? "Open in Messages" : "Open in Mail"}
    </a>
  );
}

function ResultCard({
  variation,
  index,
  writing,
  done,
  medium,
}: {
  variation: PartialVariation | undefined;
  index: number;
  writing: boolean;
  done: boolean;
  medium: Medium;
}) {
  const reduceMotion = useReducedMotion();
  const message = variation?.message ?? "";

  return (
    <motion.article
      initial={reduceMotion ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, delay: index * 0.05 }}
      className="rounded-lg border bg-card p-5 text-card-foreground shadow-sm"
      aria-busy={writing}
    >
      <p className="mb-2 text-xs font-medium uppercase tracking-wider text-primary">
        {variation?.angle || <span className="text-muted-foreground">Option {index + 1}</span>}
      </p>
      {message ? (
        <p className="whitespace-pre-wrap leading-relaxed">
          {message}
          {writing && <span className="ml-0.5 inline-block h-4 w-0.5 translate-y-0.5 animate-pulse bg-primary" aria-hidden />}
        </p>
      ) : (
        <div className="space-y-2" aria-hidden>
          <div className="h-3 w-11/12 animate-pulse rounded bg-muted" />
          <div className="h-3 w-4/5 animate-pulse rounded bg-muted" />
          <div className="h-3 w-2/3 animate-pulse rounded bg-muted" />
        </div>
      )}
      {done && message && (
        <div className="mt-4 flex flex-wrap gap-2">
          <CopyButton text={message} />
          <SendLink medium={medium} message={message} />
        </div>
      )}
    </motion.article>
  );
}

export function Results({
  state,
  medium,
  tone,
  onRetone,
  onRetry,
  onCancel,
  onStartOver,
}: {
  state: GenerationState;
  medium: Medium;
  tone: Tone;
  onRetone: (tone: Tone) => void;
  onRetry: () => void;
  onCancel: () => void;
  onStartOver: () => void;
}) {
  const streaming = state.status === "streaming";
  const done = state.status === "done";
  const shown = state.variations.slice(0, VARIATION_COUNT);
  // While streaming, keep placeholders for the variations that haven't started yet.
  const slots = streaming ? VARIATION_COUNT : shown.length;

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
          />
        ))}
      </div>

      {done && shown.length > 0 && (
        <div className="space-y-2 pt-2">
          <p className="text-sm text-muted-foreground">Not quite right? Try another tone:</p>
          <div className="flex flex-wrap gap-2">
            {(Object.entries(TONE_LABELS) as [Tone, string][])
              .filter(([value]) => value !== tone)
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
