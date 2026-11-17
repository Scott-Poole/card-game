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
}: {
  children: ReactNode;
  className?: string;
  id: string;
}) {
  const transition = useGameMotion();
  const dragging = useContext(DraggingCard) === id;
  return (
    <motion.div
      transition={transition}
      layout="position"
      {...(dragging ? {} : { layoutId: id })}
      initial={dragging ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      className={className}
      style={{ height: "100%" }}
    >
      {children}
    </motion.div>
  );
}
