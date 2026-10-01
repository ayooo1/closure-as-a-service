"use client";

import { useEffect, useState } from "react";
import { Check, Copy, Mail, MessageSquare } from "lucide-react";
import type { Medium } from "@caas/shared";
import { Button, buttonVariants } from "@/components/ui/button";
import { copyText } from "@/lib/clipboard";
import { mailtoHref, smsHref } from "@/lib/generation";

export function CopyButton({ text, onCopy }: { text: string; onCopy?: () => void }) {
  const [result, setResult] = useState<"copied" | "failed" | null>(null);
  useEffect(() => {
    if (!result) return;
    const t = setTimeout(() => setResult(null), result === "copied" ? 2000 : 4000);
    return () => clearTimeout(t);
  }, [result]);

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => {
        void copyText(text).then((ok) => {
          setResult(ok ? "copied" : "failed");
          if (ok) onCopy?.();
        });
      }}
    >
      {result === "copied" ? <Check /> : <Copy />}
      {result === "copied" ? "Copied" : result === "failed" ? "Select the text to copy" : "Copy"}
    </Button>
  );
}

export function SendLink({ medium, message, onSend }: { medium: Medium; message: string; onSend?: () => void }) {
  if (medium === "in-person") return null;
  const isText = medium === "text";
  return (
    <a
      href={isText ? smsHref(message) : mailtoHref(message)}
      onClick={onSend}
      className={buttonVariants({ variant: "outline", size: "sm" })}
    >
      {isText ? <MessageSquare /> : <Mail />}
      {isText ? "Open in Messages" : "Open in Mail"}
    </a>
  );
}
