import { LayoutGroup, MotionConfig, motion } from "motion/react";
import {
  createContext,
  useContext,
  useId,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { motionTokens } from "./motionTokens.ts";

const normal = {
  duration: motionTokens.reveal / 1000,
  ease: motionTokens.standard,
};
const reduced = { ...normal, duration: motionTokens.instant / 1000 };
const DraggingCard = createContext<string | null>(null);

const mediaQuery = "(prefers-reduced-motion: reduce)";
function subscribeMotion(callback: () => void) {
  const query = window.matchMedia(mediaQuery);
  query.addEventListener("change", callback);
  return () => {
    query.removeEventListener("change", callback);
  };
}
function reducedSnapshot() {
  return window.matchMedia(mediaQuery).matches;
}

// Motion's useReducedMotion snapshots the setting at mount in this version.
// Subscribe here so changing the OS preference also updates imperative settles.
export function useGameMotion() {
  return useSyncExternalStore(subscribeMotion, reducedSnapshot, () => true)
    ? reduced
    : normal;
}

export function GameMotion({ children }: { children: ReactNode }) {
  const transition = useGameMotion();
  const id = useId();
  return (
    <MotionConfig transition={transition}>
      <LayoutGroup id={id}>{children}</LayoutGroup>
    </MotionConfig>
  );
}

export function CardMotionScope({
  dragging,
  children,
}: {
  dragging: string | null;
  children: ReactNode;
}) {
  return <DraggingCard value={dragging}>{children}</DraggingCard>;
}

export function CardMotion({
  children,
  className,
  id,
  appear = false,
  flip = false,
}: {
  children: ReactNode;
  className?: string;
  id: string;
  appear?: boolean;
  flip?: boolean;
}) {
  const transition = useGameMotion();
  const dragging = useContext(DraggingCard) === id;
  return (
    <motion.div
      transition={transition}
      layout
      {...(dragging ? {} : { layoutId: id })}
      initial={
        flip
          ? { rotateY: 90, opacity: 0 }
          : appear && !dragging
            ? { opacity: 0 }
            : false
      }
      animate={{ opacity: 1, rotateY: 0 }}
      className={className}
      style={{ height: "100%" }}
    >
      {children}
    </motion.div>
  );
}
