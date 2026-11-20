import type { ReactNode } from "react";
import type { Card as CardData } from "../protocol/messages.ts";
import { css } from "../../styled-system/css/index.js";
import { card } from "../../styled-system/recipes/index.js";

type CardProps = {
  size?: "hand" | "lane";
  selected?: boolean;
  staged?: boolean;
  disabled?: boolean;
  unavailable?: boolean;
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
        disabled: props.disabled === true || props.unavailable === true,
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
              pr: props.size === "lane" ? "none" : "md",
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
            {props.onInspect ? (
              <button
                className={css({
                  display: "block",
                  maxW: "[100%]",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: props.size === "lane" ? "nowrap" : "normal",
                  p: "none",
                })}
                aria-label={`Inspect ${props.data.name}`}
                aria-pressed={props.selected}
                aria-disabled={false}
                onClick={props.onInspect}
              >
                {props.data.name}
              </button>
            ) : (
              props.data.name
            )}
          </strong>
          {props.data.ability && (
            <span
              data-part="ability"
              className={css({
                fontSize: props.size === "lane" ? "[10px]" : "small",
                lineHeight: "[1]",
                lineClamp: props.size === "lane" ? 1 : 2,
                flexShrink: 0,
                overflowWrap: "anywhere",
              })}
            >
              {props.data.ability.text}
            </span>
          )}
        </>
      )}
      {props.children}
    </article>
  );
}
