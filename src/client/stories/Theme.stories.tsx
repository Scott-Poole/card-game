import type { Meta, StoryObj } from "@storybook/react-vite";
import { css } from "../../../styled-system/css/index.js";
import { panel } from "../../../styled-system/recipes/index.js";

function Theme() {
  return (
    <main className={css({ p: "lg", display: "grid", gap: "lg" })}>
      <h1>Aegean night</h1>
      <section className={panel()}>
        <h2>Palette</h2>
        <div className={css({ display: "flex", flexWrap: "wrap", gap: "md" })}>
          {(
            [
              "surface",
              "panel",
              "raised",
              "text",
              "muted",
              "border",
              "gold",
              "accent",
              "accentHover",
              "laneLeading",
              "positive",
              "negative",
              "own",
              "opponent",
              "onAccent",
            ] as const
          ).map((color) => (
            <figure key={color}>
              <div
                className={css({
                  bg: color,
                  width: "orb",
                  height: "orb",
                  border: "panel",
                  borderRadius: "control",
                })}
              />
              <figcaption>{color}</figcaption>
            </figure>
          ))}
        </div>
      </section>
      {(["surface", "panel", "raised"] as const).map((surface) => (
        <section
          key={surface}
          className={css({
            bg: surface,
            p: "lg",
            border: "panel",
            borderRadius: "panel",
          })}
        >
          <h2>{surface}</h2>
          <p>Body text: A contest of myth across three lanes.</p>
          <p className={css({ color: "muted" })}>
            Muted text: Plan, stage, reveal.
          </p>
        </section>
      ))}
      <section className={panel()}>
        <h2>Typography</h2>
        {(["display", "body"] as const).map((font) => (
          <div key={font}>
            {(["small", "body", "heading", "title"] as const).map((size) => (
              <p
                key={size}
                className={css({ fontFamily: font, fontSize: size })}
              >
                {font} / {size} — The Aegean under stars
              </p>
            ))}
          </div>
        ))}
      </section>
      <section className={panel()}>
        <h2>Accent glows</h2>
        <div className={css({ display: "flex", flexWrap: "wrap", gap: "lg" })}>
          {(
            [
              "gold",
              "accent",
              "own",
              "opponent",
              "positive",
              "negative",
            ] as const
          ).map((accent) => (
            <div
              key={accent}
              className={css({
                boxShadow: accent,
                color: accent,
                bg: "raised",
                p: "md",
                border: "panel",
                borderRadius: "control",
              })}
            >
              {accent}
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
const meta = { title: "Theme", component: Theme } satisfies Meta<typeof Theme>;
export default meta;
type Story = StoryObj<typeof meta>;
export const AegeanNight: Story = {};
