import type { Meta, StoryObj } from "@storybook/react-vite";
import Lane from "../Lane.tsx";
import { selectLaneTotals } from "../laneTotals.ts";
import type { PlayerView } from "../../protocol/messages.ts";
import { opening, staging, revealed, full } from "./fixtures.ts";
import { css } from "../../../styled-system/css/index.js";
function laneArgs(view: PlayerView, lane: number) {
  const totals = selectLaneTotals(view);
  return {
    number: lane + 1,
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
export const Full: Story = { args: laneArgs(full, 0) };
export const Tied: Story = { args: laneArgs(full, 0) };
export const Won: Story = { args: laneArgs(revealed, 1) };
export const Lost: Story = { args: laneArgs(revealed, 0) };
