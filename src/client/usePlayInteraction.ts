import { useRef, useState, useLayoutEffect } from "react";
import type { ComponentProps, RefObject } from "react";
import { DragDropProvider, DragOverlay } from "@dnd-kit/react";
import { flushSync } from "react-dom";
import { animate } from "motion/react";
import { useGameMotion } from "./motion.tsx";
import { playAvailability } from "./playAvailability.ts";
import { useAppDispatch } from "./hooks.ts";
import { send } from "./store.ts";

export function usePlayInteraction(
  input: Omit<Parameters<typeof playAvailability>[0], "settling"> & {
    hand: RefObject<HTMLElement | null>;
    onStage: () => void;
  },
) {
  const { view, staged, revealing, hand, onStage } = input;
  const [selected, setSelected] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [settling, setSettling] = useState(false);
  const drop = useRef<{ cardId: string; lane: number } | null>(null);
  const slots = useRef(new Map<string, HTMLDivElement>());
  const wasRevealing = useRef(false);
  const transition = useGameMotion();
  const dispatch = useAppDispatch();
  const facts = playAvailability({ ...input, settling });
  const { canStage } = facts;
  function stage(cardId: string | null, lane: number, finishingDrop = false) {
    if (cardId === null || !canStage(cardId, lane, finishingDrop)) return;
    dispatch(send({ type: "stage", plays: [...staged, { cardId, lane }] }));
    setSelected(null);
    onStage();
    hand.current?.focus();
  }
  const finishStage = useRef(stage);
  useLayoutEffect(() => {
    finishStage.current = stage;
    if (wasRevealing.current && !revealing) hand.current?.focus();
    wasRevealing.current = revealing;
  });
  const onDragStart: ComponentProps<typeof DragDropProvider>["onDragStart"] = (
    event,
  ) => {
    setDragging(String(event.operation.source?.id));
  };
  const onDragEnd: ComponentProps<typeof DragDropProvider>["onDragEnd"] = (
    event,
  ) => {
    const { source, target } = event.operation;
    drop.current =
      !event.canceled &&
      source &&
      typeof target?.id === "number" &&
      canStage(String(source.id), target.id)
        ? { cardId: String(source.id), lane: target.id }
        : null;
    setSettling(true);
  };
  const dropAnimation: ComponentProps<
    typeof DragOverlay
  >["dropAnimation"] = async ({ feedbackElement, element, placeholder }) => {
    const play = drop.current;
    // Keep the source in the hand until the overlay finishes: no duplicate lane card.
    const slotIndex = play
      ? (view?.own.lanes[play.lane]?.length ?? 0) +
        staged.filter((item) => item.lane === play.lane).length
      : 0;
    const slot = play
      ? slots.current.get(`${String(play.lane)}:${String(slotIndex)}`)
      : null;
    const destination = slot ?? placeholder ?? element;
    const from = (
      feedbackElement.firstElementChild ?? feedbackElement
    ).getBoundingClientRect();
    const to = destination.getBoundingClientRect();
    try {
      if (feedbackElement instanceof HTMLElement) {
        feedbackElement.style.transformOrigin = "top left";
        await animate(
          feedbackElement,
          {
            // dnd-kit pins transform !important to this variable while dragging.
            "--dnd-transform": [
              "translate(0px, 0px) scale(1, 1)",
              `translate(${String(to.x - from.x)}px, ${String(to.y - from.y)}px) scale(${String(to.width / from.width)}, ${String(to.height / from.height)})`,
            ],
          },
          transition,
        );
      }
    } catch {
      // A detached overlay may cancel its cosmetic animation; still apply the play.
    } finally {
      // Commit the destination before dnd-kit removes the overlay and reveals its source.
      flushSync(() => {
        if (play) finishStage.current(play.cardId, play.lane, true);
        if (drop.current === play) drop.current = null;
        setDragging(null);
        setSettling(false);
      });
    }
  };
  return {
    ...facts,
    selected,
    setSelected,
    dragging,
    settling,
    stage,
    onDragStart,
    onDragEnd,
    dropAnimation,
    registerSlot: (
      lane: number,
      slot: number,
      element: HTMLDivElement | null,
    ) => {
      const key = `${String(lane)}:${String(slot)}`;
      if (element) slots.current.set(key, element);
      else slots.current.delete(key);
    },
  };
}
