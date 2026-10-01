import { ShieldAlert } from "lucide-react";

const linkClass = "whitespace-nowrap font-medium text-primary underline underline-offset-2";

/** Shown when the model flags that the user may be at risk from this person. */
export function SafetyNotice() {
  return (
    <aside
      aria-labelledby="safety-title"
      className="space-y-3 rounded-lg border border-amber-500/50 bg-amber-500/10 p-5 text-sm leading-relaxed"
    >
      <h3 id="safety-title" className="flex items-center gap-2 text-base font-semibold">
        <ShieldAlert className="size-5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
        Your safety comes first
      </h3>
      <p>
        Some of what you shared suggests this person may not react safely. You don&apos;t owe anyone a conversation or
        an explanation. If you can, send your message from somewhere safe, let someone you trust know, and consider
        blocking them afterwards. These messages are written to be short and final for that reason.
      </p>
      <p className="font-medium">If you&apos;re in immediate danger, call your local emergency number.</p>
      <ul className="list-disc space-y-1 pl-5">
        <li>
          Free, confidential support worldwide:{" "}
          <a className={linkClass} href="https://findahelpline.com" target="_blank" rel="noreferrer">
            findahelpline.com
          </a>
        </li>
        <li>
          US: National Domestic Violence Hotline,{" "}
          <a className={linkClass} href="tel:18007997233">
            1-800-799-7233
          </a>{" "}
          or text START to 88788
        </li>
        <li>
          UK: National Domestic Abuse Helpline,{" "}
          <a className={linkClass} href="tel:08082000247">
            0808 2000 247
          </a>
        </li>
      </ul>
    </aside>
  );
}
