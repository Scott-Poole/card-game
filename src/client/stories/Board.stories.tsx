import { useMemo } from "react";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import type { Meta, StoryObj } from "@storybook/react-vite";
import type { PlayerView } from "../../protocol/messages.ts";
import ProtocolGame from "../ProtocolGame.tsx";
import { connectionSlice } from "../connectionSlice.ts";
import { matchSlice } from "../matchSlice.ts";
import { stagingSlice } from "../stagingSlice.ts";
import { css } from "../../../styled-system/css/index.js";
import { opening, staging, revealed, ended, full } from "./fixtures.ts";

// Each mount gets a fresh store. No transport is connected; these are inspection fixtures.
function FixtureBoard({ view }: { view: PlayerView }) {
  const store = useMemo(() => {
    const store = configureStore({
      reducer: {
        connection: connectionSlice.reducer,
        match: matchSlice.reducer,
        staging: stagingSlice.reducer,
      },
    });
    store.dispatch(connectionSlice.actions.welcomed());
    store.dispatch(matchSlice.actions.viewReceived(view));
    store.dispatch(stagingSlice.actions.replaced(view.own.staged));
    return store;
  }, [view]);
  return (
    <Provider store={store}>
      <aside
        className={css({
          position: "fixed",
          top: "none",
          left: "none",
          zIndex: "notification",
          maxW: "handCard",
          bg: "panel",
          p: "xs",
          fontSize: "small",
        })}
      >
        Static fixture. Play actions require the live app.
      </aside>
      <ProtocolGame />
    </Provider>
  );
}
const meta = {
  title: "Board",
  component: FixtureBoard,

  parameters: {
    docs: {
      description: {
        component:
          "Static protocol views of the real board. Actions require the live app; no server or WebSocket is started here.",
      },
    },
  },
} satisfies Meta<typeof FixtureBoard>;
export default meta;
type Story = StoryObj<typeof meta>;
export const OpeningHand: Story = { args: { view: opening } };
export const MidTurnStaging: Story = { args: { view: staging } };
export const AfterReveal: Story = { args: { view: revealed } };
export const Ended: Story = { args: { view: ended } };

export const FullLanes: Story = { args: { view: full } };
