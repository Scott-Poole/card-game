import {
  LayoutGroup,
  MotionConfig,
  useReducedMotion,
  motion,
} from "motion/react";
import { createContext, useContext, useId, type ReactNode } from "react";
import { motionTokens } from "./motionTokens.ts";

const normal = {
  duration: motionTokens.reveal / 1000,
  ease: motionTokens.standard,
};
const reduced = { ...normal, duration: motionTokens.instant / 1000 };
const DraggingCard = createContext<string | null>(null);

export function useGameMotion() {
  return useReducedMotion() ? reduced : normal;
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
  const dragging = useContext(DraggingCard) === id;
  return (
    <motion.div
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
