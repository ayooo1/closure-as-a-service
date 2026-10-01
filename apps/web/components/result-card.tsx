"use client";

import { useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { Check, MessageCircleQuestion, Pencil, ThumbsDown, ThumbsUp, Undo2, Wand2 } from "lucide-react";
import {
  MESSAGE_MAX_LENGTH,
  REFINEMENT_LABELS,
  type Medium,
  type Questionnaire,
  type Refined,
  type Refinement,
} from "@caas/shared";
import { CopyButton, SendLink } from "@/components/share-actions";
import { Button } from "@/components/ui/button";
import { useJsonStream } from "@/hooks/use-json-stream";
import {
  sendFeedback,
  streamRefine,
  streamReplies,
  type PartialReply,
  type PartialVariation,
} from "@/lib/generation";
import { cn } from "@/lib/utils";

const NO_REFINEMENT: Partial<Refined> = {};
const NO_REPLIES: PartialReply[] = [];

const Caret = () => (
  <span className="ml-0.5 inline-block h-4 w-0.5 translate-y-0.5 animate-pulse bg-primary" aria-hidden />
);

function Vote({ onVote }: { onVote: (vote: "up" | "down") => void }) {
  const [vote, setVote] = useState<"up" | "down" | null>(null);
  const choose = (v: "up" | "down") => {
    setVote(v);
    onVote(v);
  };
  return (
    <div className="ml-auto flex items-center gap-1" role="group" aria-label="Rate this message">
      {vote && <span className="mr-1 text-xs text-muted-foreground">Thanks!</span>}
      {(["up", "down"] as const).map((v) => (
        <Button
          key={v}
          variant="ghost"
          size="icon"
          aria-label={v === "up" ? "Helpful" : "Not helpful"}
          aria-pressed={vote === v}
          disabled={vote !== null}
          onClick={() => choose(v)}
          className={cn("size-8", vote === v && "text-primary disabled:opacity-100")}
        >
          {v === "up" ? <ThumbsUp /> : <ThumbsDown />}
        </Button>
      ))}
    </div>
  );
}

function RepliesPanel({ replies, streaming }: { replies: PartialReply[]; streaming: boolean }) {
  return (
    <div className="mt-4 space-y-3 border-t pt-4">
      <h4 className="text-sm font-semibold">If they reply…</h4>
      {replies.length === 0 && <div className="h-3 w-2/3 animate-pulse rounded bg-muted" aria-hidden />}
      <dl className="space-y-3">
        {replies.map((r, i) => (
          <div key={i} className="space-y-1 text-sm">
            <dt className="text-muted-foreground">
              They say: <q>{r.theySay}</q>
            </dt>
            {r.youCanSay !== undefined && (
              <dd className="rounded-md bg-muted/60 px-3 py-2">
                {r.youCanSay}
                {streaming && i === replies.length - 1 && <Caret />}
              </dd>
            )}
          </div>
        ))}
      </dl>
    </div>
  );
}

export function ResultCard({
  variation,
  index,
  writing,
  done,
  medium,
  questionnaire,
  safetyConcern,
}: {
  variation: PartialVariation | undefined;
  index: number;
  /** This card is receiving the main generation's tokens right now. */
  writing: boolean;
  /** The main generation has finished, so follow-up actions are available. */
  done: boolean;
  medium: Medium;
  questionnaire: Questionnaire;
  safetyConcern: boolean;
}) {
  const reduceMotion = useReducedMotion();
  // The user's own version of this message (after an edit or a rewrite), and the one before it.
  const [override, setOverride] = useState<string | null>(null);
  const [previous, setPrevious] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [rewriteOpen, setRewriteOpen] = useState(false);
  const refine = useJsonStream(streamRefine, NO_REFINEMENT);
  const replies = useJsonStream(streamReplies, NO_REPLIES);

  const original = variation?.message ?? "";
  const refining = refine.status === "streaming";
  // While a rewrite streams, show it in place of the message.
  const message = refining ? (refine.data.message ?? "") : (override ?? original);
  const busy = refining || replies.status === "streaming";

  function replaceMessage(next: string) {
    setPrevious(message);
    setOverride(next);
    replies.reset(); // suggestions were for the old wording
  }

  async function rewrite(refinement: Refinement) {
    setRewriteOpen(false);
    const result = await refine.start({ questionnaire, message, refinement });
    if (result?.message) replaceMessage(result.message.trim());
  }

  return (
    <motion.article
      initial={reduceMotion ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, delay: index * 0.05 }}
      className="rounded-lg border bg-card p-5 text-card-foreground shadow-sm"
      aria-busy={writing || busy}
    >
      <p className="mb-2 text-xs font-medium uppercase tracking-wider text-primary">
        {variation?.angle || <span className="text-muted-foreground">Option {index + 1}</span>}
      </p>

      {editing ? (
        <textarea
          aria-label="Edit message"
          value={message}
          maxLength={MESSAGE_MAX_LENGTH}
          rows={6}
          onChange={(e) => setOverride(e.target.value)}
          className="w-full resize-y rounded-md border bg-background px-3 py-2 leading-relaxed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      ) : message ? (
        <p className="whitespace-pre-wrap leading-relaxed">
          {message}
          {(writing || refining) && <Caret />}
        </p>
      ) : (
        <div className="space-y-2" aria-hidden>
          <div className="h-3 w-11/12 animate-pulse rounded bg-muted" />
          <div className="h-3 w-4/5 animate-pulse rounded bg-muted" />
          <div className="h-3 w-2/3 animate-pulse rounded bg-muted" />
        </div>
      )}

      {refine.status === "error" && (
        <p role="alert" className="mt-2 text-sm text-primary">
          {refine.error.message}
        </p>
      )}

      {done && message && (
        <>
          <div className="mt-4 flex flex-wrap gap-2">
            {editing ? (
              <Button size="sm" onClick={() => setEditing(false)}>
                <Check /> Done
              </Button>
            ) : (
              <>
                <CopyButton text={message} />
                <SendLink medium={medium} message={message} />
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => {
                    setPrevious(message);
                    setOverride(message);
                    setEditing(true);
                  }}
                >
                  <Pencil /> Edit
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  aria-expanded={rewriteOpen}
                  onClick={() => setRewriteOpen((o) => !o)}
                >
                  <Wand2 /> Rewrite
                </Button>
                {previous !== null && previous !== message && !busy && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setOverride(previous);
                      setPrevious(null);
                      replies.reset();
                    }}
                  >
                    <Undo2 /> Undo
                  </Button>
                )}
                <Vote
                  onVote={(vote) => {
                    const { ending, duration, reason, tone, medium: chosenMedium } = questionnaire;
                    void sendFeedback({
                      vote,
                      ending,
                      duration,
                      reason,
                      tone,
                      medium: chosenMedium,
                      changed: message !== original,
                      safetyConcern,
                    });
                  }}
                />
              </>
            )}
          </div>

          {rewriteOpen && !editing && (
            <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Rewrite this message">
              {(Object.entries(REFINEMENT_LABELS) as [Refinement, string][]).map(([value, label]) => (
                <Button key={value} variant="outline" size="sm" className="rounded-full" onClick={() => void rewrite(value)}>
                  {label}
                </Button>
              ))}
            </div>
          )}

          {!editing &&
            (safetyConcern ? null : replies.status === "idle" ? (
              <Button
                variant="ghost"
                size="sm"
                className="mt-2 -ml-2"
                disabled={busy}
                onClick={() => void replies.start({ questionnaire, message })}
              >
                <MessageCircleQuestion /> What if they reply?
              </Button>
            ) : replies.status === "error" ? (
              <p role="alert" className="mt-3 text-sm text-primary">
                {replies.error.message}
              </p>
            ) : (
              <RepliesPanel replies={replies.data} streaming={replies.status === "streaming"} />
            ))}
        </>
      )}
    </motion.article>
  );
}
