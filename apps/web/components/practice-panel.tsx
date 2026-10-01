"use client";

import { useEffect, useRef, useState } from "react";
import { Lightbulb, RotateCcw, Send } from "lucide-react";
import {
  PRACTICE_MAX_REPLIES,
  PRACTICE_TEXT_MAX_LENGTH,
  type PracticeReply,
  type PracticeTurn,
  type Questionnaire,
} from "@caas/shared";
import { Button } from "@/components/ui/button";
import { useJsonStream } from "@/hooks/use-json-stream";
import { streamPractice } from "@/lib/generation";
import { cn } from "@/lib/utils";

const NO_REPLY: Partial<PracticeReply> = {};

function Bubble({ from, children }: { from: "them" | "you"; children: React.ReactNode }) {
  return (
    <div className={cn("flex", from === "you" ? "justify-end" : "justify-start")}>
      <p
        className={cn(
          "max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-sm leading-relaxed",
          from === "you" ? "rounded-br-sm bg-primary text-primary-foreground" : "rounded-bl-sm bg-muted",
        )}
      >
        <span className="sr-only">{from === "you" ? "You: " : "Them: "}</span>
        {children}
      </p>
    </div>
  );
}

/**
 * A rehearsal: Claude plays the other person reacting to `message`, with a coaching tip after
 * each of the user's replies. Nothing is stored; closing the panel ends it.
 */
export function PracticePanel({
  questionnaire,
  message,
  onClose,
}: {
  questionnaire: Questionnaire;
  message: string;
  onClose: () => void;
}) {
  const [turns, setTurns] = useState<PracticeTurn[]>([]);
  // Coaching tips, keyed by the index of the user's turn they're about.
  const [tips, setTips] = useState<Record<number, string>>({});
  const [over, setOver] = useState(false);
  const [draft, setDraft] = useState("");
  const reply = useJsonStream(streamPractice, NO_REPLY);
  const streaming = reply.status === "streaming";
  const replies = turns.filter((t) => t.role === "you").length;
  const bottom = useRef<HTMLDivElement>(null);

  async function ask(sent: PracticeTurn[]) {
    const result = await reply.start({ questionnaire, message, turns: sent });
    if (!result?.theySay) return;
    setTurns([...sent, { role: "them", text: result.theySay.trim() }]);
    if (result.coachTip?.trim() && sent.length > 0) setTips((t) => ({ ...t, [sent.length - 1]: result.coachTip!.trim() }));
    if (result.conversationOver || sent.filter((t) => t.role === "you").length >= PRACTICE_MAX_REPLIES) setOver(true);
  }

  // Their first reaction arrives as soon as the panel opens.
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void ask([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on open
  }, []);

  // Block body on purpose: newer browsers return a Promise from scrollIntoView, and an effect
  // must return nothing or a cleanup function, or React crashes on unmount/re-run.
  useEffect(() => {
    void bottom.current?.scrollIntoView?.({ block: "nearest" });
  }, [turns, reply.data.theySay]);

  function send() {
    const text = draft.trim();
    if (!text || streaming || over) return;
    setDraft("");
    void ask([...turns, { role: "you", text }]);
  }

  function restart() {
    setTurns([]);
    setTips({});
    setOver(false);
    void ask([]);
  }

  // The user's last turn, waiting for (or receiving) their reply.
  const pending = turns.at(-1)?.role === "you" || turns.length === 0;

  return (
    <section aria-label="Practice conversation" className="mt-4 space-y-3 border-t pt-4">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold">Practice conversation</h4>
        <span className="text-xs tabular-nums text-muted-foreground">
          {replies} / {PRACTICE_MAX_REPLIES} replies
        </span>
      </div>
      <p className="text-xs text-muted-foreground">
        Claude plays them so you can rehearse. It&apos;s only practice and nothing is saved.
      </p>

      <div className="space-y-2" aria-live="polite">
        <Bubble from="you">{message}</Bubble>
        {turns.map((t, i) => (
          <div key={i} className="space-y-1">
            <Bubble from={t.role}>{t.text}</Bubble>
            {tips[i] && (
              <p className="flex items-start justify-end gap-1.5 text-xs text-muted-foreground">
                <Lightbulb className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                <span>
                  <span className="sr-only">Coaching tip: </span>
                  {tips[i]}
                </span>
              </p>
            )}
          </div>
        ))}
        {pending && streaming && (
          <Bubble from="them">{reply.data.theySay || <span className="animate-pulse">…</span>}</Bubble>
        )}
        <div ref={bottom} />
      </div>

      {reply.status === "error" && (
        <div role="alert" className="flex items-center justify-between gap-2 text-sm text-primary">
          <span>{reply.error.message}</span>
          {reply.error.kind !== "rate_limited" && (
            <Button size="sm" variant="outline" onClick={() => void ask(turns)}>
              Try again
            </Button>
          )}
        </div>
      )}

      {over ? (
        <div className="flex flex-wrap items-center gap-2">
          <p className="mr-auto text-sm font-medium">Practice finished. You did the hard part.</p>
          <Button size="sm" variant="outline" onClick={restart}>
            <RotateCcw /> Practise again
          </Button>
          <Button size="sm" variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>
      ) : (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          <label htmlFor="practice-reply" className="sr-only">
            Your reply
          </label>
          <input
            id="practice-reply"
            value={draft}
            maxLength={PRACTICE_TEXT_MAX_LENGTH}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Type how you'd respond…"
            autoComplete="off"
            className="h-9 min-w-0 flex-1 rounded-md border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <Button type="submit" size="sm" disabled={!draft.trim() || streaming || turns.length === 0} aria-label="Send reply">
            <Send />
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={onClose}>
            End
          </Button>
        </form>
      )}
    </section>
  );
}
