import type { Meta, StoryObj } from "@storybook/react-vite";
import InspectionSheet from "../InspectionSheet.tsx";
import { opening } from "./fixtures.ts";
const meta = {
  title: "InspectionSheet",
  component: InspectionSheet,
  args: {
    view: opening,
    selected: null,
    locked: false,
    available: [],
    onClose: () => undefined,
  },
} satisfies Meta<typeof InspectionSheet>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Card: Story = {
  args: {
    inspection: {
      kind: "card",
      card: { id: "a", name: "Athena", cost: 2, power: 3 },
    },
  },
};
export const Lane: Story = {
  args: { inspection: { kind: "lane", number: 1 } },
};
export const Player: Story = {
  args: { inspection: { kind: "player", side: "own" } },
};
