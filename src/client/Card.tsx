import type { ReactNode } from "react";
import type { Card as CardData } from "../protocol/messages.ts";
import { css } from "../../styled-system/css/index.js";
import { card } from "../../styled-system/recipes/index.js";

type CardProps = {
  size?: "hand" | "lane";
  selected?: boolean;
  disabled?: boolean;
  children?: ReactNode;
  art?: ReactNode;
} & ({ faceDown: true; data?: never } | { faceDown?: false; data: CardData });

export default function Card(props: CardProps) {
  return (
    <article
      className={card({
        size: props.size ?? "hand",
        selected: props.selected,
        disabled: props.disabled,
      })}
      aria-label={props.faceDown ? "Face-down card" : props.data.name}
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
            <span>Cost {props.data.cost}</span>
            <span>Power {props.data.power}</span>
          </div>
          {props.art ?? (
            <div aria-label="Art placeholder" role="img" data-part="art" />
          )}
          <h3>{props.data.name}</h3>
        </>
      )}
      {props.children}
    </article>
  );
}
