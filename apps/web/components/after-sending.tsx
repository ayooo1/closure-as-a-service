"use client";

import { HeartHandshake, X } from "lucide-react";
import type { Ending } from "@caas/shared";
import { Button } from "@/components/ui/button";

const AFTERCARE: Record<Ending, string[]> = {
  relationship: [
    "Mute or archive the chat for a while, so you're not waiting on a reply.",
    "You don't have to answer anything they send straight away, or at all.",
    "Consider some no-contact time, even a few weeks, before deciding about friendship.",
  ],
  situationship: [
    "Mute or archive the chat for a while, so you're not waiting on a reply.",
    "You don't owe a long back-and-forth. A short, kind answer is enough if they reply.",
  ],
  friendship: [
    "Mute or unfollow their socials if seeing their posts will sting.",
    "You don't have to answer anything they send straight away, or at all.",
  ],
  "ghosting-apology": [
    "Whether they reply or not, reaching out was the right thing to do.",
    "Don't wait by the phone. Their response, or silence, is theirs to choose.",
  ],
  "reply-to-breakup": [
    "It's okay to grieve. Let yourself feel it rather than replying again.",
    "Mute or archive the chat for a while, and give yourself time before deciding about friendship.",
  ],
};
const ALWAYS = [
  "Tell a friend or someone you trust how it went.",
  "Do something kind for yourself today: eat, rest, get some air.",
];
const SAFETY_FIRST = "Consider blocking their number and accounts, and keep screenshots of anything threatening.";

/** Shown once the user copies or sends a message: the moment they're most likely to need it. */
export function AfterSending({
  ending,
  safetyConcern,
  onDismiss,
}: {
  ending: Ending;
  safetyConcern: boolean;
  onDismiss: () => void;
}) {
  const items = [...(safetyConcern ? [SAFETY_FIRST] : []), ...AFTERCARE[ending], ...ALWAYS];
  return (
    <aside aria-labelledby="after-sending-title" className="relative space-y-3 rounded-lg border bg-card p-5 shadow-sm">
      <Button variant="ghost" size="icon" className="absolute top-2 right-2 size-8" aria-label="Dismiss" onClick={onDismiss}>
        <X />
      </Button>
      <h3 id="after-sending-title" className="flex items-center gap-2 pr-8 font-semibold">
        <HeartHandshake className="size-5 text-primary" aria-hidden /> After you send it
      </h3>
      <ul className="space-y-2 text-sm">
        {items.map((item) => (
          <li key={item}>
            <label className="flex cursor-pointer items-start gap-2.5">
              <input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-[var(--primary)]" />
              <span>{item}</span>
            </label>
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">
        Struggling? Free, confidential support is available at{" "}
        <a className="font-medium text-primary underline underline-offset-2" href="https://findahelpline.com" target="_blank" rel="noreferrer">
          findahelpline.com
        </a>
        .
      </p>
    </aside>
  );
}
