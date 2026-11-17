import { useEffect, useState } from "react";
import type { PlayerView } from "../protocol/messages.ts";
import { sequenceReveal, type RevealStep } from "./reveal.ts";
import { useGameMotion } from "./motion.tsx";

export function useReveal(latest: PlayerView | null) {
  const transition = useGameMotion();
  const [seen, setSeen] = useState(latest);
  const [timeline, setTimeline] = useState<RevealStep[]>([]);
  const [index, setIndex] = useState(0);
  const [base, setBase] = useState(latest);
  const active = index < timeline.length;
  if (seen !== latest) {
    setSeen(latest);
    // A newer message interrupts playback atomically: never mix two timelines.
    const steps =
      !active &&
      seen &&
      latest &&
      (latest.turn !== seen.turn || latest.phase !== seen.phase)
        ? sequenceReveal(seen, latest.events)
        : [];
    setBase(steps.length ? seen : latest);
    setTimeline(steps);
    setIndex(0);
  }
  useEffect(() => {
    if (!active) return;
    const timer = window.setTimeout(() => {
      setIndex((value) =>
        transition.duration === 0 ? timeline.length : value + 1,
      );
    }, transition.duration * 1000);
    return () => {
      window.clearTimeout(timer);
    };
  }, [active, index, timeline, transition.duration]);
  useEffect(() => {
    if (!active) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIndex(timeline.length);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [active, timeline.length]);
  return {
    view: active ? (timeline[index - 1]?.view ?? base) : latest,
    active,
    step: active ? timeline[index - 1] : undefined,
    skip: () => {
      setIndex(timeline.length);
    },
  };
}
