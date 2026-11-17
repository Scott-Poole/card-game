import { useEffect, useState } from "react";
import type { PlayerView } from "../protocol/messages.ts";
import { sequenceReveal, type RevealStep } from "./reveal.ts";
import { motionTokens } from "./motionTokens.ts";
import { useGameMotion } from "./motion.tsx";

interface Playback {
  seen: PlayerView | null;
  base: PlayerView | null;
  steps: RevealStep[];
  index: number;
}

export function useReveal(latest: PlayerView | null) {
  const transition = useGameMotion();
  const [playback, setPlayback] = useState<Playback>({
    seen: latest,
    base: latest,
    steps: [],
    index: 0,
  });
  const { seen, base, steps, index } = playback;
  const active =
    transition.duration !== 0 && steps.length > 0 && index <= steps.length;
  if (seen !== latest || (transition.duration === 0 && steps.length > 0)) {
    if (active) {
      // Keep the running timeline intact; its final handoff reads the newest view.
      setPlayback({ ...playback, seen: latest });
    } else {
      const next =
        transition.duration !== 0 &&
        seen &&
        latest &&
        (latest.turn !== seen.turn || latest.phase !== seen.phase)
          ? sequenceReveal(seen, latest.events)
          : [];
      setPlayback({ seen: latest, base: seen, steps: next, index: 0 });
    }
  }
  useEffect(() => {
    if (!active) return;
    const timer = window.setTimeout(() => {
      setPlayback((current) => ({ ...current, index: current.index + 1 }));
    }, motionTokens.revealStep);
    return () => {
      window.clearTimeout(timer);
    };
  }, [active, index, steps, transition.duration]);
  function skip() {
    setPlayback((current) => ({ ...current, index: current.steps.length + 1 }));
  }
  useEffect(() => {
    if (!active) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape")
        setPlayback((current) => ({
          ...current,
          index: current.steps.length + 1,
        }));
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [active]);
  return {
    view: active ? (steps[index - 1]?.view ?? base) : latest,
    active,
    step: active ? steps[index - 1] : undefined,
    skip,
  };
}
