import { motion } from "motion/react";
import type { ComponentProps } from "react";
import { css, cx } from "../../styled-system/css/index.js";
import { panel } from "../../styled-system/recipes/index.js";

/** The padded panel every board section shares. */
export default function BoardPanel({
  className,
  playing,
  ...props
}: ComponentProps<typeof motion.section> & {
  /** Tighter padding while the board is still the main thing on screen. */
  playing: boolean;
}) {
  return (
    <motion.section
      className={cx(
        className,
        panel(),
        css({
          my: "md",
          p: playing ? "sm" : { base: "compact", md: "md" },
          overflowWrap: "anywhere",
        }),
      )}
      {...props}
    />
  );
}
