"use client";

import { useEffect, useState } from "react";
import { Check, Copy, Mail, MessageSquare } from "lucide-react";
import type { Medium } from "@caas/shared";
import { Button, buttonVariants } from "@/components/ui/button";
import { mailtoHref, smsHref } from "@/lib/generation";

export function CopyButton({ text, onCopy }: { text: string; onCopy?: () => void }) {
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
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          onCopy?.();
        });
      }}
    >
      {copied ? <Check /> : <Copy />}
      {copied ? "Copied" : "Copy"}
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
