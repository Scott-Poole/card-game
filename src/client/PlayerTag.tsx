import { css, cx } from "../../styled-system/css/index.js";
import { button } from "../../styled-system/recipes/index.js";

/** Opens the player-info sheet; lights up when this player's cards reveal first. */
export default function PlayerTag({
  label,
  revealsFirst,
  onInspect,
}: {
  label: string;
  revealsFirst: boolean;
  onInspect: () => void;
}) {
  return (
    <button
      data-reveals-first={revealsFirst || undefined}
      className={cx(
        button(),
        css({
          display: "flex",
          alignItems: "center",
          gap: "xs",
          m: "none",
          p: "xs",
          fontSize: "small",
          color: "text",
          bg: "panel",
          minW: "[0]",
          lineHeight: "heading",
          "&[data-reveals-first]": { borderColor: "accent", bg: "raised" },
        }),
      )}
      aria-haspopup="dialog"
      onClick={onInspect}
    >
      <span
        aria-hidden="true"
        className={css({
          flexShrink: 0,
          width: "laneBadge",
          height: "laneBadge",
          border: "panel",
          borderRadius: "control",
          bg: "raised",
        })}
      />
      <span>
        {label}
        {revealsFirst && " · Reveals first"}
      </span>
    </button>
  );
}
