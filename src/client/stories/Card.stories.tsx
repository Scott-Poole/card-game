import type { ComponentProps } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import Card from "../Card.tsx";
import { herald } from "./fixtures.ts";
import { css } from "../../../styled-system/css/index.js";
type FaceUpProps = Extract<ComponentProps<typeof Card>, { faceDown?: false }>;
const meta = {
  title: "Card",
  component: Card,
  decorators: [
    (Story) => (
      <div className={css({ width: "handCard", height: "lanePanel", m: "md" })}>
        <Story />
      </div>
    ),
  ],
  args: { data: herald },
} satisfies Meta<FaceUpProps>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Hand: Story = {};
export const Lane: Story = { args: { size: "lane" } };
export const Selected: Story = { args: { selected: true } };
export const Staged: Story = { args: { staged: true, size: "lane" } };
export const Disabled: Story = { args: { disabled: true } };
export const FaceDown: Story = { render: () => <Card faceDown /> };
export const FaceDownLane: Story = {
  render: () => <Card faceDown size="lane" />,
};
export const Composed: Story = {
  args: { art: <span>Art slot</span>, children: <span>Composed detail</span> },
};
