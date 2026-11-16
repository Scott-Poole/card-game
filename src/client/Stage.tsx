import { useLayoutEffect, useRef, type ReactNode } from "react";
import { css } from "../../styled-system/css/index.js";
import { stageDesign } from "./stageTheme.ts";

export default function Stage({
  active,
  children,
}: {
  active: boolean;
  children: ReactNode;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const board = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const frame = viewport.current;
    const stage = board.current;
    if (!active || !frame || !stage) return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const scale = Math.min(
        entry.contentRect.width / stageDesign.width,
        entry.contentRect.height / stageDesign.height,
      );
      stage.style.transform = `scale(${String(scale)})`;
    });
    observer.observe(frame);
    return () => {
      observer.disconnect();
    };
  }, [active]);
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
        pt: "[env(safe-area-inset-top)]",
        pb: "[env(safe-area-inset-bottom)]",
        pl: "[env(safe-area-inset-left)]",
        pr: "[env(safe-area-inset-right)]",
      })}
    >
      <section ref={board} aria-label="Match board" className="portrait-stage">
        {children}
      </section>
    </div>
  );
}
