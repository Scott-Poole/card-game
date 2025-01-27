import { GameClient } from "./GameClient";
import { Deck } from "../Cards/Deck";
import { DeckUtils } from "../Cards/DeckUtils";

export class RandomGameClient implements GameClient {
    deck: Deck;

    constructor(startingDeck?: string[]) {
        console.log("RandomGameClient: Created");
        this.deck = startingDeck ? DeckUtils.stringsToDeck(startingDeck) : DeckUtils.getRandomDeck();
    }

    async takeTurn(): Promise<void> {
        console.log("RandomGameClient: Taking turn");
        return new Promise((resolve) => {
            // collect valid moves

            // choose a random move

            // apply the move

            // resolve the promise
        });
    }
}
