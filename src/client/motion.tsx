import {
  MotionConfig,
  useReducedMotion,
  motion,
  cubicBezier,
} from "motion/react";
import type { ReactNode } from "react";
import { token } from "../../styled-system/tokens/index.js";

// Theme durations are CSS milliseconds; Motion transitions use seconds.
export function useGameMotion() {
  const reduced = useReducedMotion();
  const [x1, y1, x2, y2] = token("easings.standard")
    .replace(/^cubic-bezier\(|\)$/g, "")
    .split(",")
    .map(Number);
  if (
    x1 === undefined ||
    y1 === undefined ||
    x2 === undefined ||
    y2 === undefined
  )
    throw new Error("Expected theme cubic-bezier easing");
  return {
    duration:
      Number.parseFloat(
        token(reduced ? "durations.instant" : "durations.reveal"),
      ) / 1000,
    ease: cubicBezier(x1, y1, x2, y2),
  };
}

export function GameMotion({ children }: { children: ReactNode }) {
  const transition = useGameMotion();
  return <MotionConfig transition={transition}>{children}</MotionConfig>;
}

export function CardMotion({
  children,
  className,
  enter = true,
}: {
  children: ReactNode;
  className?: string;
  enter?: boolean;
}) {
  return (
    <motion.div
      layout="position"
      initial={enter ? { opacity: 0 } : false}
      animate={{ opacity: 1 }}
      className={className}
      style={{ height: "100%" }}
    >
      {children}
    </motion.div>
  );
}
