"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

/** Talking points are lines starting with "- "; read them as plain sentences. */
export const speakable = (text: string) => text.replace(/^\s*-\s+/gm, "");

// Support never changes during a session, so there's nothing to subscribe to.
const noSubscription = () => () => {};
const browserSupportsSpeech = () => "speechSynthesis" in window;
const notOnServer = () => false;

/**
 * Reads text aloud with the browser's built-in speech synthesis (free, on-device). `supported` is
 * false during server rendering and in browsers without it, so the button never flashes or breaks.
 */
export function useSpeech() {
  const supported = useSyncExternalStore(noSubscription, browserSupportsSpeech, notOnServer);
  const [speaking, setSpeaking] = useState(false);
  const utterance = useRef<SpeechSynthesisUtterance | null>(null);

  const stop = useCallback(() => {
    if (utterance.current) window.speechSynthesis.cancel();
    utterance.current = null;
    setSpeaking(false);
  }, []);

  const speak = useCallback((text: string) => {
    window.speechSynthesis.cancel(); // only one voice at a time, across cards
    const u = new SpeechSynthesisUtterance(speakable(text));
    u.rate = 0.95;
    const done = () => {
      if (utterance.current === u) {
        utterance.current = null;
        setSpeaking(false);
      }
    };
    u.onend = done;
    u.onerror = done;
    utterance.current = u;
    setSpeaking(true);
    window.speechSynthesis.speak(u);
  }, []);

  useEffect(() => stop, [stop]);

  return { supported, speaking, speak, stop };
}
