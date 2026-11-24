import { motion, useMotionValue } from "motion/react";
import { useLayoutEffect, useRef, type ReactNode } from "react";
import { css } from "../../styled-system/css/index.js";
import { token } from "../../styled-system/tokens/index.js";

export default function Stage({
  active,
  children,
}: {
  active: boolean;
  children: ReactNode;
}) {
  const boardScale = useMotionValue(1);
  const viewport = useRef<HTMLDivElement>(null);
  const board = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const frame = viewport.current;
    const stage = board.current;
    if (!active || !frame || !stage) return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const scale = Math.min(
        entry.contentRect.width / Number.parseFloat(token("sizes.stageWidth")),
        entry.contentRect.height /
          Number.parseFloat(token("sizes.stageHeight")),
      );
      stage.style.visibility = "visible";
      stage.style.setProperty("--stage-scale", String(scale));
      boardScale.set(scale);
      stage.style.transform = `scale(${String(scale)})`;
    });
    observer.observe(frame);
    return () => {
      observer.disconnect();
    };
  }, [active, boardScale]);
  if (!active) return children;
  return (
    <div
      ref={viewport}
      className={css({
        position: "fixed",
        inset: "none",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
        pt: "safeTop",
        pb: "safeBottom",
        pl: "safeLeft",
        pr: "safeRight",
      })}
    >
      <motion.section
        style={{ scale: boardScale }}
        ref={board}
        aria-label="Match board"
        className={css({
          visibility: "hidden",
          width: "stageWidth",
          height: "stageHeight",
          flexShrink: 0,
          transformOrigin: "center",
        })}
      >
        {children}
      </motion.section>
    </div>
  );
}
