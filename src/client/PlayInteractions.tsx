import { useDraggable, useDroppable } from "@dnd-kit/react";
import { useEffect, useEffectEvent, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { css, cx } from "../../styled-system/css/index.js";
import { button, panel } from "../../styled-system/recipes/index.js";

export function HandCard({
  id,
  disabled,
  children,
}: {
  id: string;
  disabled: boolean;
  children: ReactNode;
}) {
  // Motion may animate the outer board-card wrapper; dnd-kit owns this inner node.
  const { ref } = useDraggable({ id, disabled });
  return (
    <div className="board-card">
      <div ref={ref} className={css({ touchAction: "none", height: "[100%]" })}>
        {children}
      </div>
    </div>
  );
}

export function PlayTarget({
  lane,
  enabled,
  active,
  onPlay,
  children,
}: {
  lane: number;
  enabled: boolean;
  active: boolean;
  onPlay: () => void;
  children: ReactNode;
}) {
  const { ref, isDropTarget } = useDroppable({ id: lane, disabled: !enabled });
  return (
    <div
      ref={ref}
      className={css({
        display: "flex",
        flexDirection: "column",
        flex: "1",
        minH: "[0]",
        gap: "xs",
      })}
    >
      {children}
      <button
        className={cx(
          button(),
          css({
            m: "none",
            p: "xs",
            fontSize: "small",
            outline: isDropTarget ? "focus" : undefined,
          }),
        )}
        disabled={!enabled}
        aria-label={`Play selected card in lane ${String(lane + 1)}`}
        onClick={onPlay}
      >
        {active && !enabled ? "Unavailable" : "Play here"}
      </button>
    </div>
  );
}

export function Inspect({
  name,
  children,
  onClose,
}: {
  name: string;
  children: ReactNode;
  onClose: (cancelSelection?: boolean) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const close = useEffectEvent(onClose);
  useEffect(() => {
    const dialog = ref.current;
    const previousFocus = document.activeElement;
    dialog?.show();
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !dialog?.contains(event.target))
        close();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") close(true);
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", escape);
    return () => {
      if (
        dialog?.contains(document.activeElement) &&
        previousFocus instanceof HTMLElement
      )
        previousFocus.focus();
      dialog?.close();
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", escape);
    };
  }, []);
  return createPortal(
    <dialog
      ref={ref}
      aria-label={name}
      onCancel={() => {
        onClose(true);
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      className={cx(
        panel(),
        css({
          position: "fixed",
          m: "auto",
          mt: "none",
          mb: "none",
          top: { base: "auto", md: "xl" },
          bottom: { base: "none", md: "auto" },
          left: "none",
          right: "none",
          color: "text",
          width: { base: "[100%]", md: "inspectPanel" },
          maxW: "content",
          zIndex: "overlay",
          _backdrop: { bg: "surface", opacity: "disabled" },
        }),
      )}
    >
      <h2>{name}</h2>
      {children}
      <button
        className={button()}
        onClick={() => {
          onClose();
        }}
      >
        Close
      </button>
    </dialog>,
    document.body,
  );
}
