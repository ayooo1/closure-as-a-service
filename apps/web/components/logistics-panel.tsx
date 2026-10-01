"use client";

import { useState } from "react";
import { Package } from "lucide-react";
import {
  LOGISTICS_NOTES_MAX_LENGTH,
  LOGISTICS_TOPIC_LABELS,
  type Logistics,
  type LogisticsTopic,
  type Medium,
  type Questionnaire,
} from "@caas/shared";
import { CopyButton, SendLink } from "@/components/share-actions";
import { Button } from "@/components/ui/button";
import { useJsonStream } from "@/hooks/use-json-stream";
import { streamLogistics } from "@/lib/generation";

const NO_MESSAGE: Partial<Logistics> = {};

/** A follow-up about returning belongings, shared money, a shared home, pets or accounts. */
export function LogisticsPanel({
  questionnaire,
  safetyConcern,
  onShare,
}: {
  questionnaire: Questionnaire;
  safetyConcern: boolean;
  onShare: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [topics, setTopics] = useState<LogisticsTopic[]>([]);
  const [notes, setNotes] = useState("");
  const logistics = useJsonStream(streamLogistics, NO_MESSAGE);
  const streaming = logistics.status === "streaming";
  const message = logistics.data.message ?? "";
  // Logistics happen in writing, even after an in-person conversation.
  const medium: Medium = questionnaire.medium === "in-person" ? "text" : questionnaire.medium;

  if (!open) {
    return (
      <Button variant="outline" className="w-full" onClick={() => setOpen(true)}>
        <Package /> Need to sort out belongings or shared things?
      </Button>
    );
  }

  const toggle = (topic: LogisticsTopic) =>
    setTopics((t) => (t.includes(topic) ? t.filter((x) => x !== topic) : [...t, topic]));

  return (
    <section aria-labelledby="logistics-title" className="space-y-4 rounded-lg border bg-card p-5 shadow-sm">
      <h3 id="logistics-title" className="flex items-center gap-2 font-semibold">
        <Package className="size-4" aria-hidden /> Sort out shared things
      </h3>
      <fieldset className="space-y-2">
        <legend className="mb-2 text-sm text-muted-foreground">What needs sorting out?</legend>
        {(Object.entries(LOGISTICS_TOPIC_LABELS) as [LogisticsTopic, string][]).map(([value, label]) => (
          <label key={value} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={topics.includes(value)}
              onChange={() => toggle(value)}
              className="size-4 accent-[var(--primary)]"
            />
            {label}
          </label>
        ))}
      </fieldset>
      <div className="space-y-1.5">
        <label htmlFor="logistics-notes" className="text-sm font-medium">
          Anything specific? <span className="font-normal text-muted-foreground">(optional)</span>
        </label>
        <textarea
          id="logistics-notes"
          rows={2}
          maxLength={LOGISTICS_NOTES_MAX_LENGTH}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="e.g. My bike is still at your place."
          className="w-full resize-none rounded-md border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>
      {safetyConcern && (
        <p className="text-sm text-muted-foreground">
          This will suggest handovers that don&apos;t need you to meet, like a friend collecting or a courier.
        </p>
      )}
      <Button
        disabled={topics.length === 0 || streaming}
        onClick={() => void logistics.start({ questionnaire, topics, notes, safetyConcern })}
      >
        {message ? "Write it again" : "Write the message"}
      </Button>

      {logistics.status === "error" && (
        <p role="alert" className="text-sm text-primary">
          {logistics.error.message}
        </p>
      )}
      {message && (
        <div className="space-y-3 border-t pt-4" aria-busy={streaming}>
          <p className="whitespace-pre-wrap leading-relaxed">{message}</p>
          {logistics.status === "done" && (
            <div className="flex flex-wrap gap-2">
              <CopyButton text={message} onCopy={onShare} />
              <SendLink medium={medium} message={message} onSend={onShare} />
            </div>
          )}
        </div>
      )}
    </section>
  );
}
