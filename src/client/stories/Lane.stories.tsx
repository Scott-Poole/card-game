import type { Meta, StoryObj } from "@storybook/react-vite";
import Lane from "../Lane.tsx";
import { selectLaneTotals } from "../laneTotals.ts";
import type { PlayerView } from "../../protocol/messages.ts";
import { opening, staging, revealed, full, tied } from "./fixtures.ts";
import { css } from "../../../styled-system/css/index.js";
function laneArgs(view: PlayerView, lane: number) {
  const totals = selectLaneTotals(view);
  return {
    number: lane + 1,
    location: view.locations[lane],
    own: view.own.lanes[lane] ?? [],
    opponent: view.opponent.lanes[lane] ?? [],
    staged: view.own.staged
      .filter((play) => play.lane === lane)
      .flatMap((play) =>
        view.own.hand.filter((card) => card.id === play.cardId),
      ),
    ownTotal: totals.own[lane] ?? 0,
    opponentTotal: totals.opponent[lane] ?? 0,
  };
}
const meta = {
  title: "Lane",
  component: Lane,
  decorators: [
    (Story) => (
      <div className={css({ width: "lanePanel", m: "md" })}>
        <Story />
      </div>
    ),
  ],
  args: laneArgs(opening, 0),
} satisfies Meta<typeof Lane>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Empty: Story = {};
export const Partial: Story = { args: laneArgs(staging, 1) };
export const Full: Story = {
  args: laneArgs(full, 0),
  parameters: {
    docs: {
      description: {
        story:
          "Eight revealed cards: four per side around the central location.",
      },
    },
  },
};
export const Tied: Story = { args: laneArgs(tied, 0) };
export const Won: Story = { args: laneArgs(revealed, 1) };
export const Lost: Story = { args: laneArgs(revealed, 0) };
export const NamedLocation: Story = {
  args: laneArgs(opening, 2),
  parameters: {
    docs: {
      description: {
        story: "The lane shows its match location's name and rule text.",
      },
    },
  },
};
export const CapacityLimited: Story = {
  args: {
    ...laneArgs(staging, 1),
    location: {
      id: "cave-of-the-sibyl",
      name: "Cave of the Sibyl",
      text: "Each player may reveal at most 2 cards here.",
      effect: { kind: "lane-capacity", limit: 2 },
    },
  },
  parameters: {
    docs: {
      description: {
        story: "Slots past the limit render locked on both sides of the lane.",
      },
    },
  },
};
