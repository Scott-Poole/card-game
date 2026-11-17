import type { ReactNode } from "react";
import type { Card as CardData } from "../protocol/messages.ts";
import { css } from "../../styled-system/css/index.js";
import { card } from "../../styled-system/recipes/index.js";

type CardProps = {
  size?: "hand" | "lane";
  selected?: boolean;
  staged?: boolean;
  disabled?: boolean;
  children?: ReactNode;
  onInspect?: (() => void) | undefined;
  art?: ReactNode;
} & ({ faceDown: true; data?: never } | { faceDown?: false; data: CardData });

export default function Card(props: CardProps) {
  return (
    <article
      className={card({
        size: props.size ?? "hand",
        selected: props.selected === true || props.staged === true,
        disabled: props.disabled,
      })}
      onClick={(event) => {
        if (event.target instanceof Element && !event.target.closest("button"))
          props.onInspect?.();
      }}
      aria-label={props.faceDown ? "Face-down card" : props.data.name}
      aria-description={props.staged ? "Staged, not yet revealed" : undefined}
      aria-disabled={props.disabled ? true : undefined}
    >
      {props.faceDown ? (
        <span aria-hidden="true">◆</span>
      ) : (
        <>
          <div
            className={css({
              display: "flex",
              justifyContent: "space-between",
              gap: "xs",
            })}
          >
            <span role="img" aria-label={`Cost ${String(props.data.cost)}`}>
              {props.size === "lane"
                ? props.data.cost
                : `Cost ${String(props.data.cost)}`}
            </span>
            <span role="img" aria-label={`Power ${String(props.data.power)}`}>
              {props.size === "lane"
                ? props.data.power
                : `Power ${String(props.data.power)}`}
            </span>
          </div>
          {props.art ?? (
            <div aria-label="Art placeholder" role="img" data-part="art" />
          )}
          <strong data-part="name">
            {props.size === "lane" && props.onInspect ? (
              <button
                className={css({
                  display: "block",
                  maxW: "[100%]",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  p: "none",
                })}
                aria-label={`Inspect ${props.data.name}`}
                onClick={props.onInspect}
              >
                {props.data.name}
              </button>
            ) : (
              props.data.name
            )}
          </strong>
        </>
      )}
      {props.onInspect && props.size !== "lane" && (
        <button
          aria-label={`Inspect ${props.faceDown ? "card" : props.data.name}`}
          onClick={props.onInspect}
        >
          Inspect
        </button>
      )}
      {props.children}
    </article>
  );
}
