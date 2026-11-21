import { expect, test } from "vitest";
import type { Card, MatchEvent, Score } from "../protocol/messages.ts";
import { logEventText, revealStatusText } from "./revealText.ts";

const card: Card = { id: "c1", name: "Athena", cost: 2, power: 3 };
const result: Score = { lanes: [0, 1, null], power: [5, 4], winner: null };

const revealed: MatchEvent = {
  type: "card-revealed",
  player: 1,
  lane: 2,
  card,
};
const turnEnded: MatchEvent = { type: "turn-ended", turn: 4 };
const matchEnded: MatchEvent = { type: "match-ended", result };

test("the live status names the card being revealed", () => {
  expect(revealStatusText(revealed)).toBe("Revealed Athena");
});

test("the live status announces a turn or match ending", () => {
  expect(revealStatusText(turnEnded)).toBe("Turn ended");
  expect(revealStatusText(matchEnded)).toBe("Match ended");
});

test("the live status falls back before the first step", () => {
  expect(revealStatusText(undefined)).toBe("Revealing turn…");
});

test("a past reveal lists the player (one-based), card and lane (one-based)", () => {
  expect(logEventText(revealed)).toBe("Player 2: Athena in lane 3");
});

test("a past turn end lists its turn number", () => {
  expect(logEventText(turnEnded)).toBe("Turn 4 ended");
});

test("a past match end reads plainly", () => {
  expect(logEventText(matchEnded)).toBe("Match ended");
});

test("power changes announce the absolute power", () => {
  const event: MatchEvent = {
    type: "power-changed",
    player: 0,
    lane: 1,
    cardId: "c1",
    power: 5,
  };
  expect(revealStatusText(event, [revealed])).toBe("Card now has 5 power");
  expect(logEventText(event, [{ ...revealed, player: 0 }])).toBe(
    "Player 1: Athena in lane 2 now has 5 power",
  );
});

test("power changes name allies revealed on earlier turns", () => {
  const event: MatchEvent = {
    type: "power-changed",
    player: 0,
    lane: 0,
    cardId: "c1",
    power: 4,
  };
  expect(revealStatusText(event, [], [card])).toBe("Athena now has 4 power");
  expect(logEventText(event, [], [card])).toBe(
    "Player 1: Athena in lane 1 now has 4 power",
  );
});

test.each([0, 1] as const)("destroy text names side %i card", (player) => {
  const event: MatchEvent = {
    type: "card-destroyed",
    player,
    lane: 1,
    cardId: card.id,
  };
  expect(revealStatusText(event, [], [card])).toBe("Destroyed Athena");
  expect(logEventText(event, [], [card])).toBe(
    `Player ${String(player + 1)}: Athena destroyed in lane 2`,
  );
});
